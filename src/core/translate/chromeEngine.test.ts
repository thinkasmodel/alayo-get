import { describe, expect, it, vi } from 'vitest';
import {
  createChromeEngine,
  isTranslationSupported,
  type LanguageDetectorStatic,
  type TranslatorCreateOptions,
  type TranslatorInstanceLike,
  type TranslatorStatic,
} from './chromeEngine';

const okTranslator = (create: TranslatorStatic['create'], availability: 'available' | 'downloadable' | 'unavailable' = 'available'): TranslatorStatic => ({
  availability: vi.fn(async () => availability),
  create,
});

const instance = (translate: TranslatorInstanceLike['translate'] = async (text) => `[${text}]`): TranslatorInstanceLike => ({ translate });

describe('isTranslationSupported', () => {
  it('没有 Translator 全局时 false', () => {
    expect(isTranslationSupported({})).toBe(false);
    expect(createChromeEngine({}).supported()).toBe(false);
  });

  it('有 Translator.create 时 true', () => {
    expect(isTranslationSupported({ Translator: okTranslator(vi.fn(async () => instance())) })).toBe(true);
  });
});

describe('createChromeEngine', () => {
  it('同一语言对两次 translate 只 create 一次', async () => {
    const create = vi.fn(async () => instance());
    const engine = createChromeEngine({ Translator: okTranslator(create) });
    await expect(engine.translate('en', 'zh', 'one')).resolves.toBe('[one]');
    await expect(engine.translate('en', 'zh', 'two')).resolves.toBe('[two]');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('并发两次 translate 也只 create 一次', async () => {
    let release!: (value: TranslatorInstanceLike) => void;
    const create = vi.fn(
      () =>
        new Promise<TranslatorInstanceLike>((resolve) => {
          release = resolve;
        }),
    );
    const engine = createChromeEngine({ Translator: okTranslator(create) });
    const first = engine.translate('en', 'zh', 'one');
    const second = engine.translate('en', 'zh', 'two');
    expect(create).toHaveBeenCalledTimes(1);
    release(instance());
    await expect(Promise.all([first, second])).resolves.toEqual(['[one]', '[two]']);
  });

  it('第一次 create 抛 NotSupportedError → 等 retryDelayMs 后重试成功', async () => {
    const notSupported = Object.assign(new Error('Unable to create translator'), { name: 'NotSupportedError' });
    const create = vi
      .fn<TranslatorStatic['create']>()
      .mockRejectedValueOnce(notSupported)
      .mockResolvedValueOnce(instance());
    const engine = createChromeEngine({ Translator: okTranslator(create) }, { retryDelayMs: 0 });
    await expect(engine.translate('en', 'zh', 'hi')).resolves.toBe('[hi]');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('连续两次 NotSupportedError → 抛出第二次错误并清空缓存，下次调用重新 create', async () => {
    const notSupported = Object.assign(new Error('Unable to create translator'), { name: 'NotSupportedError' });
    const create = vi
      .fn<TranslatorStatic['create']>()
      .mockRejectedValueOnce(notSupported)
      .mockRejectedValueOnce(notSupported)
      .mockResolvedValueOnce(instance());
    const engine = createChromeEngine({ Translator: okTranslator(create) }, { retryDelayMs: 0 });
    await expect(engine.translate('en', 'zh', 'hi')).rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(create).toHaveBeenCalledTimes(2);
    await expect(engine.translate('en', 'zh', 'hi')).resolves.toBe('[hi]');
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('signal 只传给实例的 translate，不传给 create', async () => {
    const translate = vi.fn(async (text: string) => text);
    const create = vi.fn<TranslatorStatic['create']>(async () => ({ translate }));
    const engine = createChromeEngine({ Translator: okTranslator(create) });
    const signal = new AbortController().signal;
    await engine.translate('en', 'zh', 'hi', signal);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('signal');
    expect(translate).toHaveBeenCalledWith('hi', { signal });
  });

  it('download 把 downloadprogress 的 loaded 转给 onProgress', async () => {
    const progress: number[] = [];
    const create = vi.fn(async (options: TranslatorCreateOptions) => {
      let listener: ((event: { loaded: number }) => void) | undefined;
      options.monitor?.({
        addEventListener: (type, fn) => {
          expect(type).toBe('downloadprogress');
          listener = fn;
        },
      });
      listener?.({ loaded: 0.25 });
      listener?.({ loaded: 0.75 });
      return instance();
    });
    const engine = createChromeEngine({ Translator: okTranslator(create, 'downloadable') });
    await engine.download({ kind: 'translator', source: 'en', target: 'zh' }, (fraction) => progress.push(fraction));
    expect(progress).toEqual([0.25, 0.75]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sourceLanguage: 'en', targetLanguage: 'zh' }));
  });

  it('detect 把 detectedLanguage/confidence 映射为 language/confidence，检测器只 create 一次', async () => {
    const detect = vi.fn(async () => [{ detectedLanguage: 'en', confidence: 0.9 }]);
    const detector: LanguageDetectorStatic = {
      availability: vi.fn(async () => 'available' as const),
      create: vi.fn(async () => ({ detect })),
    };
    const engine = createChromeEngine({ Translator: okTranslator(vi.fn(async () => instance())), LanguageDetector: detector });
    await expect(engine.detect('hello')).resolves.toEqual([{ language: 'en', confidence: 0.9 }]);
    await engine.detect('again');
    expect(detector.create).toHaveBeenCalledTimes(1);
  });

  it('没有 LanguageDetector 时 detectorAvailability 为 unavailable', async () => {
    const engine = createChromeEngine({ Translator: okTranslator(vi.fn(async () => instance())) });
    await expect(engine.detectorAvailability()).resolves.toBe('unavailable');
  });
});
