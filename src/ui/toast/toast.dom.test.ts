import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwToToastNote, ToastNoteToSw } from '@/shared/messages';
import type { ClipSummary, SaveOutcome } from '@/shared/types';
import { mountToast, NOTE_ACK_MS, TOAST_AUTO_MS, TOAST_FADE_MS, type ToastDeps } from './toast';

const clip: ClipSummary = {
  id: '01JTOAST',
  file: '文章.md',
  title: '为什么“安静”的界面更难做',
  medium: 'web',
  site: 'sspai.com',
  source: 'https://sspai.com/post/98214',
  extract: 'full',
  imageCount: 0,
  imageFailures: 0,
  tags: [],
  note: '',
  savedAt: '2026-10-06T12:00:00.000Z',
};
const preview = { title: clip.title, site: clip.site, source: clip.source, medium: 'web' as const };
const saved: SaveOutcome = { state: 'saved', clip, tagSuggestions: [] };
const failed: SaveOutcome = { state: 'failed', preview, error: { name: 'NotFoundError', message: 'gone' } };
const duplicate: SaveOutcome = {
  state: 'duplicate',
  preview,
  previous: { id: '01JOLD', file: '文章.md', title: clip.title, medium: 'web', source: clip.source, savedAt: new Date(2026, 8, 28, 12).toISOString(), tags: [] },
};

/** 假的批注 Port：记录发出的消息；reply() 模拟后台回复，drop() 模拟后台被终止导致断开。 */
function fakeNotePort(notes: ToastNoteToSw[]) {
  const messageListeners: Array<(m: SwToToastNote) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  let alive = true;
  return {
    postMessage: vi.fn((m: ToastNoteToSw) => {
      if (!alive) throw new Error('Attempting to use a disconnected port object');
      notes.push(m);
    }),
    disconnect: vi.fn(() => {
      alive = false;
    }),
    onMessage: { addListener: (fn: (m: SwToToastNote) => void) => void messageListeners.push(fn) },
    onDisconnect: { addListener: (fn: () => void) => void disconnectListeners.push(fn) },
    reply: (m: SwToToastNote) => messageListeners.forEach((fn) => fn(m)),
    drop: () => {
      alive = false;
      disconnectListeners.forEach((fn) => fn());
    },
  };
}

function makeDeps() {
  const notes: ToastNoteToSw[] = [];
  const ports: Array<ReturnType<typeof fakeNotePort>> = [];
  const connectNote = vi.fn(() => {
    const p = fakeNotePort(notes);
    ports.push(p);
    return p;
  });
  const deps = { sendMessage: vi.fn<ToastDeps['sendMessage']>(), connectNote } satisfies ToastDeps;
  return {
    deps,
    notes,
    ports,
    get port() {
      const p = ports.at(-1);
      if (!p) throw new Error('还没有连接批注 Port');
      return p;
    },
  };
}

const hosts = () => document.querySelectorAll('[data-alayo-get-toast]');
const buttonIn = (root: ShadowRoot, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('页面提示', () => {
  it('宿主元素是 fixed 右下角的 div，带 closed shadow root，内容在 shadow 里', () => {
    const attach = vi.spyOn(HTMLElement.prototype, 'attachShadow');
    const { deps } = makeDeps();
    const toast = mountToast(saved, deps);
    expect(attach).toHaveBeenCalledWith({ mode: 'closed' });
    attach.mockRestore();
    expect(hosts()).toHaveLength(1);
    expect(toast.host.tagName).toBe('DIV');
    expect(toast.host.shadowRoot).toBeNull(); // closed：页面拿不到
    expect(toast.root).toBeInstanceOf(ShadowRoot);
    expect(toast.root.host).toBe(toast.host);
    expect(toast.host.style.position).toBe('fixed');
    expect(toast.host.style.zIndex).toBe('2147483647');
    expect(toast.root.textContent).toContain('已存入剪藏库');
    expect(toast.root.textContent).toContain(clip.title);
    // 样式写在 shadow root 里（Vitest 不处理 CSS，?inline 在测试里是空串，内容由构建产物检查）
    expect(toast.root.querySelector('style')).not.toBeNull();
  });

  it('X 剪藏只存了一部分：说明行写一个原因（优先级上限、超时、截断）；完整时仍是标题（ALAG-3）', () => {
    const { deps } = makeDeps();
    const xClip: ClipSummary = { ...clip, medium: 'x', extract: 'partial', x: { form: 'thread', posts: 23, partial: { limit: false, timeout: true, truncated: 2 } } };
    const toast = mountToast({ state: 'saved', clip: xClip, tagSuggestions: [] }, deps);
    expect(toast.root.querySelector('.ts')?.textContent).toBe('15 秒内没加载完，存了 23 条');
    expect(toast.root.textContent).toContain('已存入剪藏库');
    expect(toast.root.textContent).not.toContain(clip.title);
    expect(buttonIn(toast.root, '加批注')).toBeDefined();

    const full = mountToast({ state: 'saved', clip: { ...xClip, extract: 'full', x: { form: 'thread', posts: 23, partial: null } }, tagSuggestions: [] }, deps);
    expect(full.root.querySelector('.ts')?.textContent).toBe(clip.title);
  });

  it('已存入 3 秒后消失', () => {
    const { deps } = makeDeps();
    mountToast(saved, deps);
    vi.advanceTimersByTime(TOAST_AUTO_MS - 1);
    expect(hosts()).toHaveLength(1);
    vi.advanceTimersByTime(1 + TOAST_FADE_MS);
    expect(hosts()).toHaveLength(0);
  });

  it('悬停时暂停计时，移开后重新计 3 秒', () => {
    const { deps } = makeDeps();
    const toast = mountToast(duplicate, deps);
    expect(toast.root.textContent).toContain('已于 9 月 28 日保存过');
    const box = toast.root.querySelector('.toast');
    vi.advanceTimersByTime(2000);
    box?.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(10_000);
    expect(hosts()).toHaveLength(1);
    box?.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(TOAST_AUTO_MS - 1);
    expect(hosts()).toHaveLength(1);
    vi.advanceTimersByTime(1 + TOAST_FADE_MS);
    expect(hosts()).toHaveLength(0);
  });

  it('失败不自动消失，带关闭按钮；"重试"发 toast-action', () => {
    const { deps } = makeDeps();
    const toast = mountToast(failed, deps);
    expect(toast.root.querySelector('.tt.err')?.textContent).toBe('没能写入剪藏库');
    vi.advanceTimersByTime(60_000);
    expect(hosts()).toHaveLength(1);
    buttonIn(toast.root, '重试')?.click();
    expect(deps.sendMessage).toHaveBeenCalledWith({ type: 'toast-action', action: 'retry' });
    toast.root.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click();
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(hosts()).toHaveLength(0);
  });

  it('需要重新授权不自动消失；"去授权…"发 open-options', () => {
    const { deps } = makeDeps();
    const toast = mountToast({ state: 'needs-permission', preview }, deps);
    expect(toast.root.textContent).toContain('本次没有保存，授权后会自动补存');
    vi.advanceTimersByTime(60_000);
    expect(hosts()).toHaveLength(1);
    buttonIn(toast.root, '去授权…')?.click();
    expect(deps.sendMessage).toHaveBeenCalledWith({ type: 'open-options', section: 'reauth' });
  });

  it('新提示替换旧提示', () => {
    const { deps } = makeDeps();
    const first = mountToast(failed, deps);
    const second = mountToast(saved, deps);
    expect(hosts()).toHaveLength(1);
    expect(hosts()[0]).toBe(second.host);
    expect(first.host.isConnected).toBe(false);
  });

  it('展开批注框后不再自动消失；每次输入发 draft', () => {
    const { deps, notes } = makeDeps();
    const toast = mountToast(saved, deps);
    buttonIn(toast.root, '加批注')?.click();
    expect(deps.connectNote).toHaveBeenCalledTimes(1);
    const textarea = toast.root.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(toast.root.activeElement).toBe(textarea);
    expect(toast.root.textContent).toContain('回车或 Esc 收起时都会写入');
    vi.advanceTimersByTime(60_000);
    expect(hosts()).toHaveLength(1);

    if (!textarea) return;
    textarea.value = '第三节可以拿去评空态';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(notes).toEqual([{ type: 'draft', clipId: clip.id, note: '第三节可以拿去评空态' }]);
  });

  // 编排者修改（codex review 第 7 轮）：commit 前先补发完整草稿，收到后台 committed 才收起。
  it('批注框里回车发 commit，收到确认后收起并淡出；Shift+回车不提交', () => {
    const ctx = makeDeps();
    const { deps, notes } = ctx;
    const toast = mountToast(saved, deps);
    buttonIn(toast.root, '加批注')?.click();
    const textarea = toast.root.querySelector('textarea');
    if (!textarea) throw new Error('批注框没展开');

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    expect(notes).toEqual([]);

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(notes).toEqual([{ type: 'draft', clipId: clip.id, note: '' }, { type: 'commit' }]);
    expect(toast.root.querySelector('textarea')).not.toBeNull();
    ctx.port.reply({ type: 'committed', note: '' });
    expect(toast.root.querySelector('textarea')).toBeNull();
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(hosts()).toHaveLength(0);
    expect(ctx.port.disconnect).toHaveBeenCalled();
  });

  it('后台断开后再输入并提交：重连、补发完整草稿，提交照常到达（codex review 第 7 轮）', () => {
    const ctx = makeDeps();
    const toast = mountToast(saved, ctx.deps);
    buttonIn(toast.root, '加批注')?.click();
    const textarea = toast.root.querySelector('textarea');
    if (!textarea) throw new Error('批注框没展开');
    ctx.port.drop();
    ctx.notes.length = 0;
    textarea.value = '闲置后写的批注';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ctx.deps.connectNote).toHaveBeenCalledTimes(2);
    expect(ctx.notes).toEqual([
      { type: 'draft', clipId: clip.id, note: '闲置后写的批注' },
      { type: 'draft', clipId: clip.id, note: '闲置后写的批注' },
      { type: 'commit' },
    ]);
    ctx.port.reply({ type: 'committed', note: '闲置后写的批注' });
    expect(toast.root.querySelector('textarea')).toBeNull();
  });

  it('输入后后台断开、不再输入：立刻重连补发草稿；随后被新提示替换时断开新 Port（codex review 加审轮）', () => {
    const ctx = makeDeps();
    const toast = mountToast(saved, ctx.deps);
    buttonIn(toast.root, '加批注')?.click();
    const textarea = toast.root.querySelector('textarea');
    if (!textarea) throw new Error('批注框没展开');
    textarea.value = '写完就走';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const first = ctx.port;
    ctx.notes.length = 0;
    first.drop();
    expect(ctx.deps.connectNote).toHaveBeenCalledTimes(2);
    expect(ctx.notes).toEqual([{ type: 'draft', clipId: clip.id, note: '写完就走' }]);
    const second = ctx.port;
    mountToast(saved, ctx.deps);
    expect(second.disconnect).toHaveBeenCalled();
  });

  it('把批注清空后后台断开：重连并补发空草稿，清空操作不丢（codex review 合并前复审）', () => {
    const ctx = makeDeps();
    const toast = mountToast(saved, ctx.deps);
    buttonIn(toast.root, '加批注')?.click();
    const textarea = toast.root.querySelector('textarea');
    if (!textarea) throw new Error('批注框没展开');
    textarea.value = 'A';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.notes.length = 0;
    ctx.port.drop();
    expect(ctx.deps.connectNote).toHaveBeenCalledTimes(2);
    expect(ctx.notes).toEqual([{ type: 'draft', clipId: clip.id, note: '' }]);
  });

  it('没动过批注框时后台断开：不重连、不补发草稿', () => {
    const ctx = makeDeps();
    const toast = mountToast(saved, ctx.deps);
    buttonIn(toast.root, '加批注')?.click();
    ctx.notes.length = 0;
    ctx.port.drop();
    expect(ctx.deps.connectNote).toHaveBeenCalledTimes(1);
    expect(ctx.notes).toEqual([]);
  });

  it('确认的是旧版本（提交后又改了字）：不收起，接着提交新版本（codex review 第 8 轮）', () => {
    const ctx = makeDeps();
    const toast = mountToast(saved, ctx.deps);
    buttonIn(toast.root, '加批注')?.click();
    const textarea = toast.root.querySelector('textarea');
    if (!textarea) throw new Error('批注框没展开');
    textarea.value = '第一版';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    textarea.value = '第一版，再补一句';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.notes.length = 0;
    ctx.port.reply({ type: 'committed', note: '第一版' });
    expect(toast.root.querySelector('textarea')).not.toBeNull();
    expect(ctx.notes).toEqual([
      { type: 'draft', clipId: clip.id, note: '第一版，再补一句' },
      { type: 'commit' },
    ]);
    ctx.port.reply({ type: 'committed', note: '第一版，再补一句' });
    expect(toast.root.querySelector('textarea')).toBeNull();
  });

  it('后台回复写入失败或超时：保留批注框和输入，说明原因（codex review 第 7 轮）', () => {
    const ctx = makeDeps();
    const toast = mountToast(saved, ctx.deps);
    buttonIn(toast.root, '加批注')?.click();
    const textarea = toast.root.querySelector('textarea');
    if (!textarea) throw new Error('批注框没展开');
    textarea.value = '要保住的批注';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    ctx.port.reply({ type: 'commit-failed', message: '剪藏库没有写入权限（prompt）' });
    expect(toast.root.querySelector('textarea')?.value).toBe('要保住的批注');
    expect(toast.root.textContent).toContain('没能写入批注：剪藏库没有写入权限（prompt）');
    expect(hosts()).toHaveLength(1);

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(NOTE_ACK_MS);
    expect(toast.root.querySelector('textarea')).not.toBeNull();
    expect(toast.root.textContent).toContain('没有收到扩展的确认');
  });

  it('批注框里按 Esc 同样发 commit', () => {
    const { deps, notes } = makeDeps();
    const toast = mountToast({ state: 'fallback', clip: { ...clip, extract: 'fallback' }, tagSuggestions: [] }, deps);
    expect(toast.root.textContent).toContain('已存为书签剪藏');
    buttonIn(toast.root, '加批注')?.click();
    toast.root.querySelector('textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(notes).toEqual([{ type: 'draft', clipId: clip.id, note: '' }, { type: 'commit' }]);
  });

  it('已存过的"另存新快照"发 toast-action', () => {
    const { deps } = makeDeps();
    const toast = mountToast(duplicate, deps);
    buttonIn(toast.root, '另存新快照')?.click();
    expect(deps.sendMessage).toHaveBeenCalledWith({ type: 'toast-action', action: 'snapshot' });
  });
});

describe('页面提示：媒体剪藏与流媒体剪藏（ALAG-4）', () => {
  it('媒体剪藏：说明行“类别 · 文件名”，有“加批注”', () => {
    const { deps } = makeDeps();
    const mediaClip: ClipSummary = { ...clip, medium: 'image', file: '少数派年度盘点 - cover@2x.jpg', title: '少数派年度盘点', media: { kind: 'image', bytes: 1258291 } };
    const toast = mountToast({ state: 'saved', clip: mediaClip, tagSuggestions: [] }, deps);
    expect(toast.root.querySelector('.tt')?.textContent).toBe('已存入剪藏库');
    expect(toast.root.querySelector('.ts')?.textContent).toBe('图片 · 少数派年度盘点 - cover@2x.jpg');
    expect(buttonIn(toast.root, '加批注')).toBeDefined();
  });

  it('流媒体剪藏：说明行“平台 · 标题”；超大与拿不到大小的直链各一句', () => {
    const { deps } = makeDeps();
    const bili: ClipSummary = { ...clip, medium: 'video', title: '【官方 MV】Never Gonna Give You Up - Rick Astley', stream: { platform: 'bilibili', duration: 213, medium: 'video' } };
    expect(mountToast({ state: 'saved', clip: bili, tagSuggestions: [] }, deps).root.querySelector('.ts')?.textContent).toBe(
      'B 站 · 【官方 MV】Never Gonna Give You Up - Rick Astley',
    );
    const direct = (bytes: number | null): ClipSummary => ({ ...clip, medium: 'video', stream: { platform: 'other', duration: null, medium: 'video', oversize: { bytes } } });
    expect(mountToast({ state: 'saved', clip: direct(150 * 1024 * 1024), tagSuggestions: [] }, deps).root.querySelector('.ts')?.textContent).toBe(
      '视频超过 100MB，只记了链接和信息',
    );
    const unknown = mountToast({ state: 'saved', clip: direct(null), tagSuggestions: [] }, deps);
    expect(unknown.root.querySelector('.ts')?.textContent).toBe('拿不到视频大小，只记了链接和信息');
    expect(buttonIn(unknown.root, '加批注')).toBeDefined();
  });

  it('时间线上右键 X 视频：失败提示说明行请用户打开帖子页', () => {
    const { deps } = makeDeps();
    const toast = mountToast(
      { state: 'failed', preview, error: { name: 'XVideoNeedsPost', message: '在时间线上认不出是哪条帖子，请打开帖子页再存' } },
      deps,
    );
    expect(toast.root.querySelector('.tt')?.textContent).toBe('没能写入剪藏库');
    expect(toast.root.querySelector('.ts')?.textContent).toBe('在时间线上认不出是哪条帖子，请打开帖子页再存');
  });
});

describe('页面提示：重试没有意义的直接失败（ALAG-4 编排者裁决）', () => {
  it('XVideoNeedsPost、NoDownloadableUrl 只放关闭，不放重试；不自动消失', () => {
    // 计时器在 beforeEach 里已换成假的
    for (const error of [
      { name: 'XVideoNeedsPost', message: '在时间线上认不出是哪条帖子，请打开帖子页再存' },
      { name: 'NoDownloadableUrl', message: '这张图片没有可下载的地址' },
    ]) {
      const { deps } = makeDeps();
      const toast = mountToast({ state: 'failed', preview, error }, deps);
      expect(buttonIn(toast.root, '重试')).toBeUndefined();
      expect(toast.root.querySelector('button[aria-label="关闭"]')).not.toBeNull();
      vi.advanceTimersByTime(TOAST_AUTO_MS + TOAST_FADE_MS + 10);
      expect(toast.host.isConnected).toBe(true);
    }
  });

  it('NoDownloadableUrl、DataUrlTooLarge 的说明行；DataUrlTooLarge 也只有关闭', () => {
    const { deps } = makeDeps();
    const noUrl = mountToast({ state: 'failed', preview, error: { name: 'NoDownloadableUrl', message: '这张图片没有可下载的地址' } }, deps);
    expect(noUrl.root.querySelector('.ts')?.textContent).toBe('这张图片没有可下载的地址，本次没有保存');
    const tooLarge = mountToast(
      { state: 'failed', preview, error: { name: 'DataUrlTooLarge', message: '这张图片是内嵌数据，太大，没法暂存，请授权后重新保存' } },
      deps,
    );
    expect(tooLarge.root.querySelector('.ts')?.textContent).toBe('这张图片是内嵌数据，太大，没法暂存，请授权后重新保存');
    expect(buttonIn(tooLarge.root, '重试')).toBeUndefined();
    expect(tooLarge.root.querySelector('button[aria-label="关闭"]')).not.toBeNull();
  });
});

describe('页面提示：已摘录（ALAG-4）', () => {
  const quoteClip = (quote: NonNullable<ClipSummary['quote']>): ClipSummary => ({
    ...clip,
    id: '01JQUOTE',
    medium: 'quote',
    file: '摘录 - 为什么我们需要慢思考.md',
    title: '为什么我们需要慢思考',
    quote,
  });
  const base = { fileId: 'F', entry: 3, anchor: '2026-10-07 16:31 · [跳回原文](https://sspai.com/post/90001)', fragment: true, recreated: false };

  it('标题“已摘录”，说明行三种写法逐字对齐 DESIGN.md；有“加批注”，3 秒后消失', () => {
    const { deps } = makeDeps();
    const cases: Array<[NonNullable<ClipSummary['quote']>, string]> = [
      [base, '第 3 条 · 摘录 - 为什么我们需要慢思考.md'],
      [{ ...base, entry: 2, fragment: false }, '第 2 条 · 没能定位到原文位置，链接只到页面'],
      [{ ...base, entry: 1, recreated: true }, '原来的摘录文件不在了，新建了一个'],
    ];
    for (const [quote, desc] of cases) {
      const toast = mountToast({ state: 'saved', clip: quoteClip(quote), tagSuggestions: [] }, deps);
      expect(toast.root.querySelector('.tt')?.textContent).toBe('已摘录');
      expect(toast.root.querySelector('.ts')?.textContent).toBe(desc);
      expect(buttonIn(toast.root, '加批注')).toBeDefined();
      vi.advanceTimersByTime(TOAST_AUTO_MS + TOAST_FADE_MS + 10);
      expect(toast.host.isConnected).toBe(false);
    }
  });

  it('“加批注”沿用批注流程：draft 带这一条摘录的 id，回车提交', () => {
    const ctx = makeDeps();
    const toast = mountToast({ state: 'saved', clip: quoteClip(base), tagSuggestions: [] }, ctx.deps);
    buttonIn(toast.root, '加批注')?.click();
    const textarea = toast.root.querySelector('textarea');
    if (!textarea) throw new Error('没有展开批注框');
    textarea.value = '这段和卡尼曼的系统 1 / 系统 2 说法对得上';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(ctx.notes).toContainEqual({ type: 'draft', clipId: '01JQUOTE', note: '这段和卡尼曼的系统 1 / 系统 2 说法对得上' });
    expect(ctx.notes.at(-1)).toEqual({ type: 'commit' });
  });
});
