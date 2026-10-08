// 每条摘录的记录：摘录 id → ClipSummary（含 quote），存在 chrome.storage.session（ALAG-4 brief B §4）。
// 写批注要找回这一条的 anchor，而后台可能在用户写批注前被 Chrome 终止。最多保留 50 条，超出丢最早的。
import type { ClipSummary } from '@/shared/types';

export const QUOTE_ENTRIES_KEY = 'quoteEntries';
export const QUOTE_ENTRIES_LIMIT = 50;

type StorageArea = Pick<Browser.storage.StorageArea, 'get' | 'set'>;

export interface QuoteEntries {
  /** 写入或更新一条（按 clip.id；更新时挪到最新）。 */
  put(clip: ClipSummary): Promise<void>;
  get(id: string): Promise<ClipSummary | undefined>;
}

export function createQuoteEntries(area: StorageArea = browser.storage.session): QuoteEntries {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };
  const read = async (): Promise<ClipSummary[]> => {
    const got = await area.get(QUOTE_ENTRIES_KEY);
    return (got[QUOTE_ENTRIES_KEY] as ClipSummary[] | undefined) ?? [];
  };
  return {
    put: (clip) =>
      serial(async () => {
        const entries = [...(await read()).filter((e) => e.id !== clip.id), clip];
        await area.set({ [QUOTE_ENTRIES_KEY]: entries.slice(-QUOTE_ENTRIES_LIMIT) });
      }),
    get: (id) => serial(async () => (await read()).find((e) => e.id === id)),
  };
}
