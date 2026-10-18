// 组合测试（ALAG-25 续修 3/4）：真 runner + 真 chromeEngine + 假全局对象 + 假计时器。
// 实例调用卡住时，引擎自己的 60 秒超时先完成销毁/清缓存；runner 的 200 秒兜底不会先触发。
import { describe, expect, it, vi } from 'vitest';
import { createChromeEngine, INSTANCE_TIMEOUT_MS, type LanguageDetectorStatic, type TranslatorInstanceLike, type TranslatorStatic } from './chromeEngine';
import { createTranslationRunner } from './runner';

function fakeTimers() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = ++nextId;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (handle: unknown): void => {
      timers.delete(handle as number);
    },
    async advance(ms: number): Promise<void> {
      now += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) return;
        timers.delete(due[0]);
        due[1].fn();
        // 让超时回调触发的 Promise 链（清理、失败、下一个任务）跑完。
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('runner + chromeEngine 的实例超时', () => {
  it('实例 translate 卡住：第一个任务 engine-failed，第二个用新实例完成', async () => {
    const timers = fakeTimers();
    const destroy = vi.fn();
    let createCalls = 0;
    const create = vi.fn<TranslatorStatic['create']>(() => {
      createCalls += 1;
      return createCalls === 1
        ? Promise.resolve({ translate: vi.fn(() => new Promise<string>(() => undefined)), destroy })
        : Promise.resolve({ translate: vi.fn(async (text: string) => `[${text}]`) });
    });
    const translator: TranslatorStatic = {
      availability: vi.fn(async () => 'available' as const),
      create,
    };
    const engine = createChromeEngine({ Translator: translator }, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    const runner = createTranslationRunner(engine, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });

    const first = runner.translate({ segments: ['One'], target: 'zh', source: 'en' });
    const second = runner.translate({ segments: ['Two'], target: 'zh', source: 'en' });
    await flush();
    await timers.advance(INSTANCE_TIMEOUT_MS);

    await expect(first.result).resolves.toEqual({
      status: 'failed',
      error: { code: 'engine-failed', message: `TimeoutError: translate exceeded ${INSTANCE_TIMEOUT_MS}ms` },
      source: 'en',
      done: 0,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    await expect(second.result).resolves.toEqual({ status: 'complete', source: 'en' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('实例 detect 卡住：第一个任务 engine-failed，第二个用新检测器完成', async () => {
    const timers = fakeTimers();
    const destroy = vi.fn();
    let detectorCreateCalls = 0;
    const detector: LanguageDetectorStatic = {
      availability: vi.fn(async () => 'available' as const),
      create: vi.fn<LanguageDetectorStatic['create']>(() => {
        detectorCreateCalls += 1;
        return detectorCreateCalls === 1
          ? Promise.resolve({
              detect: vi.fn(() => new Promise<{ detectedLanguage: string; confidence: number }[]>(() => undefined)),
              destroy,
            })
          : Promise.resolve({ detect: vi.fn(async () => [{ detectedLanguage: 'en', confidence: 0.99 }]) });
      }),
    };
    const translator: TranslatorStatic = {
      availability: vi.fn(async () => 'available' as const),
      create: vi.fn(async () => ({ translate: vi.fn(async (text: string) => `[${text}]`) })),
    };
    const engine = createChromeEngine(
      { Translator: translator, LanguageDetector: detector },
      { setTimer: timers.setTimer, clearTimer: timers.clearTimer },
    );
    const runner = createTranslationRunner(engine, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });

    const first = runner.translate({ segments: ['One'], target: 'zh' });
    const second = runner.translate({ segments: ['Two'], target: 'zh' });
    await flush();
    await timers.advance(INSTANCE_TIMEOUT_MS);

    await expect(first.result).resolves.toEqual({
      status: 'failed',
      error: { code: 'engine-failed', message: `TimeoutError: detect exceeded ${INSTANCE_TIMEOUT_MS}ms` },
      done: 0,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    await expect(second.result).resolves.toEqual({ status: 'complete', source: 'en' });
    expect(detector.create).toHaveBeenCalledTimes(2);
  });

  it('create 50 秒才完成且实例 translate 卡住：110 秒时第一个任务 engine-failed，第二个任务随后用新实例完成', async () => {
    const timers = fakeTimers();
    const events: string[] = [];
    const destroy = vi.fn();
    let resolveFirstCreate!: (instance: TranslatorInstanceLike) => void;
    const firstInstance: TranslatorInstanceLike = {
      translate: vi.fn(() => {
        events.push('first-translate');
        return new Promise<string>(() => undefined);
      }),
      destroy: () => {
        events.push('first-destroy');
        destroy();
      },
    };
    let secondStartedAfterFirst = false;
    let firstFinished = false;
    const goodInstance: TranslatorInstanceLike = {
      translate: vi.fn(async (text: string) => {
        events.push('second-translate');
        secondStartedAfterFirst = firstFinished;
        return `[${text}]`;
      }),
    };
    let createCalls = 0;
    const create = vi.fn<TranslatorStatic['create']>(() => {
      createCalls += 1;
      return createCalls === 1
        ? new Promise<TranslatorInstanceLike>((resolve) => {
            resolveFirstCreate = resolve;
          })
        : Promise.resolve(goodInstance);
    });
    const translator: TranslatorStatic = {
      availability: vi.fn(async () => 'available' as const),
      create,
    };
    const engine = createChromeEngine({ Translator: translator }, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    const runner = createTranslationRunner(engine, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });

    const first = runner.translate({ segments: ['One'], target: 'zh', source: 'en' });
    const second = runner.translate({ segments: ['Two'], target: 'zh', source: 'en' });
    void first.result.then(() => {
      firstFinished = true;
      events.push('first-result');
    });

    await flush();
    await timers.advance(50_000);
    expect(create).toHaveBeenCalledTimes(1);
    resolveFirstCreate(firstInstance);
    await flush();
    await timers.advance(60_000); // 到 110 秒

    await expect(first.result).resolves.toEqual({
      status: 'failed',
      error: { code: 'engine-failed', message: `TimeoutError: translate exceeded ${INSTANCE_TIMEOUT_MS}ms` },
      source: 'en',
      done: 0,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    await expect(second.result).resolves.toEqual({ status: 'complete', source: 'en' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(secondStartedAfterFirst).toBe(true);
    expect(events.indexOf('first-result')).toBeLessThan(events.indexOf('second-translate'));
  });

  it('create 抛 NotSupportedError 后重试成功但实例 translate 卡住：第一个任务 engine-failed，第二个任务用新实例完成', async () => {
    const timers = fakeTimers();
    const destroy = vi.fn();
    const notSupported = Object.assign(new Error('Unable to create translator'), { name: 'NotSupportedError' });
    const badInstance: TranslatorInstanceLike = {
      translate: vi.fn(() => new Promise<string>(() => undefined)),
      destroy,
    };
    let createCalls = 0;
    const create = vi.fn<TranslatorStatic['create']>(() => {
      createCalls += 1;
      if (createCalls === 1) return Promise.reject(notSupported);
      if (createCalls === 2) return Promise.resolve(badInstance);
      return Promise.resolve({ translate: vi.fn(async (text: string) => `[${text}]`) });
    });
    const translator: TranslatorStatic = {
      availability: vi.fn(async () => 'available' as const),
      create,
    };
    const engine = createChromeEngine({ Translator: translator }, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    const runner = createTranslationRunner(engine, { setTimer: timers.setTimer, clearTimer: timers.clearTimer });

    const first = runner.translate({ segments: ['One'], target: 'zh', source: 'en' });
    const second = runner.translate({ segments: ['Two'], target: 'zh', source: 'en' });
    await flush();
    // 第一次 create 立刻抛 NotSupportedError；重试等待 3 秒后第二次 create 得到卡住的实例。
    await timers.advance(3_000);
    expect(create).toHaveBeenCalledTimes(2);
    await timers.advance(INSTANCE_TIMEOUT_MS);

    await expect(first.result).resolves.toEqual({
      status: 'failed',
      error: { code: 'engine-failed', message: `TimeoutError: translate exceeded ${INSTANCE_TIMEOUT_MS}ms` },
      source: 'en',
      done: 0,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    await expect(second.result).resolves.toEqual({ status: 'complete', source: 'en' });
    expect(create).toHaveBeenCalledTimes(3);
  });
});
