// 保存提示 + 翻译反馈（ALAG-27 续修 2）：保存完成后先发保存提示；
// 若结果 saved 且这条剪藏有翻译任务，再把进度接到同一条提示下面。
// 逻辑独立成模块，background 注入真实的 sendToast / jobs，测试注入假实现。
import type { Capture, SaveOutcome } from '@/shared/types';

export interface ToastAfterSaveDeps {
  sendToast(tabId: number | undefined, outcome: SaveOutcome, capture?: Capture): Promise<void>;
  /** 这条剪藏是否已有翻译任务（background 用 jobs.view(clipId) !== undefined）。 */
  hasTranslation(clipId: string): boolean;
  showTranslationInTab(clipId: string, tabId: number): void;
}

export function createToastAfterSave(deps: ToastAfterSaveDeps) {
  return async (tabId: number | undefined, outcome: SaveOutcome, capture?: Capture): Promise<void> => {
    await deps.sendToast(tabId, outcome, capture);
    if (tabId !== undefined && outcome.state === 'saved' && deps.hasTranslation(outcome.clip.id)) {
      deps.showTranslationInTab(outcome.clip.id, tabId);
    }
  };
}
