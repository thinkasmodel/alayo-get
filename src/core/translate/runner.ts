// 与环境无关的翻译任务执行器（ALAG-25 §6）：语言检测、同语言跳过、长段切分、FIFO 排队、
// 逐段上报、取消。offscreen 文档和扩展页面都用它；引擎由调用方注入。
import { sameLanguage, toApiTag } from './language';
import { joinPieces, splitLong } from './split';
import type {
  ModelSpec,
  TranslateError,
  TranslateHandlers,
  TranslateJob,
  TranslateRequest,
  TranslateResult,
  TranslationEngine,
  TranslationService,
} from './types';

export interface RunnerOptions {
  newId?: () => string;
  /** 便于测试注入假计时器；缺省 setTimeout/clearTimeout。 */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const DETECT_SAMPLE_CHARS = 2000;
export const MIN_DETECT_CONFIDENCE = 0.5;
/** 单次引擎调用最多等这么久。它是兜底：引擎自己的 create / 实例超时是 60 秒，先触发并完成清理。 */
export const STEP_TIMEOUT_MS = 90_000;

/** 对引擎的一次等待：正常完成、被取消、超时或引擎报错。 */
type StepResult<T> = { status: 'ok'; value: T } | { status: 'cancelled' } | { status: 'timeout'; step: string } | { status: 'error'; error: unknown };

interface Job {
  id: string;
  request: TranslateRequest;
  handlers?: TranslateHandlers;
  controller: AbortController;
  /** 已经通过 onSegment 交出的段数。 */
  done: number;
  /** 规范化后的源语言；确定前取消或失败时没有。 */
  source?: string;
  started: boolean;
  cancelled: boolean;
  settled: boolean;
  resolve: (result: TranslateResult) => void;
}

const defaultNewId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const messageOf = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

const isAbortError = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';

/** 新建一个 FIFO 执行器：任务按提交顺序一次只跑一个。 */
export function createTranslationRunner(engine: TranslationEngine, options: RunnerOptions = {}): TranslationService {
  const newId = options.newId ?? defaultNewId;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const queue: Job[] = [];
  const jobs = new Map<string, Job>();
  let running = false;

  const cancelledResult = (job: Job): TranslateResult =>
    job.source === undefined ? { status: 'cancelled', done: job.done } : { status: 'cancelled', source: job.source, done: job.done };

  const failedResult = (job: Job, error: TranslateError): TranslateResult =>
    job.source === undefined ? { status: 'failed', error, done: job.done } : { status: 'failed', error, source: job.source, done: job.done };

  const settle = (job: Job, result: TranslateResult): void => {
    if (job.settled) return;
    job.settled = true;
    job.resolve(result);
    jobs.delete(job.id);
  };

  const cancelledNow = (job: Job): boolean => job.cancelled || job.controller.signal.aborted;

  /** handlers 里抛出的异常不影响任务。 */
  const callHandler = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      console.debug('[Alayo Get] 翻译进度处理出错', err);
    }
  };

  const emitSource = (job: Job, source: string): void => {
    callHandler(() => job.handlers?.onSource?.(source));
  };

  const emitSegment = (job: Job, index: number, text: string): void => {
    job.done += 1;
    callHandler(() => job.handlers?.onSegment?.(index, text));
  };

  const timeoutResult = (job: Job, step: string): TranslateResult =>
    failedResult(job, { code: 'engine-failed', message: `TimeoutError: ${step} exceeded ${STEP_TIMEOUT_MS}ms` });

  /**
   * 与任务的 abort 信号、STEP_TIMEOUT_MS 计时器三者赛跑。被放弃的引擎 Promise 之后
   * resolve 或 reject 都由这里的 then/catch 吞掉，不产生未处理的 rejection。
   */
  const raceStep = <T>(job: Job, step: string, operation: Promise<T>): Promise<StepResult<T>> => {
    void operation.catch(() => undefined);
    return new Promise<StepResult<T>>((resolve) => {
      let settled = false;
      let timer: unknown = null;
      const signal = job.controller.signal;

      function finish(result: StepResult<T>): void {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          clearTimer(timer);
          timer = null;
        }
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      }
      function onAbort(): void {
        finish({ status: 'cancelled' });
      }

      if (cancelledNow(job)) {
        finish({ status: 'cancelled' });
        return;
      }
      signal.addEventListener('abort', onAbort);
      const handle = setTimer(() => finish({ status: 'timeout', step }), STEP_TIMEOUT_MS);
      if (settled) clearTimer(handle);
      else timer = handle;
      operation.then(
        (value) => finish({ status: 'ok', value }),
        (error) => finish({ status: 'error', error }),
      );
    });
  };

  const detectSource = async (job: Job): Promise<string | TranslateResult> => {
    const availabilityStep = await raceStep(job, 'detectorAvailability', engine.detectorAvailability());
    if (availabilityStep.status === 'cancelled') return cancelledResult(job);
    if (availabilityStep.status === 'timeout') return timeoutResult(job, availabilityStep.step);
    if (availabilityStep.status === 'error') throw availabilityStep.error;
    if (cancelledNow(job)) return cancelledResult(job);
    const availability = availabilityStep.value;

    if (availability === 'downloadable' || availability === 'downloading') {
      return failedResult(job, { code: 'needs-download', model: { kind: 'detector' } });
    }
    if (availability === 'unavailable') return failedResult(job, { code: 'source-unknown' });

    const sample = job.request.segments
      .filter((segment) => segment.trim() !== '')
      .join('\n')
      .slice(0, DETECT_SAMPLE_CHARS);
    const detectStep = await raceStep(job, 'detect', engine.detect(sample));
    if (detectStep.status === 'cancelled') return cancelledResult(job);
    if (detectStep.status === 'timeout') return timeoutResult(job, detectStep.step);
    if (detectStep.status === 'error') throw detectStep.error;
    if (cancelledNow(job)) return cancelledResult(job);
    const first = detectStep.value[0];
    if (!first || first.language === 'und' || first.confidence < MIN_DETECT_CONFIDENCE) {
      return failedResult(job, { code: 'source-unknown' });
    }
    return toApiTag(first.language);
  };

  const translateSegments = async (job: Job, source: string, target: string): Promise<TranslateResult> => {
    const { segments } = job.request;
    for (let index = 0; index < segments.length; index += 1) {
      if (cancelledNow(job)) return cancelledResult(job);
      const segment = segments[index] ?? '';
      if (segment.trim() === '') {
        emitSegment(job, index, segment);
        continue;
      }
      const translated: string[] = [];
      for (const piece of splitLong(segment)) {
        if (cancelledNow(job)) return cancelledResult(job);
        const step = await raceStep(job, 'translate', engine.translate(source, target, piece, job.controller.signal));
        if (step.status === 'cancelled') return cancelledResult(job);
        if (step.status === 'timeout') return timeoutResult(job, step.step);
        if (step.status === 'error') throw step.error;
        if (cancelledNow(job)) return cancelledResult(job);
        translated.push(step.value);
      }
      emitSegment(job, index, joinPieces(translated, target));
    }
    return { status: 'complete', source };
  };

  const run = async (job: Job): Promise<TranslateResult> => {
    try {
      if (!engine.supported()) return failedResult(job, { code: 'unsupported-browser' });
      if (cancelledNow(job)) return cancelledResult(job);

      const target = toApiTag(job.request.target);
      const allBlank = job.request.segments.every((segment) => segment.trim() === '');
      if (allBlank) {
        // 没有可检测的文字：不检测、不调 onSource，每段原样交回（§6）
        const source = job.request.source === undefined ? target : toApiTag(job.request.source);
        job.source = source;
        for (let index = 0; index < job.request.segments.length; index += 1) {
          if (cancelledNow(job)) return cancelledResult(job);
          emitSegment(job, index, job.request.segments[index] ?? '');
        }
        return { status: 'complete', source };
      }

      let source: string;
      if (job.request.source !== undefined) {
        source = toApiTag(job.request.source);
      } else {
        const detected = await detectSource(job);
        if (typeof detected !== 'string') return detected;
        source = detected;
      }
      job.source = source;
      if (cancelledNow(job)) return cancelledResult(job);
      emitSource(job, source);
      if (cancelledNow(job)) return cancelledResult(job);
      if (sameLanguage(source, target)) return { status: 'skipped', source };

      const availabilityStep = await raceStep(job, 'availability', engine.availability(source, target));
      if (availabilityStep.status === 'cancelled') return cancelledResult(job);
      if (availabilityStep.status === 'timeout') return timeoutResult(job, availabilityStep.step);
      if (availabilityStep.status === 'error') throw availabilityStep.error;
      if (cancelledNow(job)) return cancelledResult(job);
      const availability = availabilityStep.value;
      if (availability === 'unavailable') return failedResult(job, { code: 'unsupported-pair', source, target });
      if (availability === 'downloadable' || availability === 'downloading') {
        const model: ModelSpec = { kind: 'translator', source, target };
        return failedResult(job, { code: 'needs-download', model });
      }

      return await translateSegments(job, source, target);
    } catch (err) {
      if (job.cancelled && isAbortError(err)) return cancelledResult(job);
      return failedResult(job, { code: 'engine-failed', message: messageOf(err) });
    }
  };

  const runLoop = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job || job.settled) continue;
        job.started = true;
        try {
          settle(job, await run(job));
        } catch (err) {
          settle(job, failedResult(job, { code: 'engine-failed', message: messageOf(err) }));
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    translate(request: TranslateRequest, handlers?: TranslateHandlers): TranslateJob {
      const id = newId();
      let resolve!: (result: TranslateResult) => void;
      const result = new Promise<TranslateResult>((done) => {
        resolve = done;
      });
      const job: Job = {
        id,
        request,
        handlers,
        controller: new AbortController(),
        done: 0,
        started: false,
        cancelled: false,
        settled: false,
        resolve,
      };
      jobs.set(id, job);
      queue.push(job);
      void runLoop().catch((err: unknown) => console.error('[Alayo Get] 翻译任务执行器出错', err));
      return { id, result };
    },

    cancel(jobId: string): void {
      const job = jobs.get(jobId);
      if (!job || job.settled) return;
      if (!job.started) {
        // 排队中的任务立即结束，引擎不会被调用
        settle(job, { status: 'cancelled', done: 0 });
        return;
      }
      job.cancelled = true;
      job.controller.abort();
    },
  };
}
