import { describe, expect, it, vi } from 'vitest';
import type { PanelToSw, SwToPanel, SwToToastNote, ToastNoteToSw } from '@/shared/messages';
import type { Capture, ClipSummary, EditFields, SaveOutcome } from '@/shared/types';
import { handlePanelPort, handleToastNotePort, type PanelDeps, type PortLike, type ToastNoteDeps } from './ports';

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
    expect(port.sent.map((m) => m.state.state)).toEqual(['saving', 'saved']);
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
    expect(port.sent.map((m) => m.state.state)).toEqual(['saving', 'duplicate', 'saved']);
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

describe("Port 'toast-note'", () => {
  function toastDeps() {
    const applyEdits = vi.fn<ToastNoteDeps['applyEdits']>(async (c, fields) => ({ ...c, ...fields }));
    const findClip = vi.fn<ToastNoteDeps['findClip']>(async (id) => (id === clip.id ? clip : undefined));
    return { applyEdits, findClip };
  }
  type ToastPort = FakePort<ToastNoteToSw, never>;

  it('收到 commit 后再断开，只写一次，写的是最后一次 draft', async () => {
    const deps = toastDeps();
    const port: ToastPort = new FakePort('toast-note');
    handleToastNotePort(port, deps);
    port.send({ type: 'draft', clipId: clip.id, note: '第一' });
    port.send({ type: 'draft', clipId: clip.id, note: '第一版批注' });
    port.send({ type: 'commit' });
    port.disconnect();
    await flush();
    expect(deps.applyEdits).toHaveBeenCalledTimes(1);
    expect(deps.applyEdits.mock.calls[0]).toEqual([clip, { note: '第一版批注' }]);
  });

  it('没有 commit 直接断开（页面跳走）也写入', async () => {
    const deps = toastDeps();
    const port: ToastPort = new FakePort('toast-note');
    handleToastNotePort(port, deps);
    port.send({ type: 'draft', clipId: clip.id, note: '跳走前' });
    port.disconnect();
    await flush();
    expect(deps.applyEdits).toHaveBeenCalledTimes(1);
  });

  it('commit 写入成功后回复 committed；写入失败回复 commit-failed，且允许再提交（codex review 第 7 轮）', async () => {
    const deps = toastDeps();
    let failOnce = true;
    deps.applyEdits.mockImplementation(async (c, fields) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('剪藏库没有写入权限（prompt）');
      }
      return { ...c, ...fields };
    });
    const port = new FakePort<ToastNoteToSw, SwToToastNote>('toast-note');
    handleToastNotePort(port, deps);
    port.send({ type: 'draft', clipId: clip.id, note: '批注' });
    port.send({ type: 'commit' });
    await flush();
    expect(port.sent).toEqual([{ type: 'commit-failed', message: '剪藏库没有写入权限（prompt）' }]);
    port.send({ type: 'commit' });
    await flush();
    expect(port.sent.at(-1)).toEqual({ type: 'committed', note: '批注' });
    expect(deps.applyEdits).toHaveBeenCalledTimes(2);
  });

  it('写入还在进行时重复 commit：等前一次写完再判断，写入失败时不会先回复成功（codex review 第 8 轮）', async () => {
    const deps = toastDeps();
    let release: () => void = () => {};
    deps.applyEdits.mockImplementation(
      () =>
        new Promise((_, reject) => {
          release = () => reject(new Error('被锁挡住后失败'));
        }),
    );
    const port = new FakePort<ToastNoteToSw, SwToToastNote>('toast-note');
    handleToastNotePort(port, deps);
    port.send({ type: 'draft', clipId: clip.id, note: '慢批注' });
    port.send({ type: 'commit' });
    await flush();
    port.send({ type: 'commit' });
    await flush();
    expect(port.sent).toEqual([]);
    release();
    await flush();
    await flush();
    expect(port.sent.every((m) => m.type === 'commit-failed')).toBe(true);
  });

  it('没有 draft 或批注没变时不写', async () => {
    const deps = toastDeps();
    const a: ToastPort = new FakePort('toast-note');
    handleToastNotePort(a, deps);
    a.send({ type: 'commit' });
    a.disconnect();
    const b: ToastPort = new FakePort('toast-note');
    handleToastNotePort(b, deps);
    b.send({ type: 'draft', clipId: clip.id, note: '' });
    b.disconnect();
    await flush();
    expect(deps.applyEdits).not.toHaveBeenCalled();
  });
});
