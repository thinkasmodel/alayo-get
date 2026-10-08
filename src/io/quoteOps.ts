// 已落盘的摘录操作：opId → ClipSummary，存在 chrome.storage.local（ALAG-4 摘录幂等）。
// 摘录写进文件后、暂存队列出队前后台可能被终止，再次补写时按 opId 认出这一条已经写过，不重复追加。最多保留最近 200 条。
import type { ClipSummary } from '@/shared/types';

export const QUOTE_OPS_KEY = 'quoteOpsApplied';
export const QUOTE_OPS_LIMIT = 200;

type StorageArea = Pick<Browser.storage.StorageArea, 'get' | 'set'>;

export interface QuoteOps {
  get(opId: string): Promise<ClipSummary | undefined>;
  /** 记一条（同 opId 更新并挪到最新）。 */
  put(opId: string, clip: ClipSummary): Promise<void>;
  /** 按摘录 id（ClipSummary.id）找回：storage.session 的摘录记录缺失时，写批注靠它（codex review 第 5 轮）。 */
  findByClipId(clipId: string): Promise<ClipSummary | undefined>;
}

export function createQuoteOps(area: StorageArea = browser.storage.local): QuoteOps {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };
  // 表按插入顺序存成 [opId, clip] 数组，超出时丢最早的
  const read = async (): Promise<Array<[string, ClipSummary]>> => {
    const got = await area.get(QUOTE_OPS_KEY);
    return (got[QUOTE_OPS_KEY] as Array<[string, ClipSummary]> | undefined) ?? [];
  };
  return {
    get: (opId) => serial(async () => (await read()).find(([id]) => id === opId)?.[1]),
    findByClipId: (clipId) => serial(async () => (await read()).find(([, clip]) => clip.id === clipId)?.[1]),
    put: (opId, clip) =>
      serial(async () => {
        const entries = [...(await read()).filter(([id]) => id !== opId), [opId, clip] as [string, ClipSummary]];
        await area.set({ [QUOTE_OPS_KEY]: entries.slice(-QUOTE_OPS_LIMIT) });
      }),
  };
}
