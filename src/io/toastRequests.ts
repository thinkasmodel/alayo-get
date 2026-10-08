// 页面提示对应的采集结果：requestId → Capture，存在 chrome.storage.session，
// 后台被 Chrome 终止、重启后仍能按提示重放同一份内容（codex review 第 7 轮）。最多保留 20 条。
import type { Capture } from '@/shared/types';

export const TOAST_REQUESTS_KEY = 'toastRequests';
export const TOAST_REQUESTS_LIMIT = 20;

type StorageArea = Pick<Browser.storage.StorageArea, 'get' | 'set'>;
type Entry = { id: string; capture: Capture };

export interface ToastRequests {
  put(id: string, capture: Capture): Promise<void>;
  get(id: string): Promise<Capture | undefined>;
}

export function createToastRequests(area: StorageArea = browser.storage.session): ToastRequests {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };
  const read = async (): Promise<Entry[]> => {
    const got = await area.get(TOAST_REQUESTS_KEY);
    return (got[TOAST_REQUESTS_KEY] as Entry[] | undefined) ?? [];
  };
  return {
    put: (id, capture) =>
      serial(async () => {
        const entries = [...(await read()).filter((e) => e.id !== id), { id, capture }];
        await area.set({ [TOAST_REQUESTS_KEY]: entries.slice(-TOAST_REQUESTS_LIMIT) });
      }),
    get: (id) => serial(async () => (await read()).find((e) => e.id === id)?.capture),
  };
}
