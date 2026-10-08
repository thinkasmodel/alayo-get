// 关闭面板写回失败后留下的草稿（ALAG-20），存在 chrome.storage.local（后台被终止、浏览器重启后仍在）。
// 按失败时间（即插入顺序）存成数组，最多 10 条，超出丢最早的；所有读改写经同一条 promise 链串行。
import type { LostEdit } from '@/shared/types';

export const LOST_EDITS_KEY = 'lostEdits';
export const LOST_EDITS_LIMIT = 10;

type StorageArea = Pick<Browser.storage.StorageArea, 'get' | 'set'>;

export interface LostEditStore {
  list(): Promise<LostEdit[]>;
  /** 追加一条；超过 10 条丢最早的。 */
  add(edit: LostEdit): Promise<void>;
  /** 按 id 原位替换；没有这条（已被删掉）就不做任何事，不复活。 */
  update(edit: LostEdit): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createLostEdits(area: StorageArea = browser.storage.local): LostEditStore {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };
  const read = async (): Promise<LostEdit[]> => {
    const value = (await area.get(LOST_EDITS_KEY))[LOST_EDITS_KEY];
    return Array.isArray(value) ? (value as LostEdit[]) : [];
  };
  const write = (edits: LostEdit[]) => area.set({ [LOST_EDITS_KEY]: edits.slice(-LOST_EDITS_LIMIT) });

  return {
    list: () => serial(read),
    add: (edit) => serial(async () => write([...(await read()), edit])),
    update: (edit) =>
      serial(async () => {
        const edits = await read();
        const at = edits.findIndex((e) => e.id === edit.id);
        if (at === -1) return;
        edits[at] = edit;
        await write(edits);
      }),
    remove: (id) => serial(async () => write((await read()).filter((e) => e.id !== id))),
  };
}
