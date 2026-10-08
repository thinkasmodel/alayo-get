import { describe, expect, it, vi } from 'vitest';
import type { PanelToSw, SwToPanel } from '@/shared/messages';
import type { Capture, ClipSummary, EditFields, SaveOutcome } from '@/shared/types';
import { handlePanelPort, type PanelDeps, type PortLike } from './ports';
import type { LostEditStore } from '@/io/lostEdits';
import type { LostEdit } from '@/shared/types';

/** 假 Port：记录 postMessage，可以手动发消息、断开。 */
class FakePort<In, Out> implements PortLike<In, Out> {
  readonly sent: Out[] = [];
  private messageListeners: Array<(m: In) => void> = [];
  private disconnectListeners: Array<() => void> = [];
  constructor(readonly name: string) {}
  postMessage(message: Out): void {
    this.sent.push(message);
  }
  onMessage = { addListener: (fn: (m: In) => void) => void this.messageListeners.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => void this.disconnectListeners.push(fn) };
  send(message: In): void {
    for (const fn of this.messageListeners) fn(message);
  }
  disconnect(): void {
    for (const fn of this.disconnectListeners) fn();
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const capture: Capture = {
  url: 'https://example.com/a',
  title: '文章',
  site: '',
  author: '',
  published: '',
  description: '',
  coverUrl: '',
  markdown: '正文',
  textLength: 300,
  kind: 'page',
};

const clip: ClipSummary = {
  id: '01JPORT',
  file: '文章.md',
  title: '文章',
  medium: 'web',
  site: 'example.com',
  source: 'https://example.com/a',
  extract: 'full',
  imageCount: 0,
  imageFailures: 0,
  tags: [],
  note: '',
  savedAt: '2026-10-06T00:00:00.000Z',
};

const preview = { title: '文章', site: 'example.com', source: 'https://example.com/a', medium: 'web' as const };
const saved: SaveOutcome = { state: 'saved', clip, tagSuggestions: [] };

function panelDeps(outcome: SaveOutcome = saved) {
  const applyEdits = vi.fn(async (c: ClipSummary, fields: EditFields) => ({ ...c, ...fields }));
  const savePage = vi.fn<PanelDeps['savePage']>(async (_tabId, onState) => {
    onState({ state: 'saving', preview, progress: { phase: 'extract' } });
    return { capture, outcome };
  });
  const saveSnapshot = vi.fn<PanelDeps['saveSnapshot']>(async () => ({
    state: 'saved',
    clip: { ...clip, id: '01JSNAP', file: '文章 (2).md' },
    tagSuggestions: [],
  }));
  return { applyEdits, savePage, saveSnapshot };
}

type PanelPort = FakePort<PanelToSw, SwToPanel>;

function openPanel(deps: ReturnType<typeof panelDeps>): PanelPort {
  const port: PanelPort = new FakePort('panel');
  handlePanelPort(port, deps);
  return port;
}

describe("Port 'panel'", () => {
  it('断线重连后 resume：不重新保存，断开时把草稿写到同一条剪藏（codex review 第 8 轮）', async () => {
    const deps = { ...panelDeps(), findClip: vi.fn(async (id: string) => (id === clip.id ? clip : undefined)) };
    const port: PanelPort = new FakePort('panel');
    handlePanelPort(port, deps);
    port.send({ type: 'resume', clipId: clip.id });
    port.send({ type: 'draft', fields: { title: clip.title, tags: [], note: '重连后写的' } });
    port.disconnect();
    await flush();
    expect(deps.savePage).not.toHaveBeenCalled();
    expect(deps.applyEdits).toHaveBeenCalledTimes(1);
    expect(deps.applyEdits.mock.calls[0]?.[1]).toMatchObject({ note: '重连后写的' });
  });

  it('首次保存失败后再发 start：允许重试（codex review 第 5 轮）', async () => {
    const failed: SaveOutcome = { state: 'failed', preview, error: { name: 'NotFoundError', message: 'gone' } };
    const deps = panelDeps(failed);
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 7 });
    await flush();
    port.send({ type: 'start', tabId: 7 });
    await flush();
    expect(deps.savePage).toHaveBeenCalledTimes(2);
  });

  it('已经存成功后重复的 start 被忽略', async () => {
    const deps = panelDeps();
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 7 });
    await flush();
    port.send({ type: 'start', tabId: 7 });
    await flush();
    expect(deps.savePage).toHaveBeenCalledTimes(1);
  });

  it('start 后推送 saving 和最终 state', async () => {
    const deps = panelDeps();
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 7 });
    await flush();
    expect(deps.savePage).toHaveBeenCalledTimes(1);
    expect(deps.savePage.mock.calls[0]?.[0]).toBe(7);
    expect(port.sent.map((m) => m.type)).toEqual(['state', 'state']);
    expect(port.sent.flatMap((m) => (m.type === 'state' ? [m.state.state] : []))).toEqual(['saving', 'saved']);
  });

  it('断开时若最后的 draft 有改动，调用 applyEdits，且只调用一次', async () => {
    const deps = panelDeps();
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 1 });
    await flush();
    port.send({ type: 'draft', fields: { title: '改过的标题' } });
    port.send({ type: 'draft', fields: { note: '批注' } });
    port.disconnect();
    port.disconnect();
    await flush();
    expect(deps.applyEdits).toHaveBeenCalledTimes(1);
    expect(deps.applyEdits.mock.calls[0]).toEqual([clip, { title: '改过的标题', note: '批注' }]);
  });

  it('draft 与已存内容相同时，断开不调用 applyEdits', async () => {
    const deps = panelDeps();
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 1 });
    await flush();
    port.send({ type: 'draft', fields: { title: '文章', tags: [], note: '' } });
    port.disconnect();
    await flush();
    expect(deps.applyEdits).not.toHaveBeenCalled();
  });

  it('改了又改回去，也不调用 applyEdits', async () => {
    const deps = panelDeps();
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 1 });
    await flush();
    port.send({ type: 'draft', fields: { note: '临时' } });
    port.send({ type: 'draft', fields: { note: '' } });
    port.disconnect();
    await flush();
    expect(deps.applyEdits).not.toHaveBeenCalled();
  });

  it('保存还没结束就关闭面板：等保存结束再写入 draft', async () => {
    const deps = panelDeps();
    let finish: () => void = () => undefined;
    deps.savePage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ capture, outcome: saved });
        }),
    );
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 1 });
    port.send({ type: 'draft', fields: { note: '提前写的批注' } });
    port.disconnect();
    await flush();
    expect(deps.applyEdits).not.toHaveBeenCalled();
    finish();
    await flush();
    // 断开后不再 postMessage
    expect(port.sent).toEqual([]);
    expect(deps.applyEdits).toHaveBeenCalledTimes(1);
  });

  it('已存过时 snapshot 另存新快照，之后的 draft 写到新快照上', async () => {
    const deps = panelDeps({ state: 'duplicate', preview, previous: { ...clip } });
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 1 });
    await flush();
    port.send({ type: 'snapshot' });
    await flush();
    expect(deps.saveSnapshot).toHaveBeenCalledWith(capture, expect.any(Function));
    expect(port.sent.flatMap((m) => (m.type === 'state' ? [m.state.state] : []))).toEqual(['saving', 'duplicate', 'saved']);
    port.send({ type: 'draft', fields: { tags: ['x'] } });
    port.disconnect();
    await flush();
    expect(deps.applyEdits).toHaveBeenCalledTimes(1);
    expect(deps.applyEdits.mock.calls[0]?.[0].id).toBe('01JSNAP');
  });

  it('没有保存成功（duplicate）时，断开不写入', async () => {
    const deps = panelDeps({ state: 'duplicate', preview, previous: { ...clip } });
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 1 });
    await flush();
    port.send({ type: 'draft', fields: { note: 'x' } });
    port.disconnect();
    await flush();
    expect(deps.applyEdits).not.toHaveBeenCalled();
  });
});

describe("Port 'panel'：从页面提示「加批注…」进入编辑态（ALAG-16）", () => {
  function editDeps(found: ClipSummary | undefined, pending: string | null = clip.id) {
    return {
      ...panelDeps(),
      takePendingEdit: vi.fn<NonNullable<PanelDeps['takePendingEdit']>>(async () => pending),
      findClip: vi.fn<NonNullable<PanelDeps['findClip']>>(async (id) => (found && id === found.id ? found : undefined)),
      tagSuggestions: vi.fn<NonNullable<PanelDeps['tagSuggestions']>>(async () => [{ tag: '设计', count: 3 }]),
    };
  }

  it('有待编辑剪藏：不重新保存，推送 saved（clip.id 一致）；draft 批注后断开，applyEdits 恰好一次', async () => {
    const deps = editDeps(clip);
    const port: PanelPort = new FakePort('panel');
    handlePanelPort(port, deps);
    port.send({ type: 'start', tabId: 7 });
    await flush();
    expect(deps.takePendingEdit).toHaveBeenCalledWith(7);
    expect(deps.savePage).not.toHaveBeenCalled();
    expect(port.sent).toEqual([{ type: 'state', state: { state: 'saved', clip, tagSuggestions: [{ tag: '设计', count: 3 }] } }]);
    // 编辑态没有采集结果，snapshot 不另存
    port.send({ type: 'snapshot' });
    port.send({ type: 'start', tabId: 7 });
    port.send({ type: 'draft', fields: { title: clip.title, tags: [], note: '面板里写的批注' } });
    port.disconnect();
    await flush();
    expect(deps.saveSnapshot).not.toHaveBeenCalled();
    expect(deps.savePage).not.toHaveBeenCalled();
    expect(deps.applyEdits).toHaveBeenCalledTimes(1);
    expect(deps.applyEdits.mock.calls[0]?.[0].id).toBe(clip.id);
    expect(deps.applyEdits.mock.calls[0]?.[1]).toMatchObject({ note: '面板里写的批注' });
  });

  it('待编辑剪藏找不到（findClip 返回 undefined）：照常保存当前页', async () => {
    const deps = editDeps(undefined);
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 7 });
    await flush();
    expect(deps.findClip).toHaveBeenCalledWith(clip.id);
    expect(deps.savePage).toHaveBeenCalledTimes(1);
    expect(port.sent.flatMap((m) => (m.type === 'state' ? [m.state.state] : []))).toEqual(['saving', 'saved']);
  });

  it('没有待编辑剪藏：照常保存当前页', async () => {
    const deps = editDeps(clip, null);
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 7 });
    await flush();
    expect(deps.findClip).not.toHaveBeenCalled();
    expect(deps.savePage).toHaveBeenCalledTimes(1);
  });

  it('读取待编辑记录出错：照常保存当前页，不卡在已开始', async () => {
    const deps = editDeps(clip);
    deps.takePendingEdit.mockRejectedValue(new Error('storage.session 不可用'));
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 7 });
    await flush();
    expect(deps.savePage).toHaveBeenCalledTimes(1);
  });

  it('书签剪藏（extract: fallback、medium: link）：推送 fallback', async () => {
    const bookmark: ClipSummary = { ...clip, medium: 'link', extract: 'fallback' };
    const deps = editDeps(bookmark);
    const port = openPanel(deps);
    port.send({ type: 'start', tabId: 7 });
    await flush();
    expect(deps.savePage).not.toHaveBeenCalled();
    expect(port.sent.flatMap((m) => (m.type === 'state' ? [m.state.state] : []))).toEqual(['fallback']);
  });
});

describe("Port 'panel'：写回失败可见、草稿可恢复（ALAG-20）", () => {
  const open = (deps: PanelDeps): PanelPort => {
    const port: PanelPort = new FakePort('panel');
    handlePanelPort(port, deps);
    return port;
  };
  const notFound = () => Object.assign(new Error('找不到文件'), { name: 'NotFoundError' });

  /** 内存里的草稿列表，方法都是 spy。 */
  function memoryLostEdits(initial: LostEdit[] = []) {
    let edits = [...initial];
    return {
      list: vi.fn(async () => edits.map((e) => ({ ...e }))),
      add: vi.fn(async (edit: LostEdit) => {
        edits.push(edit);
      }),
      update: vi.fn(async (edit: LostEdit) => {
        edits = edits.map((e) => (e.id === edit.id ? edit : e));
      }),
      remove: vi.fn(async (id: string) => {
        edits = edits.filter((e) => e.id !== id);
      }),
    } satisfies LostEditStore;
  }

  const stored: LostEdit = {
    id: 'L1',
    clip,
    fields: { note: '没写进去的批注' },
    error: { name: 'NotFoundError', message: 'gone' },
    at: '2026-10-08T00:00:00.000Z',
  };

  const lostMessages = (port: PanelPort) => port.sent.flatMap((m) => (m.type === 'lost-edits' ? [m] : []));
  const states = (port: PanelPort) => port.sent.flatMap((m) => (m.type === 'state' ? [m.state] : []));

  it('有待编辑剪藏且 checkClip 回 ok: false：推送 clip-unavailable，不保存当前页；之后 draft + 断开不写回', async () => {
    const error = { name: 'NotFoundError', message: 'gone' };
    const deps = {
      ...panelDeps(),
      takePendingEdit: vi.fn<NonNullable<PanelDeps['takePendingEdit']>>(async () => clip.id),
      findClip: vi.fn<NonNullable<PanelDeps['findClip']>>(async () => clip),
      checkClip: vi.fn<NonNullable<PanelDeps['checkClip']>>(async () => ({ ok: false, clip, error })),
    };
    const port = open(deps);
    port.send({ type: 'start', tabId: 7 });
    await flush();
    expect(deps.checkClip).toHaveBeenCalledWith(clip.id);
    expect(deps.savePage).not.toHaveBeenCalled();
    const [state] = states(port);
    expect(state?.state).toBe('clip-unavailable');
    if (state?.state !== 'clip-unavailable') return;
    expect(state.clip.id).toBe(clip.id);
    expect(state.error.name).toBe('NotFoundError');
    port.send({ type: 'start', tabId: 7 });
    port.send({ type: 'draft', fields: { note: '不该写回' } });
    port.disconnect();
    await flush();
    expect(deps.savePage).not.toHaveBeenCalled();
    expect(deps.applyEdits).not.toHaveBeenCalled();
  });

  it('checkClip 回 ok: false 但原因是其他错误（权限收回）：照常保存当前页', async () => {
    const deps = {
      ...panelDeps(),
      takePendingEdit: vi.fn<NonNullable<PanelDeps['takePendingEdit']>>(async () => clip.id),
      checkClip: vi.fn<NonNullable<PanelDeps['checkClip']>>(async () => ({ ok: false, clip, error: { name: 'NotAllowedError', message: 'denied' } })),
    };
    const port = open(deps);
    port.send({ type: 'start', tabId: 7 });
    await flush();
    expect(deps.savePage).toHaveBeenCalledTimes(1);
    expect(states(port).map((s) => s.state)).toEqual(['saving', 'saved']);
  });

  it('连接后不等 start 就推送 lost-edits（列表全量）', async () => {
    const lostEdits = memoryLostEdits([stored, { ...stored, id: 'L2' }]);
    const port = open({ ...panelDeps(), lostEdits });
    await flush();
    expect(port.sent).toEqual([{ type: 'lost-edits', edits: [stored, { ...stored, id: 'L2' }], notices: [] }]);
  });

  it('断开时 applyEdits 抛 NotFoundError：记下一条草稿，fields 只含改过的字段，onLostEditsChanged(1)', async () => {
    const lostEdits = memoryLostEdits();
    const onLostEditsChanged = vi.fn();
    const deps = {
      ...panelDeps(),
      lostEdits,
      onLostEditsChanged,
      newId: () => 'NEW',
      now: () => new Date('2026-10-08T01:02:03.000Z'),
    };
    deps.applyEdits.mockRejectedValue(notFound());
    const port = open(deps);
    port.send({ type: 'start', tabId: 1 });
    await flush();
    port.send({ type: 'draft', fields: { title: clip.title, tags: [], note: '改了批注' } });
    port.disconnect();
    await flush();
    expect(lostEdits.add).toHaveBeenCalledTimes(1);
    expect(lostEdits.add.mock.calls[0]?.[0]).toEqual({
      id: 'NEW',
      clip,
      fields: { note: '改了批注' },
      error: { name: 'NotFoundError', message: '找不到文件' },
      at: '2026-10-08T01:02:03.000Z',
    });
    expect(onLostEditsChanged).toHaveBeenCalledWith(1);
  });

  it('lost-edit retry 成功：删掉这条，推送的 notices 含 written 与写入的文件名', async () => {
    const lostEdits = memoryLostEdits([stored]);
    const onLostEditsChanged = vi.fn();
    const deps = { ...panelDeps(), lostEdits, onLostEditsChanged };
    const port = open(deps);
    port.send({ type: 'lost-edit', action: 'retry', id: 'L1' });
    await flush();
    expect(deps.applyEdits).toHaveBeenCalledWith(clip, { note: '没写进去的批注' });
    expect(lostEdits.remove).toHaveBeenCalledWith('L1');
    expect(lostMessages(port).at(-1)).toEqual({ type: 'lost-edits', edits: [], notices: [{ id: 'L1', kind: 'written', file: clip.file }] });
    expect(onLostEditsChanged).toHaveBeenLastCalledWith(0);
  });

  it('lost-edit retry 失败：仍在列表里，error 已更新', async () => {
    const lostEdits = memoryLostEdits([stored]);
    const deps = { ...panelDeps(), lostEdits, onLostEditsChanged: vi.fn() };
    deps.applyEdits.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const port = open(deps);
    port.send({ type: 'lost-edit', action: 'retry', id: 'L1' });
    await flush();
    expect(lostEdits.remove).not.toHaveBeenCalled();
    const last = lostMessages(port).at(-1);
    expect(last?.edits).toEqual([{ ...stored, error: { name: 'NotAllowedError', message: 'denied' } }]);
    expect(last?.notices).toEqual([]);
    expect(deps.onLostEditsChanged).toHaveBeenLastCalledWith(1);
  });

  it('lost-edit file：fileLostEdit 调一次，删掉这条，notices 含 filed 与草稿文件名', async () => {
    const lostEdits = memoryLostEdits([stored]);
    const fileLostEdit = vi.fn(async () => '批注草稿 - 文章.md');
    const port = open({ ...panelDeps(), lostEdits, fileLostEdit });
    port.send({ type: 'lost-edit', action: 'file', id: 'L1' });
    await flush();
    expect(fileLostEdit).toHaveBeenCalledTimes(1);
    expect(fileLostEdit).toHaveBeenCalledWith(stored);
    expect(lostEdits.remove).toHaveBeenCalledWith('L1');
    expect(lostMessages(port).at(-1)?.notices).toEqual([{ id: 'L1', kind: 'filed', file: '批注草稿 - 文章.md' }]);
  });

  it('lost-edit discard：删掉这条，onLostEditsChanged(0)；找不到的 id 忽略', async () => {
    const lostEdits = memoryLostEdits([stored]);
    const onLostEditsChanged = vi.fn();
    const port = open({ ...panelDeps(), lostEdits, onLostEditsChanged });
    port.send({ type: 'lost-edit', action: 'discard', id: 'nope' });
    await flush();
    expect(lostEdits.remove).not.toHaveBeenCalled();
    port.send({ type: 'lost-edit', action: 'discard', id: 'L1' });
    await flush();
    expect(lostEdits.remove).toHaveBeenCalledWith('L1');
    expect(onLostEditsChanged).toHaveBeenCalledWith(0);
    expect(lostMessages(port).at(-1)).toEqual({ type: 'lost-edits', edits: [], notices: [] });
  });
});
