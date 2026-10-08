// 工具栏图标角标：成功 ✓ 3 秒后清空；失败或需要授权 ! 保持到下一次成功；已存过不显示。
import type { SaveOutcome } from '@/shared/types';

export const BADGE_OK_COLOR = '#4257B5';
export const BADGE_ALERT_COLOR = '#C8362C';
export const BADGE_OK_MS = 3000;

type ActionApi = Pick<typeof browser.action, 'setBadgeText' | 'setBadgeBackgroundColor'>;

export interface Badge {
  show(outcome: SaveOutcome): Promise<void>;
}

export function createBadge(
  action: ActionApi = browser.action,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
  cancel: (handle: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
): Badge {
  let timer: unknown = null;
  // 每次更新领一个版本号；异步返回后、定时器触发前都核对是否仍是最新一次，旧结果不覆盖新结果。
  let version = 0;
  // 角标更新串行执行，避免两次 show 的 API 调用交错。
  let queue: Promise<void> = Promise.resolve();
  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };

  const apply = async (outcome: SaveOutcome, v: number): Promise<void> => {
    if (v !== version) return;
    switch (outcome.state) {
      case 'saved':
      case 'fallback': {
        clearTimer();
        await action.setBadgeBackgroundColor({ color: BADGE_OK_COLOR });
        await action.setBadgeText({ text: '✓' });
        if (v !== version) return;
        timer = schedule(() => {
          if (v !== version) return;
          timer = null;
          void action.setBadgeText({ text: '' });
        }, BADGE_OK_MS);
        return;
      }
      case 'failed':
      case 'needs-permission': {
        clearTimer();
        await action.setBadgeBackgroundColor({ color: BADGE_ALERT_COLOR });
        await action.setBadgeText({ text: '!' });
        return;
      }
      case 'duplicate':
        return;
    }
  };

  return {
    show(outcome) {
      // 已存过不改角标，也不让它作废前一次的结果。
      if (outcome.state === 'duplicate') return queue;
      const v = ++version;
      queue = queue.then(
        () => apply(outcome, v),
        () => apply(outcome, v),
      );
      return queue;
    },
  };
}
