import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipSummary, SaveOutcome } from '@/shared/types';
import { CJK, loadMessages, useLocale } from '../../../tests/setup/i18n';
import { mountToast, TOAST_AUTO_MS, TOAST_FADE_MS, type ToastDeps } from './toast';

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

function makeDeps() {
  // 后台的回应：「加批注…」等它（ToastActionResponse），其余按钮不看
  const deps = { sendMessage: vi.fn<ToastDeps['sendMessage']>(async () => undefined) } satisfies ToastDeps;
  return { deps };
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
    expect(buttonIn(toast.root, '加批注…')).toBeDefined();

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
    expect(buttonIn(toast.root, '加批注…')).toBeDefined();
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
    expect(buttonIn(unknown.root, '加批注…')).toBeDefined();
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
      expect(buttonIn(toast.root, '加批注…')).toBeDefined();
      vi.advanceTimersByTime(TOAST_AUTO_MS + TOAST_FADE_MS + 10);
      expect(toast.host.isConnected).toBe(false);
    }
  });
});

describe('页面提示：网页里没有输入控件，「加批注…」打开工具栏面板（ALAG-16，ADR-0008）', () => {
  const quoted: ClipSummary = {
    ...clip,
    id: '01JQUOTE16',
    medium: 'quote',
    file: '摘录 - 为什么我们需要慢思考.md',
    quote: { fileId: 'F', entry: 3, anchor: 'a', fragment: true, recreated: false },
  };
  const fallback: SaveOutcome = { state: 'fallback', clip: { ...clip, extract: 'fallback', medium: 'link' }, tagSuggestions: [] };
  /** 等 sendMessage 的 Promise 与 toast 里 await 之后的代码跑完（假计时器不推进微任务）。 */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it.each<[string, SaveOutcome]>([
    ['saved', saved],
    ['fallback', fallback],
    ['duplicate', duplicate],
    ['failed', failed],
    ['needs-permission', { state: 'needs-permission', preview }],
    ['摘录', { state: 'saved', clip: quoted, tagSuggestions: [] }],
  ])('%s：shadow root 里没有 textarea、input、contenteditable', async (_name, outcome) => {
    const { deps } = makeDeps();
    deps.sendMessage.mockResolvedValue({ opened: false });
    const toast = mountToast(outcome, deps);
    expect(toast.root.querySelector('textarea, input, [contenteditable]')).toBeNull();
    // 点过「加批注…」进入失败态后也一样
    buttonIn(toast.root, '加批注…')?.click();
    await settle();
    expect(toast.root.querySelector('textarea, input, [contenteditable]')).toBeNull();
  });

  it('点「加批注…」发 note 与 clipId；等待期间按钮 disabled、重复点击只发一次；opened: true 后淡出移除', async () => {
    const { deps } = makeDeps();
    let reply: (value: unknown) => void = () => undefined;
    deps.sendMessage.mockImplementation(() => new Promise((resolve) => (reply = resolve)));
    const toast = mountToast(saved, deps);
    const button = buttonIn(toast.root, '加批注…');
    if (!button) throw new Error('没有「加批注…」');
    button.click();
    button.click();
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendMessage).toHaveBeenCalledWith({ type: 'toast-action', action: 'note', clipId: clip.id });
    expect(button.disabled).toBe(true);
    // 等待期间不自动消失
    vi.advanceTimersByTime(TOAST_AUTO_MS + TOAST_FADE_MS);
    expect(hosts()).toHaveLength(1);
    reply({ opened: true });
    await settle();
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(hosts()).toHaveLength(0);
  });

  it('等待回应期间鼠标移进移出：不重新计时；回应慢于 3 秒且没打开时仍显示失败态', async () => {
    const { deps } = makeDeps();
    let reply: (value: unknown) => void = () => undefined;
    deps.sendMessage.mockImplementation(() => new Promise((resolve) => (reply = resolve)));
    const toast = mountToast(saved, deps);
    const box = toast.root.querySelector('.toast');
    box?.dispatchEvent(new MouseEvent('mouseenter'));
    buttonIn(toast.root, '加批注…')?.click();
    box?.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(TOAST_AUTO_MS + TOAST_FADE_MS + 10);
    expect(hosts()).toHaveLength(1);
    reply({ opened: false });
    await settle();
    expect(toast.root.querySelector('.noteerr')?.textContent).toBe('没能打开面板。把这个浏览器窗口点到前台，再点一次「加批注…」。');
    // 失败态不再自动消失，鼠标移进移出也一样
    box?.dispatchEvent(new MouseEvent('mouseenter'));
    box?.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(60_000);
    expect(hosts()).toHaveLength(1);
  });

  it('摘录剪藏：clipId 是这一条摘录的 id', () => {
    const { deps } = makeDeps();
    const toast = mountToast({ state: 'saved', clip: quoted, tagSuggestions: [] }, deps);
    buttonIn(toast.root, '加批注…')?.click();
    expect(deps.sendMessage).toHaveBeenCalledWith({ type: 'toast-action', action: 'note', clipId: '01JQUOTE16' });
  });

  it.each<[string, () => Promise<unknown>]>([
    ['opened: false', async () => ({ opened: false })],
    ['没有回应（undefined）', async () => undefined],
    ['发送抛错', async () => Promise.reject(new Error('Extension context invalidated.'))],
  ])('面板没能打开（%s）：不消失，加说明行与关闭按钮；再点一次打开了就淡出', async (_name, first) => {
    const { deps } = makeDeps();
    deps.sendMessage.mockImplementationOnce(first).mockResolvedValueOnce({ opened: true });
    const toast = mountToast(saved, deps);
    expect(toast.root.querySelector('button[aria-label="关闭"]')).toBeNull();
    const button = buttonIn(toast.root, '加批注…');
    if (!button) throw new Error('没有「加批注…」');
    button.click();
    await settle();
    vi.advanceTimersByTime(TOAST_AUTO_MS + TOAST_FADE_MS + 10);
    expect(hosts()).toHaveLength(1);
    const errors = toast.root.querySelectorAll('.noteerr');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.textContent).toBe(loadMessages('zh_CN').toast_panelFailed?.message);
    expect(errors[0]?.textContent).toBe('没能打开面板。把这个浏览器窗口点到前台，再点一次「加批注…」。');
    expect(toast.root.querySelectorAll('button[aria-label="关闭"]')).toHaveLength(1);
    expect(button.disabled).toBe(false);

    button.click();
    await settle();
    expect(deps.sendMessage).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(hosts()).toHaveLength(0);
  });

  it('连续失败两次：说明行与关闭按钮都只有一个；点关闭收起', async () => {
    const { deps } = makeDeps();
    deps.sendMessage.mockResolvedValue({ opened: false });
    const toast = mountToast(fallback, deps);
    const button = buttonIn(toast.root, '加批注…');
    button?.click();
    await settle();
    button?.click();
    await settle();
    expect(toast.root.querySelectorAll('.noteerr')).toHaveLength(1);
    expect(toast.root.querySelectorAll('button[aria-label="关闭"]')).toHaveLength(1);
    toast.root.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click();
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(hosts()).toHaveLength(0);
  });

  it('英文：失败说明是 en 的 toast_panelFailed，不含中日韩字符', async () => {
    useLocale('en');
    const { deps } = makeDeps();
    deps.sendMessage.mockResolvedValue({ opened: false });
    const toast = mountToast(saved, deps);
    buttonIn(toast.root, 'Add note…')?.click();
    await settle();
    const text = toast.root.querySelector('.noteerr')?.textContent ?? '';
    expect(text).toBe('Couldn\'t open the panel. Bring this browser window to the front and click "Add note…" again.');
    expect(text).toBe(loadMessages('en').toast_panelFailed?.message);
    expect(text).not.toMatch(CJK);
  });
});
