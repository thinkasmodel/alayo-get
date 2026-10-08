// 批注写回的端到端（ALAG-4 brief B §4、§6；ALAG-16 起批注只在面板里写）：页面提示「加批注…」进入的面板编辑态
// （handlePanelPort 的 start 带待编辑剪藏 → draft 批注 → 断开）+ ClipBook.findClip / editClip + MemoryLibrary。
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createPendingQueue } from '@/io/pending';
import { createQuoteEntries } from '@/io/quoteEntries';
import { createQuoteOps } from '@/io/quoteOps';
import { createSavedIndex, type SavedIndex } from '@/io/savedIndex';
import type { PanelToSw, SwToPanel } from '@/shared/messages';
import type { ClipSummary } from '@/shared/types';
import { createClipBook, type ClipBook } from './clips';
import { handlePanelPort, type PortLike } from './ports';
import { quoteCapture } from './route';
import { saveClip } from './saveClip';
import { buildLostEditFile, lostEditFileName } from '@/core/lostEditFile';
import { mediaMetaPath, serializeMediaMeta } from '@/core/media';
import { createLostEdits, type LostEditStore } from '@/io/lostEdits';

const PAGE = 'https://sspai.com/post/90001';
const FILE = '摘录 - 慢思考.md';

class FakePort implements PortLike<PanelToSw, SwToPanel> {
  readonly name = 'panel';
  readonly sent: SwToPanel[] = [];
  private messageListeners: Array<(m: PanelToSw) => void> = [];
  private disconnectListeners: Array<() => void> = [];
  postMessage(message: SwToPanel): void {
    this.sent.push(message);
  }
  onMessage = { addListener: (fn: (m: PanelToSw) => void) => void this.messageListeners.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => void this.disconnectListeners.push(fn) };
  send(message: PanelToSw): void {
    for (const fn of this.messageListeners) fn(message);
  }
  disconnect(): void {
    for (const fn of this.disconnectListeners) fn();
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

const TAB_ID = 7;

/**
 * 如同页面提示点了「加批注…」：后台记下这条剪藏，面板打开（start）进入它的编辑态，写批注（draft）后关闭（断开）。
 * 等到断开时的写回完成，返回实际写入的批注。面板没进入编辑态（去保存当前页）或没有写回时抛错。
 */
async function commitNote(book: ClipBook, clipId: string, note: string): Promise<string> {
  const port = new FakePort();
  const write: { done?: Promise<ClipSummary> } = {};
  handlePanelPort(port, {
    savePage: () => Promise.reject(new Error('编辑态不该重新保存')),
    saveSnapshot: () => Promise.reject(new Error('编辑态不该另存新快照')),
    findClip: book.findClip,
    takePendingEdit: async (tabId) => (tabId === TAB_ID ? clipId : null),
    applyEdits: (clip, fields) => (write.done = book.editClip(clip, fields)),
  });
  port.send({ type: 'start', tabId: TAB_ID });
  for (let i = 0; i < 50 && port.sent.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
  const first = port.sent[0];
  const state = first?.type === 'state' ? first.state : undefined;
  if (state?.state !== 'saved' || state.clip.id !== clipId) throw new Error('面板没有进入这条剪藏的编辑态');
  port.send({ type: 'draft', fields: { title: state.clip.title, tags: state.clip.tags, note } });
  port.disconnect();
  for (let i = 0; i < 50 && !write.done; i++) await new Promise((r) => setTimeout(r, 0));
  if (!write.done) throw new Error('关闭面板时没有写回');
  return (await write.done).note;
}

beforeEach(() => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  index = createSavedIndex();
  n = 0;
});

describe('页面提示「加批注…」→ 面板编辑态 → 摘录文件（端到端）', () => {
  it('写批注 abc 出现在这一条下面；再提交空批注，批注区被移除（摘录不按 frontmatter 的空 note 覆盖）', async () => {
    const book = newBook();
    const [, second] = await saveThree(book);
    if (!second?.quote) throw new Error('缺少摘录');
    const original = library.text(FILE) ?? '';

    expect(await commitNote(book, second.id, 'abc')).toBe('abc');
    expect(library.text(FILE)).toBe(original.replace(`${second.quote.anchor}\n`, `${second.quote.anchor}\n\nabc\n`));

    expect(await commitNote(book, second.id, '')).toBe('');
    expect(library.text(FILE)).toBe(original);
  });

  it('后台重启（内存记录清空）后，凭摘录 id 从 storage.session 的摘录记录找回并写批注、再清空', async () => {
    const [first] = await saveThree(newBook());
    if (!first?.quote) throw new Error('缺少摘录');
    const original = library.text(FILE) ?? '';

    const restarted = newBook();
    const found = await restarted.findClip(first.id);
    expect(found).toMatchObject({ id: first.id, file: FILE, note: '', quote: first.quote });

    expect(await commitNote(restarted, first.id, '重启后写的批注')).toBe('重启后写的批注');
    expect(library.text(FILE)).toContain(`${first.quote.anchor}\n\n重启后写的批注\n\n> 第二条。`);

    // 再重启一次：记录里的批注已更新，清空能判出改动并移除
    const again = newBook();
    expect((await again.findClip(first.id))?.note).toBe('重启后写的批注');
    expect(await commitNote(again, first.id, '')).toBe('');
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
    expect(await commitNote(book, first.id, 'abc')).toBe('abc');
    expect(library.text(FILE)).toContain(`${first.quote.anchor}\n\nabc\n`);

    // 模拟会话写失败：storage.session 里这一条的 note 回到空串
    await createQuoteEntries().put({ ...first, note: '' });

    const restarted = newBook();
    expect((await restarted.findClip(first.id))?.note).toBe('abc');
    expect(await commitNote(restarted, first.id, '')).toBe('');
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
    expect(await commitNote(book, outcome.clip.id, 'abc')).toBe('abc');
    expect(library.text(FILE)).toContain('\n\nabc');
  });
});

// ---- ALAG-20：进入编辑态前严格核对；写回失败留下草稿、存为草稿文件

/** 存一篇文章剪藏并记进 book（如同 afterOutcome）。 */
async function saveArticle(book: ClipBook, url: string, title: string): Promise<ClipSummary> {
  const deps = { library, index, pending: createPendingQueue(), fetch: async () => new Response(), now: () => new Date(), newId: () => `ID${++n}` };
  const outcome = await saveClip(
    { capture: { url, title, site: '', author: '', published: '', description: '', coverUrl: '', markdown: '正文。', textLength: 300, kind: 'page' }, snapshot: false },
    deps,
  );
  if (outcome.state !== 'saved') throw new Error('没有存成功');
  await book.remember(outcome.clip, library);
  return outcome.clip;
}

describe('ClipBook.checkClip：进入编辑态前严格核对（ALAG-20）', () => {
  it('.md 剪藏：文件在且 id 一致 → ok，按文件刷新', async () => {
    const book = newBook();
    const saved = await saveArticle(book, PAGE, '文章');
    library.files.set(saved.file, (library.text(saved.file) ?? '').replace('note: ""', 'note: "文件里的批注"'));
    const result = await book.checkClip(saved.id);
    expect(result?.ok).toBe(true);
    expect(result?.clip).toMatchObject({ id: saved.id, file: saved.file, note: '文件里的批注' });
  });

  it('摘录剪藏：摘录文件 id 与记录一致 → ok', async () => {
    const book = newBook();
    const [, second] = await saveThree(book);
    if (!second) throw new Error('缺少摘录');
    const result = await book.checkClip(second.id);
    expect(result).toEqual({ ok: true, clip: second });
  });

  it('媒体剪藏：侧档 id 一致 → ok，按侧档刷新标签与批注', async () => {
    const book = newBook();
    const media: ClipSummary = {
      id: 'MEDIA1',
      file: 'paper.pdf',
      title: 'paper',
      medium: 'pdf',
      site: 'arxiv.org',
      source: 'https://arxiv.org/pdf/1',
      extract: 'full',
      imageCount: 0,
      imageFailures: 0,
      tags: [],
      note: '',
      savedAt: '2026-10-08T00:00:00.000Z',
      media: { kind: 'pdf', bytes: 10 },
    };
    library.files.set('paper.pdf', new Uint8Array([1, 2, 3]));
    library.files.set(
      mediaMetaPath('MEDIA1'),
      serializeMediaMeta({ id: 'MEDIA1', file: 'paper.pdf', source: media.source, media_url: media.source, medium: 'pdf', title: 'paper', site: 'arxiv.org', captured: '', bytes: 10, mime: 'application/pdf', tags: ['论文'], note: '侧档批注' }),
    );
    await book.remember(media, library);
    const result = await book.checkClip('MEDIA1');
    expect(result?.ok).toBe(true);
    expect(result?.clip).toMatchObject({ id: 'MEDIA1', tags: ['论文'], note: '侧档批注' });
  });

  it('文件被移走 → ok: false，NotFoundError', async () => {
    const book = newBook();
    const saved = await saveArticle(book, PAGE, '文章');
    await library.remove(saved.file);
    const result = await book.checkClip(saved.id);
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    expect(result.clip.id).toBe(saved.id);
    expect(result.error.name).toBe('NotFoundError');
  });

  it('同一路径被写成另一条剪藏 → ok: false，ClipMismatchError，文件内容不变', async () => {
    const book = newBook();
    const a = await saveArticle(book, PAGE, '文章');
    const b = await saveArticle(book, 'https://example.com/b', '另一篇');
    const other = library.text(b.file) ?? '';
    library.files.set(a.file, other);
    const result = await book.checkClip(a.id);
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    expect(result.error.name).toBe('ClipMismatchError');
    expect(library.text(a.file)).toBe(other);
  });

  it('媒体剪藏：侧档还在、媒体文件被移走 → ok: false，NotFoundError（codex review 第 2 轮）', async () => {
    const book = newBook();
    const media: ClipSummary = {
      id: 'MEDIA2',
      file: 'photo.jpg',
      title: 'photo',
      medium: 'image',
      site: 'example.com',
      source: 'https://example.com/p',
      extract: 'full',
      imageCount: 0,
      imageFailures: 0,
      tags: [],
      note: '',
      savedAt: '2026-10-08T00:00:00.000Z',
      media: { kind: 'image', bytes: 3 },
    };
    library.files.set('photo.jpg', new Uint8Array([1, 2, 3]));
    library.files.set(
      mediaMetaPath('MEDIA2'),
      serializeMediaMeta({ id: 'MEDIA2', file: 'photo.jpg', source: media.source, media_url: media.source, medium: 'image', title: 'photo', site: 'example.com', captured: '', bytes: 3, mime: 'image/jpeg', tags: [], note: '' }),
    );
    await book.remember(media, library);
    expect(await library.exists('photo.jpg')).toBe(true);
    expect((await book.checkClip('MEDIA2'))?.ok).toBe(true);

    await library.remove('photo.jpg');
    expect(await library.exists('photo.jpg')).toBe(false);
    expect(await library.exists(mediaMetaPath('MEDIA2'))).toBe(true);
    const result = await book.checkClip('MEDIA2');
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    expect(result.error.name).toBe('NotFoundError');
  });

  it('摘录剪藏：这一条的 anchor 行被删掉或重复 → ok: false，QuoteEntryNotFound（codex review 第 2 轮）', async () => {
    const book = newBook();
    const [, second] = await saveThree(book);
    if (!second?.quote) throw new Error('缺少摘录');
    const original = library.text(FILE) ?? '';
    const anchorLine = `${second.quote.anchor}\n`;
    expect(original).toContain(anchorLine);

    library.files.set(FILE, original.replace(anchorLine, ''));
    const removed = await book.checkClip(second.id);
    expect(removed?.ok).toBe(false);
    if (removed?.ok !== false) return;
    expect(removed.error.name).toBe('QuoteEntryNotFound');

    library.files.set(FILE, original.replace(anchorLine, `${anchorLine}\n${anchorLine}`));
    const duplicated = await book.checkClip(second.id);
    expect(duplicated?.ok).toBe(false);
    if (duplicated?.ok !== false) return;
    expect(duplicated.error.name).toBe('QuoteEntryNotFound');
  });

  it('任何来源都找不到 → undefined', async () => {
    expect(await newBook().checkClip('NOPE')).toBeUndefined();
  });
});

describe('「加批注…」→ 文件不在或被替换 / 写回失败 → 草稿 → 存为草稿文件（端到端，ALAG-20）', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const until = async (done: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 100 && !(await done()); i++) await tick();
  };
  const statesOf = (port: FakePort) => port.sent.flatMap((m) => (m.type === 'state' ? [m.state] : []));

  /** 打开面板：接上 background 的同一套依赖（checkClip、草稿列表、存为草稿文件）；clipId 为页面提示记下的待编辑剪藏。 */
  function openPanel(book: ClipBook, lostEdits: LostEditStore, clipId: string | null) {
    const port = new FakePort();
    handlePanelPort(port, {
      savePage: () => Promise.reject(new Error('编辑态不该重新保存')),
      saveSnapshot: () => Promise.reject(new Error('编辑态不该另存新快照')),
      findClip: book.findClip,
      checkClip: book.checkClip,
      takePendingEdit: async (tabId) => (tabId === TAB_ID ? clipId : null),
      applyEdits: book.editClip,
      lostEdits,
      fileLostEdit: async (edit) => {
        const lib = book.libraryFor(edit.clip.id);
        const name = lostEditFileName(edit, await lib.listRoot());
        await lib.write(name, buildLostEditFile(edit));
        return name;
      },
    });
    return port;
  }

  /** 进入编辑态（预检通过），返回推送的 saved 状态里的剪藏。 */
  async function enterEdit(port: FakePort, clipId: string): Promise<ClipSummary> {
    port.send({ type: 'start', tabId: TAB_ID });
    await until(() => statesOf(port).length > 0);
    const state = statesOf(port)[0];
    if (state?.state !== 'saved' || state.clip.id !== clipId) throw new Error('面板没有进入这条剪藏的编辑态');
    return state.clip;
  }

  it('保存后文件被移走，再点「加批注…」：推送 clip-unavailable（NotFoundError）', async () => {
    const book = newBook();
    const saved = await saveArticle(book, PAGE, '文章');
    await library.remove(saved.file);
    const port = openPanel(book, createLostEdits(), saved.id);
    port.send({ type: 'start', tabId: TAB_ID });
    await until(() => statesOf(port).length > 0);
    const [state] = statesOf(port);
    expect(state?.state).toBe('clip-unavailable');
    if (state?.state !== 'clip-unavailable') return;
    expect(state.clip.id).toBe(saved.id);
    expect(state.error.name).toBe('NotFoundError');
  });

  it('保存后先替换再点「加批注…」：推送 clip-unavailable（ClipMismatchError）', async () => {
    const book = newBook();
    const a = await saveArticle(book, PAGE, '文章');
    const b = await saveArticle(book, 'https://example.com/b', '另一篇');
    library.files.set(a.file, library.text(b.file) ?? '');
    const port = openPanel(book, createLostEdits(), a.id);
    port.send({ type: 'start', tabId: TAB_ID });
    await until(() => statesOf(port).length > 0);
    const [state] = statesOf(port);
    expect(state?.state).toBe('clip-unavailable');
    if (state?.state !== 'clip-unavailable') return;
    expect(state.error.name).toBe('ClipMismatchError');
  });

  it('编辑态里写批注、文件被移走、关闭面板：草稿入列表；下次打开面板「存为草稿文件」写出批注草稿文件，列表清空', async () => {
    const book = newBook();
    const lostEdits = createLostEdits();
    const saved = await saveArticle(book, PAGE, '文章');
    const port = openPanel(book, lostEdits, saved.id);
    const clip = await enterEdit(port, saved.id);
    port.send({ type: 'draft', fields: { title: clip.title, tags: clip.tags, note: '移走后写的批注' } });
    await library.remove(saved.file);
    port.disconnect();
    await until(async () => (await lostEdits.list()).length > 0);
    const [edit] = await lostEdits.list();
    expect(edit).toMatchObject({ clip: { id: saved.id }, fields: { note: '移走后写的批注' }, error: { name: 'NotFoundError' } });
    if (!edit) return;

    // 下次打开面板：连接即收到草稿；点「存为草稿文件」
    const next = openPanel(book, lostEdits, null);
    await until(() => next.sent.some((m) => m.type === 'lost-edits'));
    expect(next.sent.find((m) => m.type === 'lost-edits')).toMatchObject({ edits: [{ id: edit.id }] });
    next.send({ type: 'lost-edit', action: 'file', id: edit.id });
    await until(async () => (await lostEdits.list()).length === 0);
    const draftFile = '批注草稿 - 文章.md';
    expect(library.text(draftFile)).toContain('移走后写的批注');
    expect(library.text(saved.file)).toBeUndefined();
    expect(await lostEdits.list()).toEqual([]);
    await until(() => next.sent.filter((m) => m.type === 'lost-edits').length > 1);
    expect(next.sent.filter((m) => m.type === 'lost-edits').at(-1)).toEqual({ type: 'lost-edits', edits: [], notices: [{ id: edit.id, kind: 'filed', file: draftFile }] });
  });

  it('进入 A 的编辑态（预检通过）后 A 的路径被写成剪藏 B、关闭面板：ClipMismatchError 入列表，B 的内容逐字不变', async () => {
    const book = newBook();
    const lostEdits = createLostEdits();
    const a = await saveArticle(book, PAGE, '文章');
    const b = await saveArticle(book, 'https://example.com/b', '另一篇');
    const port = openPanel(book, lostEdits, a.id);
    const clip = await enterEdit(port, a.id);
    port.send({ type: 'draft', fields: { title: clip.title, tags: clip.tags, note: '给 A 的批注' } });
    const other = library.text(b.file) ?? '';
    library.files.set(a.file, other);
    port.disconnect();
    await until(async () => (await lostEdits.list()).length > 0);
    const [edit] = await lostEdits.list();
    expect(edit).toMatchObject({ clip: { id: a.id }, fields: { note: '给 A 的批注' }, error: { name: 'ClipMismatchError' } });
    expect(library.text(a.file)).toBe(other);
  });
});
