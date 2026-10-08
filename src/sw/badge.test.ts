// codex review ALAG-2A 第 2 轮：旧的成功结果不得清掉后来的失败角标。
import { describe, expect, it } from 'vitest';
import type { SaveOutcome } from '@/shared/types';
import { createBadge } from './badge';

const preview = { title: 't', site: 's', source: 'https://example.com/', medium: 'web' as const };
const saved = { state: 'saved', clip: {}, tagSuggestions: [] } as unknown as SaveOutcome;
const needsPermission: SaveOutcome = { state: 'needs-permission', preview };

/** 假的 action API：每次调用都要等若干微任务才完成，用来制造交错。 */
function fakeAction() {
  const texts: string[] = [];
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));
  return {
    texts,
    api: {
      setBadgeText: async ({ text }: { text: string }) => {
        await tick();
        texts.push(text);
      },
      setBadgeBackgroundColor: async () => {
        await tick();
      },
    },
  };
}

/** 手动触发的定时器。 */
function manualTimers() {
  const pending: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => {
      pending.push(fn);
      return pending.length;
    },
    cancel: () => {},
    fireAll: () => pending.splice(0).forEach((fn) => fn()),
  };
}

describe('角标', () => {
  it('成功后紧接着需要授权：成功的定时器触发后，角标仍是 !', async () => {
    const action = fakeAction();
    const timers = manualTimers();
    const badge = createBadge(action.api as never, timers.schedule, timers.cancel);

    const first = badge.show(saved);
    const second = badge.show(needsPermission);
    await Promise.all([first, second]);
    timers.fireAll();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(action.texts.at(-1)).toBe('!');
  });

  it('只有成功时，3 秒定时器触发后清空角标', async () => {
    const action = fakeAction();
    const timers = manualTimers();
    const badge = createBadge(action.api as never, timers.schedule, timers.cancel);

    await badge.show(saved);
    expect(action.texts.at(-1)).toBe('✓');
    timers.fireAll();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(action.texts.at(-1)).toBe('');
  });

  it('已存过不改角标，也不作废前一次的 !', async () => {
    const action = fakeAction();
    const timers = manualTimers();
    const badge = createBadge(action.api as never, timers.schedule, timers.cancel);

    await badge.show(needsPermission);
    await badge.show({ state: 'duplicate', preview, previous: {} } as unknown as SaveOutcome);
    expect(action.texts).toEqual(['!']);
  });
});
