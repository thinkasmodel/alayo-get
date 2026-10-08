// 页面提示批注通道的端到端（ALAG-4 brief B §4、§6）：handleToastNotePort + ClipBook.findClip / editClip + MemoryLibrary。
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createPendingQueue } from '@/io/pending';
import { createQuoteEntries } from '@/io/quoteEntries';
import { createQuoteOps } from '@/io/quoteOps';
import { createSavedIndex, type SavedIndex } from '@/io/savedIndex';
import type { SwToToastNote, ToastNoteToSw } from '@/shared/messages';
import type { ClipSummary } from '@/shared/types';
import { createClipBook, type ClipBook } from './clips';
import { handleToastNotePort, type PortLike } from './ports';
import { quoteCapture } from './route';
import { saveClip } from './saveClip';

const PAGE = 'https://sspai.com/post/90001';
const FILE = '摘录 - 慢思考.md';

class FakePort implements PortLike<ToastNoteToSw, SwToToastNote> {
  readonly name = 'toast-note';
  readonly sent: SwToToastNote[] = [];
  private messageListeners: Array<(m: ToastNoteToSw) => void> = [];
  private disconnectListeners: Array<() => void> = [];
  postMessage(message: SwToToastNote): void {
    this.sent.push(message);
  }
  onMessage = { addListener: (fn: (m: ToastNoteToSw) => void) => void this.messageListeners.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => void this.disconnectListeners.push(fn) };
  send(message: ToastNoteToSw): void {
    for (const fn of this.messageListeners) fn(message);
  }
}

let library: MemoryLibrary;
let index: SavedIndex;
let n: number;

const newBook = (): ClipBook => createClipBook({ index, quotes: createQuoteEntries(), library: () => library });

/** 在同一页面存 3 条摘录，记进 book（如同 background 的 afterOutcome），返回 3 条的剪藏信息。 */
async function saveThree(book: ClipBook): Promise<ClipSummary[]> {
  const deps = { library, index, pending: createPendingQueue(), fetch: async () => new Response(), now: () => new Date(), newId: () => `ID${++n}` };
  const out: ClipSummary[] = [];
  for (const [i, text] of ['第一条。', '第二条。', '第三条。'].entries()) {
    const outcome = await saveClip({ capture: quoteCapture(PAGE, '慢思考', { markdown: text, fragmentUrl: `${PAGE}#:~:text=${i}`, selectedAt: `2026-10-07T08:3${i}:00.000Z` }), snapshot: false }, deps);
    if (outcome.state !== 'saved') throw new Error('没有存成功');
    await book.remember(outcome.clip, library);
    out.push(outcome.clip);
  }
  return out;
}

/** 经一条新的批注 Port 提交批注，等到后台回复。 */
async function commitNote(book: ClipBook, clipId: string, note: string): Promise<SwToToastNote> {
  const port = new FakePort();
  handleToastNotePort(port, { findClip: book.findClip, applyEdits: book.editClip });
  port.send({ type: 'draft', clipId, note });
  port.send({ type: 'commit' });
  for (let i = 0; i < 50 && port.sent.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
  const reply = port.sent[0];
  if (!reply) throw new Error('后台没有回复');
  return reply;
}

beforeEach(() => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  index = createSavedIndex();
  n = 0;
});

describe('页面提示批注 → 摘录文件（端到端）', () => {
  it('写批注 abc 出现在这一条下面；再提交空批注，批注区被移除（摘录不按 frontmatter 的空 note 覆盖）', async () => {
    const book = newBook();
    const [, second] = await saveThree(book);
    if (!second?.quote) throw new Error('缺少摘录');
    const original = library.text(FILE) ?? '';

    expect(await commitNote(book, second.id, 'abc')).toEqual({ type: 'committed', note: 'abc' });
    expect(library.text(FILE)).toBe(original.replace(`${second.quote.anchor}\n`, `${second.quote.anchor}\n\nabc\n`));

    expect(await commitNote(book, second.id, '')).toEqual({ type: 'committed', note: '' });
    expect(library.text(FILE)).toBe(original);
  });

  it('后台重启（内存记录清空）后，凭摘录 id 从 storage.session 的摘录记录找回并写批注、再清空', async () => {
    const [first] = await saveThree(newBook());
    if (!first?.quote) throw new Error('缺少摘录');
    const original = library.text(FILE) ?? '';

    const restarted = newBook();
    const found = await restarted.findClip(first.id);
    expect(found).toMatchObject({ id: first.id, file: FILE, note: '', quote: first.quote });

    expect(await commitNote(restarted, first.id, '重启后写的批注')).toMatchObject({ type: 'committed' });
    expect(library.text(FILE)).toContain(`${first.quote.anchor}\n\n重启后写的批注\n\n> 第二条。`);

    // 再重启一次：记录里的批注已更新，清空能判出改动并移除
    const again = newBook();
    expect((await again.findClip(first.id))?.note).toBe('重启后写的批注');
    expect(await commitNote(again, first.id, '')).toEqual({ type: 'committed', note: '' });
    expect(library.text(FILE)).toBe(original);
  });

  it('非摘录剪藏照旧：重启后从已保存记录找回，按文件里的批注刷新', async () => {
    const book = newBook();
    const deps = { library, index, pending: createPendingQueue(), fetch: async () => new Response(), now: () => new Date(), newId: () => `ID${++n}` };
    const outcome = await saveClip(
      { capture: { url: PAGE, title: '文章', site: '', author: '', published: '', description: '', coverUrl: '', markdown: '正文。', textLength: 300, kind: 'page' }, snapshot: false },
      deps,
    );
    if (outcome.state !== 'saved') throw new Error('没有存成功');
    await book.remember(outcome.clip, library);
    await commitNote(book, outcome.clip.id, '文章批注');
    const found = await newBook().findClip(outcome.clip.id);
    expect(found).toMatchObject({ id: outcome.clip.id, file: '文章.md', note: '文章批注' });
    expect(found?.quote).toBeUndefined();
  });

  it('摘录批注以文件为准：文件里已有批注、会话记录里是空串（文件写成功、会话写失败）→ 重启后提交空批注能移除批注区', async () => {
    const book = newBook();
    const [first] = await saveThree(book);
    if (!first?.quote) throw new Error('缺少摘录');
    const original = library.text(FILE) ?? '';
    expect(await commitNote(book, first.id, 'abc')).toEqual({ type: 'committed', note: 'abc' });
    expect(library.text(FILE)).toContain(`${first.quote.anchor}\n\nabc\n`);

    // 模拟会话写失败：storage.session 里这一条的 note 回到空串
    await createQuoteEntries().put({ ...first, note: '' });

    const restarted = newBook();
    expect((await restarted.findClip(first.id))?.note).toBe('abc');
    expect(await commitNote(restarted, first.id, '')).toEqual({ type: 'committed', note: '' });
    expect(library.text(FILE)).toBe(original);
  });

  it('摘录记录缺失（首次写 storage.session 失败）：重启后从已落盘的摘录操作按摘录 id 找回并写批注（codex review 第 5 轮）', async () => {
    const quoteOps = createQuoteOps();
    const deps = { library, index, pending: createPendingQueue(), fetch: async () => new Response(), now: () => new Date(), newId: () => `ID${++n}`, quoteOps };
    const capture = quoteCapture(PAGE, '慢思考', { markdown: '只有一条。', fragmentUrl: `${PAGE}#:~:text=x`, selectedAt: '2026-10-07T08:30:00.000Z', opId: 'OPX' });
    const outcome = await saveClip({ capture, snapshot: false }, deps);
    if (outcome.state !== 'saved') throw new Error('没有存成功');
    // 不调用 book.remember：模拟 afterOutcome 里写 storage.session 失败，随后后台重启
    const book = createClipBook({ index, quotes: createQuoteEntries(), quoteOps, library: () => library });
    expect(await commitNote(book, outcome.clip.id, 'abc')).toEqual({ type: 'committed', note: 'abc' });
    expect(library.text(FILE)).toContain('\n\nabc');
  });
});
