// 已保存记录：chrome.storage.local 的 `savedIndex`，规范化出处 → 最新一条 SavedEntry。
import type { SavedEntry, SavedIndexData } from '@/shared/types';

export const SAVED_INDEX_KEY = 'savedIndex';

export interface SavedIndex {
  all(): Promise<SavedIndexData>;
  get(source: string): Promise<SavedEntry | undefined>;
  /** 写入一条（另存快照时用最新的覆盖）。 */
  put(source: string, entry: SavedEntry): Promise<void>;
  /** 按 id 更新那条记录；记录已被更新的快照覆盖时不动。 */
  updateById(source: string, id: string, patch: Partial<Omit<SavedEntry, 'id' | 'source'>>): Promise<void>;
}

type StorageArea = Pick<Browser.storage.StorageArea, 'get' | 'set'>;

export function createSavedIndex(area: StorageArea = browser.storage.local): SavedIndex {
  // 读改写串行化，避免并发保存互相覆盖。
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  const read = async (): Promise<SavedIndexData> => {
    const got = await area.get(SAVED_INDEX_KEY);
    return (got[SAVED_INDEX_KEY] as SavedIndexData | undefined) ?? {};
  };

  return {
    all: () => serial(read),
    get: (source) => serial(async () => (await read())[source]),
    put: (source, entry) =>
      serial(async () => {
        const data = await read();
        data[source] = entry;
        await area.set({ [SAVED_INDEX_KEY]: data });
      }),
    updateById: (source, id, patch) =>
      serial(async () => {
        const data = await read();
        const current = data[source];
        if (!current || current.id !== id) return;
        data[source] = { ...current, ...patch };
        await area.set({ [SAVED_INDEX_KEY]: data });
      }),
  };
}
