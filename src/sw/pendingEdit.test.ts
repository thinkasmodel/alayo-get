// 「加批注…」的待编辑记录与打开面板（ALAG-16，codex review 第 1 轮）：并发交错、条件清除、过期、活动标签页核对。
import { describe, expect, it, vi } from 'vitest';
import { createPendingEdits, openPanelForNote, PENDING_EDIT_KEY, PENDING_EDIT_TTL_MS, type NotePanelDeps, type PendingEditStorage } from './pendingEdit';

/** 复制语义的内存 storage.session：读写都深拷贝，每次调用先让出一轮宏任务，使并发操作真正交错。 */
function memoryStorage() {
  const data = new Map<string, unknown>();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const storage: PendingEditStorage = {
    get: async (key) => {
      await tick();
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    set: async (items) => {
      await tick();
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
    },
    remove: async (key) => {
      await tick();
      data.delete(key);
    },
  };
  return { storage, data };
}

describe('待编辑记录：增删串行', () => {
  it('两个标签页并发 set：两条都保留', async () => {
    const { storage } = memoryStorage();
    const pending = createPendingEdits(storage);
    await Promise.all([pending.set(1, 'A'), pending.set(2, 'B')]);
    expect(await pending.take(1)).toBe('A');
    expect(await pending.take(2)).toBe('B');
  });

  it('同一标签页并发 take 两次：只有一个拿到 clipId，另一个 null', async () => {
    const { storage } = memoryStorage();
    const pending = createPendingEdits(storage);
    await pending.set(1, 'A');
    const results = await Promise.all([pending.take(1), pending.take(1)]);
    expect(results.filter((r) => r === 'A')).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });

  it('不同标签页并发 take：不复活已删记录', async () => {
    const { storage, data } = memoryStorage();
    const pending = createPendingEdits(storage);
    await pending.set(1, 'A');
    await pending.set(2, 'B');
    expect(await Promise.all([pending.take(1), pending.take(2)])).toEqual(['A', 'B']);
    expect(data.has(PENDING_EDIT_KEY)).toBe(false);
    expect(await pending.take(1)).toBeNull();
    expect(await pending.take(2)).toBeNull();
  });

  it('条件 clear：记录已换成别的 clipId 时不删；clipId 相同才删', async () => {
    const { storage } = memoryStorage();
    const pending = createPendingEdits(storage);
    await pending.set(1, 'A');
    await pending.set(1, 'B');
    await pending.clear(1, 'A');
    expect(await pending.take(1)).toBe('B');
    await pending.set(1, 'C');
    await pending.clear(1, 'C');
    expect(await pending.take(1)).toBeNull();
  });

  it('超过 30 秒：take 返回 null 并删除记录', async () => {
    const { storage, data } = memoryStorage();
    let clock = 1_000_000;
    const pending = createPendingEdits(storage, () => clock);
    await pending.set(1, 'A');
    clock += PENDING_EDIT_TTL_MS + 1;
    expect(await pending.take(1)).toBeNull();
    expect(data.has(PENDING_EDIT_KEY)).toBe(false);
    clock -= PENDING_EDIT_TTL_MS + 1;
    expect(await pending.take(1)).toBeNull();
  });
});

describe('「加批注…」打开面板：核对发起的标签页', () => {
  function deps(active: number | undefined) {
    const pending = createPendingEdits(memoryStorage().storage);
    return {
      pending,
      queryActiveTab: vi.fn<NotePanelDeps['queryActiveTab']>(async () => active),
      openPopup: vi.fn<NotePanelDeps['openPopup']>(async () => undefined),
    } satisfies NotePanelDeps;
  }
  const tab = { id: 7, windowId: 3 };

  it('活动标签页就是发起的标签页：打开面板，回 opened: true，记录留给面板取', async () => {
    const d = deps(7);
    expect(await openPanelForNote(d, tab, 'A')).toEqual({ opened: true });
    expect(d.queryActiveTab).toHaveBeenCalledWith(3);
    expect(d.openPopup).toHaveBeenCalledWith(3);
    expect(await d.pending.take(7)).toBe('A');
  });

  it('活动标签页已换成别的：不调 openPopup，清掉记录，回 opened: false', async () => {
    const d = deps(8);
    expect(await openPanelForNote(d, tab, 'A')).toEqual({ opened: false });
    expect(d.openPopup).not.toHaveBeenCalled();
    expect(await d.pending.take(7)).toBeNull();
  });

  it('openPopup reject：清掉记录，回 opened: false', async () => {
    const d = deps(7);
    d.openPopup.mockRejectedValue(new Error('Could not find an active browser window.'));
    expect(await openPanelForNote(d, tab, 'A')).toEqual({ opened: false });
    expect(await d.pending.take(7)).toBeNull();
  });
});
