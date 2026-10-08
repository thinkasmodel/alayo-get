// 授权暂存队列：chrome.storage.session 的 `pendingSaves`，最多 20 条，超出丢最早的（ADR-0004）。
import type { PendingSave } from '@/shared/types';

export const PENDING_KEY = 'pendingSaves';
export const PENDING_LIMIT = 20;

export interface PendingQueue {
  list(): Promise<PendingSave[]>;
  push(item: PendingSave): Promise<void>;
  /** 移除与 item 内容相同的第一条。 */
  remove(item: PendingSave): Promise<void>;
}

type StorageArea = Pick<Browser.storage.StorageArea, 'get' | 'set'>;

function sameItem(a: PendingSave, b: PendingSave): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createPendingQueue(area: StorageArea = browser.storage.session): PendingQueue {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  const read = async (): Promise<PendingSave[]> => {
    const got = await area.get(PENDING_KEY);
    return (got[PENDING_KEY] as PendingSave[] | undefined) ?? [];
  };

  return {
    list: () => serial(read),
    push: (item) =>
      serial(async () => {
        const items = [...(await read()), item];
        await area.set({ [PENDING_KEY]: items.slice(-PENDING_LIMIT) });
      }),
    remove: (item) =>
      serial(async () => {
        const items = await read();
        const i = items.findIndex((x) => sameItem(x, item));
        if (i === -1) return;
        items.splice(i, 1);
        await area.set({ [PENDING_KEY]: items });
      }),
  };
}
