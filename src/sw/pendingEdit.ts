// 页面提示「加批注…」→ 工具栏面板编辑态（ALAG-16，ADR-0008）：service worker 一侧。
// 待编辑记录存 storage.session（tabId → 剪藏 id 与记下的时刻），面板 start 时取出；记录的增删全部串行。
import type { ToastActionResponse } from '@/shared/messages';

export const PENDING_EDIT_KEY = 'pendingNoteEdit';
/** 记下后超过这么久才打开面板的，视为过期，面板照常保存当前页。 */
export const PENDING_EDIT_TTL_MS = 30_000;

type Records = Record<string, { clipId: string; at: number }>;

/** storage.session 里用到的三个方法（生产传 browser.storage.session，测试传内存桩）。 */
export interface PendingEditStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PendingEdits {
  /** 记下 tabId 要编辑 clipId 这条剪藏（覆盖这个标签页之前的记录）。 */
  set(tabId: number, clipId: string): Promise<void>;
  /** 只在 tabId 的记录仍是 clipId 时删除，不误删之后另一次请求记下的。 */
  clear(tabId: number, clipId: string): Promise<void>;
  /** 取出并删掉 tabId 的记录；没有或已过期返回 null。 */
  take(tabId: number): Promise<string | null>;
}

export function createPendingEdits(storage: PendingEditStorage, now: () => number = () => Date.now()): PendingEdits {
  // 每个操作都是完整的「读 → 改 → 写」，经同一条 promise 链一个接一个跑，并发请求不会互相覆盖（codex review ALAG-16 第 1 轮）
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };
  const read = async (): Promise<Records> => {
    const value = (await storage.get(PENDING_EDIT_KEY))[PENDING_EDIT_KEY];
    return value && typeof value === 'object' ? { ...(value as Records) } : {};
  };
  const write = async (records: Records): Promise<void> => {
    if (Object.keys(records).length === 0) await storage.remove(PENDING_EDIT_KEY);
    else await storage.set({ [PENDING_EDIT_KEY]: records });
  };

  return {
    set: (tabId, clipId) =>
      serial(async () => {
        const records = await read();
        records[String(tabId)] = { clipId, at: now() };
        await write(records);
      }),
    clear: (tabId, clipId) =>
      serial(async () => {
        const records = await read();
        if (records[String(tabId)]?.clipId !== clipId) return;
        delete records[String(tabId)];
        await write(records);
      }),
    take: (tabId) =>
      serial(async () => {
        const records = await read();
        const entry = records[String(tabId)];
        if (!entry) return null;
        delete records[String(tabId)];
        await write(records);
        return now() - entry.at > PENDING_EDIT_TTL_MS ? null : entry.clipId;
      }),
  };
}

export interface NotePanelDeps {
  pending: PendingEdits;
  /** windowId 这个窗口里的活动标签页 id；取不到时 undefined。 */
  queryActiveTab(windowId: number): Promise<number | undefined>;
  openPopup(windowId: number): Promise<void>;
}

/**
 * 「加批注…」：记下待编辑剪藏，核对发起提示的标签页仍是该窗口的活动标签页，再打开工具栏面板。
 * 面板打开后按当前活动标签页发 start；活动标签页已换成别的（等写入时用户切了标签页），面板会去保存那一页，
 * 所以这时不打开，回 opened: false，页面提示据此说明。核对之后到 openPopup 之间的极短时间内切换标签页的情况仍可能发生（已知残余）。
 * 打不开或出错时按 clipId 条件清掉记录。
 */
export async function openPanelForNote(deps: NotePanelDeps, tab: { id: number; windowId: number }, clipId: string): Promise<ToastActionResponse> {
  const giveUp = async (): Promise<ToastActionResponse> => {
    await deps.pending.clear(tab.id, clipId).catch((err: unknown) => console.warn('[Alayo Get] 清除待编辑记录失败', err));
    return { opened: false };
  };
  try {
    await deps.pending.set(tab.id, clipId);
    const active = await deps.queryActiveTab(tab.windowId);
    if (active !== tab.id) {
      console.warn('[Alayo Get] 发起「加批注…」的标签页已不是活动标签页，不打开面板', { tabId: tab.id, active });
      return await giveUp();
    }
    await deps.openPopup(tab.windowId);
    return { opened: true };
  } catch (err) {
    console.warn('[Alayo Get] 打开面板失败', err);
    return giveUp();
  }
}
