// 组合测试（ALAG-25 续修 3）：真 runner + 真 chromeEngine + 假全局对象 + 假计时器。
// 实例调用卡住时，引擎自己的 60 秒超时先完成销毁/清缓存；runner 的 90 秒兜底不会先触发。
import { describe, expect, it, vi } from 'vitest';
import { createChromeEngine, INSTANCE_TIMEOUT_MS, type LanguageDetectorStatic, type TranslatorStatic } from './chromeEngine';
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
});
