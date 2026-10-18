// 本机翻译引擎（ALAG-25 §7）：包装 Chrome 内置的 Translator / LanguageDetector，注入全局对象便于测试。
// 只应在 offscreen 文档或扩展页面里调用：ADR-0011 与 ALAG-24 实测确认不能在 Worker / service worker 里用。
import type { DetectedLanguage, ModelAvailability, ModelSpec, TranslationEngine } from './types';

/** translate/detect 路径上的 create 最多等这么久；下载路径不受此限。 */
export const CREATE_TIMEOUT_MS = 60_000;

export interface TranslatorMonitorLike {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

export interface TranslatorInstanceLike {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
}

export interface TranslatorCreateOptions {
  sourceLanguage: string;
  targetLanguage: string;
  monitor?: (monitor: TranslatorMonitorLike) => void;
  signal?: AbortSignal;
}

/** Chrome 的 Translator 静态接口（只写本层用到的部分）。 */
export interface TranslatorStatic {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<ModelAvailability>;
  create(options: TranslatorCreateOptions): Promise<TranslatorInstanceLike>;
}

export interface LanguageDetectorResultLike {
  detectedLanguage: string;
  confidence: number;
}

export interface LanguageDetectorInstanceLike {
  detect(text: string): Promise<LanguageDetectorResultLike[]>;
  destroy?(): void;
}

export interface LanguageDetectorCreateOptions {
  monitor?: (monitor: TranslatorMonitorLike) => void;
}

/** Chrome 的 LanguageDetector 静态接口。 */
export interface LanguageDetectorStatic {
  availability(): Promise<ModelAvailability>;
  create(options?: LanguageDetectorCreateOptions): Promise<LanguageDetectorInstanceLike>;
}

/** 注入的全局对象；缺省用 globalThis。不声明 ambient 全局，避免测试环境里混入真实 API。 */
export interface ChromeAiGlobals {
  Translator?: TranslatorStatic;
  LanguageDetector?: LanguageDetectorStatic;
}

export interface ChromeEngineOptions {
  retryDelayMs?: number;
  /** 便于测试注入假计时器；缺省 setTimeout/clearTimeout。 */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const globals = (): ChromeAiGlobals => globalThis as ChromeAiGlobals;

/** 当前环境有没有本机翻译（有没有 Translator 全局）。 */
export function isTranslationSupported(g: ChromeAiGlobals = globals()): boolean {
  return typeof g.Translator?.create === 'function';
}

const isNotSupportedError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'NotSupportedError';

const isAbortError = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';

const timeoutError = (step: string): Error => Object.assign(new Error(`TimeoutError: ${step} exceeded ${CREATE_TIMEOUT_MS}ms`), { name: 'TimeoutError' });

const downloadMonitor = (onProgress?: (fraction: number) => void) => (monitor: TranslatorMonitorLike) => {
  monitor.addEventListener('downloadprogress', (event) => onProgress?.(event.loaded));
};

/** 新建本机引擎。retryDelayMs 用于首次创建偶发 NotSupportedError 后的重试（ALAG-24 §3）。 */
export function createChromeEngine(g: ChromeAiGlobals = globals(), options: ChromeEngineOptions = {}): TranslationEngine {
  const retryDelayMs = options.retryDelayMs ?? 3000;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  /** 翻译器按 source>target 缓存；创建中的 Promise 也缓存，并发调用共用一次 create。 */
  const translators = new Map<string, Promise<TranslatorInstanceLike>>();
  /** 检测器只缓存一个。 */
  let detector: Promise<LanguageDetectorInstanceLike> | null = null;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimer(resolve, ms);
    });

  /** 给 translate/detect 路径上的 create 加超时；超时的 Promise 之后 settle 会被这里吞掉。 */
  const withCreateTimeout = <T>(operation: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: unknown = null;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          clearTimer(timer);
          timer = null;
        }
        fn();
      };
      const handle = setTimer(() => finish(() => reject(timeoutError('create'))), CREATE_TIMEOUT_MS);
      if (settled) clearTimer(handle);
      else timer = handle;
      operation.then(
        (value) => finish(() => resolve(value)),
        (err) => finish(() => reject(err)),
      );
    });

  const destroyQuietly = (instance: { destroy?(): void }): void => {
    try {
      instance.destroy?.();
    } catch (err) {
      console.debug('[Alayo Get] 销毁本机翻译实例失败', err);
    }
  };

  const createTranslator = (source: string, target: string, monitor?: (m: TranslatorMonitorLike) => void): Promise<TranslatorInstanceLike> => {
    const api = g.Translator;
    if (!api) return Promise.reject(new Error('Translator API is not available'));
    return api.create({ sourceLanguage: source, targetLanguage: target, ...(monitor ? { monitor } : {}) });
  };

  const getTranslator = (source: string, target: string): Promise<TranslatorInstanceLike> => {
    const key = `${source}>${target}`;
    const cached = translators.get(key);
    if (cached) return cached;
    const pending = withCreateTimeout(createTranslator(source, target)).catch((err: unknown) => {
      if (translators.get(key) === pending) translators.delete(key);
      throw err;
    });
    translators.set(key, pending);
    return pending;
  };

  /** 首次创建偶发 NotSupportedError：等 retryDelayMs 后重试一次；再失败照常抛出。 */
  const getTranslatorWithRetry = async (
    source: string,
    target: string,
  ): Promise<{ instance: TranslatorInstanceLike; promise: Promise<TranslatorInstanceLike> }> => {
    let promise = getTranslator(source, target);
    try {
      return { instance: await promise, promise };
    } catch (err) {
      if (!isNotSupportedError(err)) throw err;
      await sleep(retryDelayMs);
      promise = getTranslator(source, target);
      return { instance: await promise, promise };
    }
  };

  const getDetector = (): Promise<LanguageDetectorInstanceLike> => {
    if (detector) return detector;
    const api = g.LanguageDetector;
    if (!api) return Promise.reject(new Error('LanguageDetector API is not available'));
    const pending = withCreateTimeout(api.create()).catch((err: unknown) => {
      if (detector === pending) detector = null;
      throw err;
    });
    detector = pending;
    return pending;
  };

  return {
    id: 'local',

    supported(): boolean {
      return typeof g.Translator?.create === 'function';
    },

    async detectorAvailability(): Promise<ModelAvailability> {
      return g.LanguageDetector ? g.LanguageDetector.availability() : 'unavailable';
    },

    async detect(text: string): Promise<DetectedLanguage[]> {
      const pending = getDetector();
      const instance = await pending;
      try {
        const results = await instance.detect(text);
        return results.map((result) => ({ language: result.detectedLanguage, confidence: result.confidence }));
      } catch (err) {
        // 非 AbortError：实例可能坏了，销毁并清缓存，下次重新 create。
        if (!isAbortError(err)) {
          destroyQuietly(instance);
          if (detector === pending) detector = null;
        }
        throw err;
      }
    },

    async availability(source: string, target: string): Promise<ModelAvailability> {
      if (!g.Translator) return 'unavailable';
      return g.Translator.availability({ sourceLanguage: source, targetLanguage: target });
    },

    /** 下载模型。本机引擎要求用户手势：只能在扩展页面里由用户点击触发（ADR-0011 后果）。 */
    async download(model: ModelSpec, onProgress?: (fraction: number) => void): Promise<void> {
      if (model.kind === 'detector') {
        if (detector) {
          await detector;
          return;
        }
        const api = g.LanguageDetector;
        if (!api) throw new Error('LanguageDetector API is not available');
        // 下载可能要很久，不加超时（只有 translate/detect 路径上的 create 加）。
        const pending = api.create({ monitor: downloadMonitor(onProgress) }).catch((err: unknown) => {
          if (detector === pending) detector = null;
          throw err;
        });
        detector = pending;
        await pending;
        return;
      }

      const key = `${model.source}>${model.target}`;
      const cached = translators.get(key);
      if (cached) {
        await cached;
        return;
      }
      // 下载可能要很久，不加超时。
      const pending = createTranslator(model.source, model.target, downloadMonitor(onProgress)).catch((err: unknown) => {
        if (translators.get(key) === pending) translators.delete(key);
        throw err;
      });
      translators.set(key, pending);
      await pending;
    },

    async translate(source: string, target: string, text: string, signal?: AbortSignal): Promise<string> {
      // signal 只传给实例的 translate，不传给 create：create 跨任务共用缓存（§7）。
      const key = `${source}>${target}`;
      const { instance, promise } = await getTranslatorWithRetry(source, target);
      try {
        return await instance.translate(text, { signal });
      } catch (err) {
        // AbortError 是正常的任务取消，不动缓存；其余错误销毁实例并清缓存。
        if (!isAbortError(err)) {
          destroyQuietly(instance);
          if (translators.get(key) === promise) translators.delete(key);
        }
        throw err;
      }
    },
  };
}
