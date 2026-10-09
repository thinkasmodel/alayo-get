// 工具栏图标角标：成功 ✓ 3 秒后清空；失败或需要授权 ! 保持到下一次成功；已存过不显示。
// 有写回失败留下的草稿时（ALAG-20）保持 !，期间保存成功的 ✓ 显示 3 秒后回到 !。
import type { SaveOutcome } from '@/shared/types';

export const BADGE_OK_COLOR = '#4257B5';
export const BADGE_ALERT_COLOR = '#C8362C';
export const BADGE_OK_MS = 3000;

type ActionApi = Pick<typeof browser.action, 'setBadgeText' | 'setBadgeBackgroundColor'>;

export interface Badge {
  show(outcome: SaveOutcome): Promise<void>;
  /** 有未处理的草稿时为 true：显示 !，直到草稿处理完（ALAG-20）。 */
  setSticky(on: boolean): Promise<void>;
}

export function createBadge(
  action: ActionApi = browser.action,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
  cancel: (handle: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
): Badge {
  let timer: unknown = null;
  // 每次 show 领一个版本号；异步返回后、定时器触发前都核对是否仍是最新一次，旧结果不覆盖新结果。
  // setSticky 不领版本号（否则会作废正在显示的 ✓ 的定时器），只进同一条队列。
  let version = 0;
  // 角标更新串行执行，避免两次更新的 API 调用交错。
  let queue: Promise<void> = Promise.resolve();
  /** 有未处理的草稿。 */
  let sticky = false;
  /** 当前角标上的 ! 从哪来：保存失败或需要授权（failed），还是草稿（sticky）；没有 ! 为 none。 */
  let alert: 'none' | 'failed' | 'sticky' = 'none';
  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task, task);
    return queue;
  };
  const showAlert = async (): Promise<void> => {
    await action.setBadgeBackgroundColor({ color: BADGE_ALERT_COLOR });
    await action.setBadgeText({ text: '!' });
  };

  /** ✓ 到点：有草稿时回到 !，否则清空。 */
  const expire = async (v: number): Promise<void> => {
    if (v !== version || timer !== null) return;
    if (sticky) {
      alert = 'sticky';
      await showAlert();
    } else {
      alert = 'none';
      await action.setBadgeText({ text: '' });
    }
  };

  const apply = async (outcome: SaveOutcome, v: number): Promise<void> => {
    if (v !== version) return;
    switch (outcome.state) {
      case 'saved':
      case 'fallback': {
        clearTimer();
        alert = 'none';
        await action.setBadgeBackgroundColor({ color: BADGE_OK_COLOR });
        await action.setBadgeText({ text: '✓' });
        if (v !== version) return;
        timer = schedule(() => {
          if (v !== version) return;
          timer = null;
          enqueue(() => expire(v)).catch((err: unknown) => console.error('[Alayo Get] 角标更新失败', err));
        }, BADGE_OK_MS);
        return;
      }
      case 'failed':
      case 'needs-permission': {
        clearTimer();
        alert = 'failed';
        await showAlert();
        return;
      }
      case 'duplicate':
        return;
    }
  };

  const applySticky = async (): Promise<void> => {
    if (sticky) {
      // ✓ 还在显示就等它到点；已经是 ! 的不动
      if (timer !== null || alert !== 'none') return;
      alert = 'sticky';
      await showAlert();
    } else if (alert === 'sticky') {
      // 只清草稿带来的 !；保存失败带来的 ! 保持到下一次成功
      alert = 'none';
      await action.setBadgeText({ text: '' });
    }
  };

  return {
    show(outcome) {
      // 已存过不改角标，也不让它作废前一次的结果。
      if (outcome.state === 'duplicate') return queue;
      const v = ++version;
      return enqueue(() => apply(outcome, v));
    },
    setSticky(on) {
      sticky = on;
      return enqueue(applySticky);
    },
  };
}
