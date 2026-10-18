import { describe, expect, it, vi } from 'vitest';
import { createTranslationRunner, DETECT_SAMPLE_CHARS, MIN_DETECT_CONFIDENCE, STEP_TIMEOUT_MS } from './runner';
import type { DetectedLanguage, ModelAvailability, TranslateHandlers, TranslateRequest, TranslationEngine } from './types';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeTimers() {
  let nextId = 0;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = ++nextId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (handle: unknown): void => {
      timers.delete(handle as number);
    },
    fire(): void {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.fn();
      }
    },
    pending(): number[] {
      return [...timers.values()].map((timer) => timer.ms);
    },
  };
}

function fakeEngine() {
  const state = {
    supported: true,
    detector: 'available' as ModelAvailability,
    pair: 'available' as ModelAvailability,
    detected: [{ language: 'en', confidence: 0.99 }] as DetectedLanguage[],
  };
  const engine: TranslationEngine = {
    id: 'fake',
    supported: () => state.supported,
    detectorAvailability: vi.fn(async () => state.detector),
    detect: vi.fn(async () => state.detected),
    availability: vi.fn(async () => state.pair),
    download: vi.fn(async () => undefined),
    translate: vi.fn(async (_source: string, _target: string, text: string) => `[${text}]`),
  };
  return { engine, state };
}

async function run(engine: TranslationEngine, request: TranslateRequest, handlers?: TranslateHandlers) {
  const sources: string[] = [];
  const segments: Array<{ index: number; text: string }> = [];
  const job = createTranslationRunner(engine, { newId: () => 'job-1' }).translate(request, {
    onSource: (source) => {
      sources.push(source);
      handlers?.onSource?.(source);
    },
    onSegment: (index, text) => {
      segments.push({ index, text });
      handlers?.onSegment?.(index, text);
    },
  });
  const result = await job.result;
  return { job, result, sources, segments };
}

describe('createTranslationRunner', () => {
  it('引擎不支持 → unsupported-browser', async () => {
    const { engine, state } = fakeEngine();
    state.supported = false;
    const { result, sources } = await run(engine, { segments: ['Hello'], target: 'zh' });
    expect(result).toEqual({ status: 'failed', error: { code: 'unsupported-browser' }, done: 0 });
    expect(sources).toEqual([]);
    expect(engine.detect).not.toHaveBeenCalled();
    expect(engine.translate).not.toHaveBeenCalled();
  });

  it('传了 source 时不检测，使用规范化后的标签', async () => {
    const { engine } = fakeEngine();
    const { result, sources } = await run(engine, { segments: ['Hello'], target: 'zh-CN', source: 'EN-us' });
    expect(engine.detectorAvailability).not.toHaveBeenCalled();
    expect(engine.detect).not.toHaveBeenCalled();
    expect(sources).toEqual(['en']);
    expect(engine.translate).toHaveBeenCalledWith('en', 'zh', 'Hello', expect.any(AbortSignal));
    expect(result).toEqual({ status: 'complete', source: 'en' });
  });

  it('检测器模型未下载 → needs-download（detector）', async () => {
    const { engine, state } = fakeEngine();
    state.detector = 'downloadable';
    const { result } = await run(engine, { segments: ['Hello'], target: 'zh' });
    expect(result).toEqual({ status: 'failed', error: { code: 'needs-download', model: { kind: 'detector' } }, done: 0 });
    expect(engine.detect).not.toHaveBeenCalled();
  });

  it('检测器不可用 → source-unknown', async () => {
    const { engine, state } = fakeEngine();
    state.detector = 'unavailable';
    const { result } = await run(engine, { segments: ['Hello'], target: 'zh' });
    expect(result).toEqual({ status: 'failed', error: { code: 'source-unknown' }, done: 0 });
  });

  it('检测置信度低于阈值 → source-unknown', async () => {
    const { engine, state } = fakeEngine();
    state.detected = [{ language: 'en', confidence: MIN_DETECT_CONFIDENCE - 0.01 }];
    const { result } = await run(engine, { segments: ['Hello'], target: 'zh' });
    expect(result).toEqual({ status: 'failed', error: { code: 'source-unknown' }, done: 0 });
  });

  it('检测结果为 und → source-unknown', async () => {
    const { engine, state } = fakeEngine();
    state.detected = [{ language: 'und', confidence: 0.99 }];
    const { result } = await run(engine, { segments: ['Hello'], target: 'zh' });
    expect(result).toEqual({ status: 'failed', error: { code: 'source-unknown' }, done: 0 });
  });

  it('检测样本是非空白段用换行连接后的前 DETECT_SAMPLE_CHARS 个字符', async () => {
    const { engine } = fakeEngine();
    const long = 'b'.repeat(DETECT_SAMPLE_CHARS + 100);
    await run(engine, { segments: ['  ', long, 'tail'], target: 'zh' });
    expect(engine.detect).toHaveBeenCalledWith(`${long}\ntail`.slice(0, DETECT_SAMPLE_CHARS));
  });

  it('所有段都是空白 → 不检测、不调 onSource 和引擎，逐段原样交回', async () => {
    const { engine } = fakeEngine();
    const { result, sources, segments } = await run(engine, { segments: ['', '   '], target: 'zh-CN' });
    expect(sources).toEqual([]);
    expect(engine.detectorAvailability).not.toHaveBeenCalled();
    expect(engine.detect).not.toHaveBeenCalled();
    expect(engine.availability).not.toHaveBeenCalled();
    expect(engine.translate).not.toHaveBeenCalled();
    expect(segments).toEqual([
      { index: 0, text: '' },
      { index: 1, text: '   ' },
    ]);
    expect(result).toEqual({ status: 'complete', source: 'zh' });
  });

  it('所有段都是空白且传了 source → source 用规范化后的值', async () => {
    const { engine } = fakeEngine();
    const { result } = await run(engine, { segments: [' '], target: 'zh', source: 'EN-us' });
    expect(result).toEqual({ status: 'complete', source: 'en' });
  });

  it('源语言与目标语言相同 → skipped，不查语言对、不翻译', async () => {
    const { engine } = fakeEngine();
    const { result, sources } = await run(engine, { segments: ['Hello'], target: 'en', source: 'en-US' });
    expect(result).toEqual({ status: 'skipped', source: 'en' });
    expect(sources).toEqual(['en']);
    expect(engine.availability).not.toHaveBeenCalled();
    expect(engine.translate).not.toHaveBeenCalled();
  });

  it('语言对不可用 → unsupported-pair', async () => {
    const { engine, state } = fakeEngine();
    state.pair = 'unavailable';
    const { result } = await run(engine, { segments: ['Hello'], target: 'ja', source: 'en' });
    expect(result).toEqual({
      status: 'failed',
      error: { code: 'unsupported-pair', source: 'en', target: 'ja' },
      source: 'en',
      done: 0,
    });
  });

  it.each(['downloadable', 'downloading'] as const)('语言对模型 %s → needs-download（translator）', async (pair) => {
    const { engine, state } = fakeEngine();
    state.pair = pair;
    const { result } = await run(engine, { segments: ['Hello'], target: 'zh', source: 'en' });
    expect(result).toEqual({
      status: 'failed',
      error: { code: 'needs-download', model: { kind: 'translator', source: 'en', target: 'zh' } },
      source: 'en',
      done: 0,
    });
  });

  it('空白段不调引擎且原样交回', async () => {
    const { engine } = fakeEngine();
    const { result, segments } = await run(engine, { segments: ['', 'Hello'], target: 'zh', source: 'en' });
    expect(engine.translate).toHaveBeenCalledTimes(1);
    expect(segments).toEqual([
      { index: 0, text: '' },
      { index: 1, text: '[Hello]' },
    ]);
    expect(result).toEqual({ status: 'complete', source: 'en' });
  });

  it('超过 2000 字符的段分块调用引擎并按目标语言拼接', async () => {
    const { engine } = fakeEngine();
    const text = 'a'.repeat(4500);
    const { result, segments } = await run(engine, { segments: [text], target: 'en', source: 'fr' });
    const calls = (engine.translate as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[2] as string);
    expect(calls.map((piece) => piece.length)).toEqual([2000, 2000, 500]);
    expect(segments).toEqual([{ index: 0, text: calls.map((piece) => `[${piece}]`).join(' ') }]);
    expect(result).toEqual({ status: 'complete', source: 'fr' });
  });

  it('FIFO：第二个任务在第一个结束后才开始调用引擎', async () => {
    const { engine } = fakeEngine();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    engine.translate = vi.fn(async (_source: string, _target: string, text: string) => {
      order.push(text);
      if (text === 'first') await gate;
      return text.toUpperCase();
    });
    const service = createTranslationRunner(engine);
    const first = service.translate({ segments: ['first'], target: 'zh', source: 'en' });
    const second = service.translate({ segments: ['second'], target: 'zh', source: 'en' });
    await flush();
    expect(order).toEqual(['first']);
    release();
    expect(await first.result).toEqual({ status: 'complete', source: 'en' });
    expect(await second.result).toEqual({ status: 'complete', source: 'en' });
    expect(order).toEqual(['first', 'second']);
  });

  it('取消排队中的任务：立即 cancelled，引擎从未被调用', async () => {
    const { engine } = fakeEngine();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    engine.translate = vi.fn(async (_source: string, _target: string, text: string) => {
      order.push(text);
      await gate;
      return text;
    });
    const service = createTranslationRunner(engine);
    const first = service.translate({ segments: ['first'], target: 'zh', source: 'en' });
    await flush();
    const second = service.translate({ segments: ['second'], target: 'zh', source: 'en' });
    service.cancel(second.id);
    expect(await second.result).toEqual({ status: 'cancelled', done: 0 });
    release();
    await first.result;
    expect(order).toEqual(['first']);
  });

  it('取消进行中的任务：当前段结束后 cancelled，后续段不再翻译', async () => {
    const { engine } = fakeEngine();
    const calls: string[] = [];
    engine.translate = vi.fn((_source: string, _target: string, text: string, signal?: AbortSignal) => {
      calls.push(text);
      if (text === 'two') {
        return new Promise<string>((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort);
        });
      }
      return Promise.resolve(`[${text}]`);
    });
    let resolveFirst!: () => void;
    const firstSegment = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const service = createTranslationRunner(engine);
    const job = service.translate(
      { segments: ['one', 'two', 'three'], target: 'zh', source: 'en' },
      {
        onSegment: (index) => {
          if (index === 0) resolveFirst();
        },
      },
    );
    await firstSegment;
    service.cancel(job.id);
    expect(await job.result).toEqual({ status: 'cancelled', source: 'en', done: 1 });
    expect(calls).toEqual(['one', 'two']);
  });

  it('引擎抛错 → engine-failed，message 含错误名，result 不 reject', async () => {
    const { engine } = fakeEngine();
    engine.translate = vi.fn(async () => {
      throw new TypeError('boom');
    });
    const { result } = await run(engine, { segments: ['Hello'], target: 'zh', source: 'en' });
    expect(result).toEqual({
      status: 'failed',
      error: { code: 'engine-failed', message: 'TypeError: boom' },
      source: 'en',
      done: 0,
    });
  });

  it('handlers 抛错不影响任务结果', async () => {
    const { engine } = fakeEngine();
    const { result, segments } = await run(
      engine,
      { segments: ['Hello'], target: 'zh', source: 'en' },
      {
        onSource: () => {
          throw new Error('source handler');
        },
        onSegment: () => {
          throw new Error('segment handler');
        },
      },
    );
    expect(result).toEqual({ status: 'complete', source: 'en' });
    expect(segments).toEqual([{ index: 0, text: '[Hello]' }]);
  });

  it('detect 永远 pending 时取消：立即 cancelled，后面的任务照常完成', async () => {
    const { engine } = fakeEngine();
    const timers = fakeTimers();
    const never = new Promise<DetectedLanguage[]>(() => undefined);
    let detectCalls = 0;
    engine.detect = vi.fn(() => {
      detectCalls += 1;
      return detectCalls === 1 ? never : Promise.resolve([{ language: 'en', confidence: 0.99 }]);
    });
    const service = createTranslationRunner(engine, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    const first = service.translate({ segments: ['One'], target: 'zh' });
    const second = service.translate({ segments: ['Two'], target: 'zh' });
    await flush();
    expect(engine.detect).toHaveBeenCalledTimes(1);

    service.cancel(first.id);
    await expect(first.result).resolves.toEqual({ status: 'cancelled', done: 0 });
    await expect(second.result).resolves.toEqual({ status: 'complete', source: 'en' });
    expect(engine.translate).toHaveBeenCalledWith('en', 'zh', 'Two', expect.any(AbortSignal));
    expect(timers.pending()).toEqual([]);
  });

  it('availability 永远 pending → 超时 engine-failed，后续任务照常，放弃的 Promise reject 不产生未处理 rejection', async () => {
    const { engine } = fakeEngine();
    const timers = fakeTimers();
    let rejectFirst!: (err: unknown) => void;
    const firstAvailability = new Promise<ModelAvailability>((_resolve, reject) => {
      rejectFirst = reject;
    });
    let availabilityCalls = 0;
    engine.availability = vi.fn(() => {
      availabilityCalls += 1;
      return availabilityCalls === 1 ? firstAvailability : Promise.resolve<ModelAvailability>('available');
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown): void => {
      unhandled.push(err);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const service = createTranslationRunner(engine, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });
      const first = service.translate({ segments: ['One'], target: 'zh', source: 'en' });
      const second = service.translate({ segments: ['Two'], target: 'zh', source: 'en' });
      await flush();
      expect(engine.availability).toHaveBeenCalledTimes(1);
      expect(timers.pending()).toEqual([STEP_TIMEOUT_MS]);

      timers.fire();
      await expect(first.result).resolves.toEqual({
        status: 'failed',
        error: { code: 'engine-failed', message: `TimeoutError: availability exceeded ${STEP_TIMEOUT_MS}ms` },
        source: 'en',
        done: 0,
      });
      await expect(second.result).resolves.toEqual({ status: 'complete', source: 'en' });

      rejectFirst(new Error('late availability failure'));
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
