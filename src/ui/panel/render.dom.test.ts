import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClipSummary, EditFields, PanelState, Preview, SavedEntry } from '@/shared/types';
import { icon } from '../icons';
import { renderPanel, type PanelActions } from './render';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const preview: Preview = {
  title: 'Designing for calm: notes on interface restraint',
  site: 'rauno.me',
  source: 'https://rauno.me/calm',
  medium: 'web',
};

const clip: ClipSummary = {
  id: '01JPANEL',
  file: 'Designing for calm.md',
  title: 'Designing for calm',
  medium: 'web',
  site: 'rauno.me',
  source: 'https://rauno.me/calm',
  extract: 'full',
  imageCount: 12,
  imageFailures: 0,
  tags: ['设计'],
  note: '',
  savedAt: '2026-10-06T12:00:00.000Z',
};

const previous: SavedEntry = {
  id: '01JPREV',
  file: 'Designing for calm (old).md',
  title: 'Designing for calm',
  medium: 'web',
  source: 'https://rauno.me/calm',
  savedAt: new Date(2026, 8, 28, 12).toISOString(),
  tags: [],
};

function makeActions() {
  return {
    postDraft: vi.fn<(fields: Required<EditFields>) => void>(),
    snapshot: vi.fn(),
    retry: vi.fn(),
    openOptions: vi.fn<PanelActions['openOptions']>(),
    openSettings: vi.fn(),
    closePanel: vi.fn(),
    loadIndex: vi.fn(async () => ({})),
  } satisfies PanelActions;
}

function render(state: PanelState, folderName: string | null = 'Alayo Get') {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const actions = makeActions();
  renderPanel(root, { state, folderName }, actions);
  const text = root.textContent ?? '';
  const buttons = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  return { root, actions, text, buttons, button };
}

afterEach(() => document.body.replaceChildren());

describe('面板 7 种视图', () => {
  it('保存中：进度文案、进度条、预览卡、提示语，底栏无按钮', () => {
    const { root, text, buttons } = render({ state: 'saving', preview, progress: { phase: 'images', done: 7, total: 12 } });
    expect(text).toContain('正在保存…');
    expect(text).toContain('正文已抽取，正在下载图片 7 / 12');
    expect(text).toContain('保存完成后可以补标题、标签和批注。');
    expect(text).toContain(preview.title);
    expect(text).toContain('rauno.me');
    expect(root.querySelector<HTMLElement>('.barfill')?.style.width).toBe('55%');
    expect(root.querySelector('.foot')?.textContent).toBe('Alayo Get');
    expect(buttons).toEqual(['']); // 只有头部的设置按钮（纯图标）
    expect(root.querySelector('button[aria-label="设置"]')).not.toBeNull();
  });

  it('已保存：状态行、说明行、文件名、三个字段，底栏"关闭面板时自动写入"，没有"写入修改"', () => {
    const { root, text, buttons } = render({ state: 'saved', clip, tagSuggestions: [] });
    expect(text).toContain('已存入剪藏库');
    expect(text).toContain('文章剪藏 · 含 12 张图片');
    expect(text).toContain('Designing for calm.md');
    const labels = [...root.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toEqual(['标题', '标签', '批注']);
    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.placeholder).toBe('添加批注（可选）');
    expect(root.querySelector('.foot')?.textContent).toContain('关闭面板时自动写入');
    expect(text).not.toContain('写入修改');
    expect(buttons).not.toContain('写入修改');
    expect(document.activeElement).toBe(root.querySelector('textarea'));
  });

  it('已保存（完整）：文件名一行没有 .fnrow、.mchip 和原因小字', () => {
    const { root } = render({ state: 'saved', clip, tagSuggestions: [] });
    expect(root.querySelector('.fnrow')).toBeNull();
    expect(root.querySelector('.mchip')).toBeNull();
    expect(root.querySelector('.body > .note')).toBeNull();
  });

  it('X 剪藏只存了一部分：文件名行右侧 extract: partial chip，下面一行原因小字，其余同已保存（ALAG-3）', () => {
    const partialClip: ClipSummary = {
      ...clip,
      file: '@naval - How to Get Rich (without getting.md',
      title: '@naval - How to Get Rich (without getting',
      medium: 'x',
      site: 'x.com',
      extract: 'partial',
      imageCount: 0,
      x: { form: 'thread', posts: 50, partial: { limit: true, timeout: false, truncated: 2 } },
    };
    const { root, text } = render({ state: 'saved', clip: partialClip, tagSuggestions: [] });
    expect(text).toContain('已存入剪藏库');
    expect(text).toContain('X 作者串 · 50 条');
    const row = root.querySelector('.fnrow');
    expect(row?.querySelector('.fn')?.textContent).toBe('@naval - How to Get Rich (without getting.md');
    expect(row?.querySelector('.mchip')?.textContent).toBe('extract: partial');
    const note = row?.nextElementSibling;
    expect(note?.className).toBe('note');
    expect(note?.textContent).toBe('作者串超过 50 条，只存了前 50 条。有 2 条长帖在列表里只显示了开头，已在文中附上原帖链接。');
    expect([...root.querySelectorAll('label')].map((l) => l.textContent)).toEqual(['标题', '标签', '批注']);
    expect(root.querySelector('.sicon.success')).not.toBeNull();
  });

  it('右键保存链接抓取失败（saved、link、extract: partial）：不显示 X 的 partial chip 和原因小字（ALAG-3 之前的样子）', () => {
    const linkClip: ClipSummary = { ...clip, medium: 'link', extract: 'partial', imageCount: 0 };
    const { root } = render({ state: 'saved', clip: linkClip, tagSuggestions: [] });
    expect(root.querySelector('.fnrow')).toBeNull();
    expect(root.querySelector('.mchip')).toBeNull();
    expect(root.querySelector('.fn')?.textContent).toBe(linkClip.file);
  });

  it('退化为书签：状态行、extract chip，只有标签和批注两个字段', () => {
    const { root, text } = render({
      state: 'fallback',
      clip: { ...clip, title: 'Config 2026 · 日程与讲者', site: 'figma.com', extract: 'fallback', medium: 'link', imageCount: 0 },
      tagSuggestions: [],
    });
    expect(text).toContain('已存为书签剪藏');
    expect(text).toContain('没能抽取正文，已保存标题、描述和封面');
    expect(text).toContain('extract: fallback');
    expect(text).toContain('Config 2026 · 日程与讲者');
    expect([...root.querySelectorAll('label')].map((l) => l.textContent)).toEqual(['标签', '批注']);
    expect(root.querySelector('.foot')?.textContent).toContain('关闭面板时自动写入');
    expect(document.activeElement).toBe(root.querySelector('textarea'));
  });

  it('已存过：日期、说明、次按钮"另存一份新快照"', () => {
    const { text, buttons, button, actions } = render({ state: 'duplicate', preview, previous });
    expect(text).toContain('已于 2026-09-28 保存过');
    expect(text).toContain('本次没有写入');
    expect(text).toContain('Designing for calm (old).md');
    expect(text).toContain('原文件可能已被移动或改过，所以不会覆盖它。需要当前版本时，可以另存一份新快照，文件名会加“ (2)”。');
    expect(buttons).toContain('另存一份新快照');
    button('另存一份新快照')?.click();
    expect(actions.snapshot).toHaveBeenCalledTimes(1);
  });

  it('失败：danger 标题、原因、错误名与文件夹名，"重新选择文件夹…"与"重试"', () => {
    const { root, text, buttons, button, actions } = render({
      state: 'failed',
      preview,
      error: { name: 'NotFoundError', message: 'not found' },
    });
    expect(root.querySelector('.st.err')?.textContent).toBe('没能写入剪藏库');
    expect(text).toContain('本次内容还没有保存');
    expect(text).toContain('找不到剪藏库文件夹“Alayo Get”，它可能被移动、改名或删除了。');
    expect(root.querySelector('.mono')?.textContent).toBe('NotFoundError · Alayo Get');
    expect(buttons).toEqual(expect.arrayContaining(['重新选择文件夹…', '重试']));
    button('重新选择文件夹…')?.click();
    expect(actions.openOptions).toHaveBeenCalledWith('library');
    button('重试')?.click();
    expect(actions.retry).toHaveBeenCalledTimes(1);
  });

  it('需要重新授权：锁图标状态行、事实陈述、内嵌块，"授权并保存…"打开选项页后关闭面板', async () => {
    const { root, text, button, actions } = render({ state: 'needs-permission', preview });
    expect(text).toContain('需要重新授权剪藏库');
    expect(text).toContain('本次内容还没有保存');
    expect(text).toContain('Chrome 重启后收回了写入“Alayo Get”文件夹的权限。');
    expect(root.querySelector('.inset')?.textContent).toContain('“每次访问时都允许”');
    button('授权并保存…')?.click();
    expect(actions.openOptions).toHaveBeenCalledWith('reauth');
    await flush();
    expect(actions.closePanel).toHaveBeenCalledTimes(1);
  });

  it('尚未选择剪藏库：状态行换文案，没有内嵌块，按钮"去设置…"', () => {
    const { root, text, buttons, button, actions } = render({ state: 'needs-permission', preview }, null);
    expect(text).toContain('还没有选择剪藏库');
    expect(text).toContain('本次内容还没有保存');
    expect(root.querySelector('.inset')).toBeNull();
    expect(buttons).toContain('去设置…');
    expect(buttons).not.toContain('授权并保存…');
    button('去设置…')?.click();
    expect(actions.openOptions).toHaveBeenCalledWith('library');
  });
});

describe('字段修改即发 draft（三个字段全量）', () => {
  it('改标题、批注、标签都会发出包含 title / tags / note 的 draft', async () => {
    const { root, actions } = render({ state: 'saved', clip, tagSuggestions: [] });
    const title = root.querySelector<HTMLInputElement>('#f-title');
    const note = root.querySelector<HTMLTextAreaElement>('#f-note');
    const tags = root.querySelector<HTMLInputElement>('#f-tags');
    if (!title || !note || !tags) throw new Error('字段没渲染出来');

    title.value = '新标题';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    expect(actions.postDraft).toHaveBeenLastCalledWith({ title: '新标题', tags: ['设计'], note: '' });

    note.value = '批注';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    expect(actions.postDraft).toHaveBeenLastCalledWith({ title: '新标题', tags: ['设计'], note: '批注' });

    tags.value = '读书';
    tags.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    tags.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(actions.postDraft).toHaveBeenLastCalledWith({ title: '新标题', tags: ['设计', '读书'], note: '批注' });
    expect(actions.postDraft).toHaveBeenCalledTimes(3);
  });

  it('fallback 没有标题框，draft 仍带原标题', () => {
    const { root, actions } = render({ state: 'fallback', clip: { ...clip, extract: 'fallback' }, tagSuggestions: [] });
    const note = root.querySelector<HTMLTextAreaElement>('#f-note');
    if (!note) throw new Error('批注框没渲染出来');
    note.value = 'x';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    expect(actions.postDraft).toHaveBeenLastCalledWith({ title: 'Designing for calm', tags: ['设计'], note: 'x' });
  });
});

describe('媒体剪藏与流媒体剪藏（ALAG-4）', () => {
  const MB = 1024 * 1024;
  const mediaClip: ClipSummary = {
    ...clip,
    id: '01JMEDIA',
    file: 'Attention Is All You Need - 1706.03762v7.pdf',
    title: 'Attention Is All You Need',
    medium: 'pdf',
    site: 'arxiv.org',
    source: 'https://arxiv.org/pdf/1706.03762v7',
    imageCount: 0,
    tags: [],
    media: { kind: 'pdf', bytes: 40.1 * MB },
  };
  const directClip: ClipSummary = {
    ...clip,
    id: '01JDIRECT',
    file: 'WWDC 主题演讲 - keynote-1080p.mp4.md',
    title: 'WWDC 主题演讲 - keynote-1080p.mp4',
    medium: 'video',
    imageCount: 0,
    stream: { platform: 'other', duration: null, medium: 'video', oversize: { bytes: 1.8 * 1024 * MB } },
  };

  const cardIcon = (root: HTMLElement) => root.querySelector('.card .g')?.innerHTML;

  it('保存中下载 PDF：说明行写下载量，预览卡用 file 字形，提示句只说标签和批注', () => {
    const { root, text } = render({
      state: 'saving',
      preview: { title: 'Attention Is All You Need', site: 'arxiv.org', source: 'https://arxiv.org/pdf/1706.03762v7', medium: 'pdf' },
      progress: { phase: 'download', done: 12.3 * MB, total: 40.1 * MB, kind: 'pdf' },
    });
    expect(text).toContain('正在下载 PDF，12.3 / 40.1 MB');
    expect(text).toContain('保存完成后可以补标签和批注。');
    expect(text).not.toContain('补标题');
    expect(cardIcon(root)).toBe(icon('file', 16));
  });

  it('预览卡图标按形态取', () => {
    const cases: Array<[Preview['medium'], Parameters<typeof icon>[0]]> = [
      ['web', 'doc'],
      ['link', 'link'],
      ['image', 'image'],
      ['pdf', 'file'],
      ['audio', 'audio'],
      ['video', 'video'],
      ['stream', 'play'],
      ['quote', 'quote'],
    ];
    for (const [medium, name] of cases) {
      const { root } = render({ state: 'saving', preview: { ...preview, medium }, progress: { phase: 'extract' } });
      expect(cardIcon(root), medium).toBe(icon(name, 16));
    }
    // 流媒体存完能改标题，提示句照旧
    expect(render({ state: 'saving', preview: { ...preview, medium: 'stream' }, progress: { phase: 'extract' } }).text).toContain('保存完成后可以补标题、标签和批注。');
  });

  it('媒体剪藏已保存：说明行带类别与大小，没有标题框，只有标签和批注；draft 仍发三个字段（title 原样）', () => {
    const { root, text, actions } = render({ state: 'saved', clip: mediaClip, tagSuggestions: [] });
    expect(text).toContain('已存入剪藏库');
    expect(text).toContain('媒体剪藏 · PDF · 40.1 MB');
    expect(root.querySelector('.fn')?.textContent).toBe(mediaClip.file);
    expect([...root.querySelectorAll('label')].map((l) => l.textContent)).toEqual(['标签', '批注']);
    expect(root.querySelector('#f-title')).toBeNull();
    expect(root.querySelector('.body > .note')).toBeNull();
    const note = root.querySelector<HTMLTextAreaElement>('#f-note');
    if (!note) throw new Error('没有批注框');
    note.value = '经典';
    note.dispatchEvent(new Event('input'));
    expect(actions.postDraft).toHaveBeenLastCalledWith({ title: mediaClip.title, tags: [], note: '经典' });
  });

  it('超过 100MB 的直链：文件名下一行 .note 小字，不加 chip，标题框照常', () => {
    const { root, text } = render({ state: 'saved', clip: directClip, tagSuggestions: [] });
    expect(text).toContain('流媒体剪藏 · 视频直链');
    expect(root.querySelector('.body > .note')?.textContent).toBe('文件有 1.8 GB，超过 100MB，没有下载，只记了链接。');
    expect(root.querySelector('.mchip')).toBeNull();
    expect([...root.querySelectorAll('label')].map((l) => l.textContent)).toEqual(['标题', '标签', '批注']);

    const unknown = render({ state: 'saved', clip: { ...directClip, stream: { platform: 'other', duration: null, medium: 'video', oversize: { bytes: null } } }, tagSuggestions: [] });
    expect(unknown.root.querySelector('.body > .note')?.textContent).toBe('拿不到文件大小，没有下载，只记了链接。');
  });

  it('平台流媒体剪藏：说明行写平台与时长，没有小字', () => {
    const { root, text } = render({
      state: 'saved',
      clip: { ...clip, medium: 'video', stream: { platform: 'youtube', duration: 213, medium: 'video' } },
      tagSuggestions: [],
    });
    expect(text).toContain('流媒体剪藏 · YouTube · 3:33');
    expect(root.querySelector('.body > .note')).toBeNull();
  });
});

describe('面向通用用户（ALAG-6）', () => {
  const states: [string, PanelState][] = [
    ['saving', { state: 'saving', preview, progress: { phase: 'images', done: 7, total: 12 } }],
    ['saved', { state: 'saved', clip, tagSuggestions: [] }],
    ['fallback', { state: 'fallback', clip: { ...clip, extract: 'fallback', medium: 'link', imageCount: 0 }, tagSuggestions: [] }],
    ['duplicate', { state: 'duplicate', preview, previous }],
    ['failed', { state: 'failed', preview, error: { name: 'NotFoundError', message: 'not found' } }],
    ['needs-permission', { state: 'needs-permission', preview }],
  ];

  it.each(states)('%s：面板文字不提 Workbench', (_name, state) => {
    expect(render(state).text).not.toContain('Workbench');
    expect(render(state, null).text).not.toContain('Workbench');
  });
});

describe('从页面提示「加批注…」进入的编辑态（ALAG-16）', () => {
  it('摘录剪藏已保存：状态行“已摘录”＋摘录说明行，文件名，只有批注框并自动聚焦；draft 仍发三个字段', () => {
    const quoteClip: ClipSummary = {
      ...clip,
      id: '01JQUOTE',
      medium: 'quote',
      file: '摘录 - 为什么我们需要慢思考.md',
      title: '为什么我们需要慢思考',
      tags: [],
      note: '旧批注',
      quote: { fileId: 'F', entry: 3, anchor: 'a', fragment: true, recreated: false },
    };
    const { root, actions } = render({ state: 'saved', clip: quoteClip, tagSuggestions: [] });
    expect(root.querySelector('.st')?.textContent).toBe('已摘录');
    expect(root.querySelector('.sm')?.textContent).toBe('第 3 条 · 摘录 - 为什么我们需要慢思考.md');
    expect(root.querySelector('.fn')?.textContent).toBe('摘录 - 为什么我们需要慢思考.md');
    expect([...root.querySelectorAll('label')].map((l) => l.textContent)).toEqual(['批注']);
    expect(root.querySelector('#f-title')).toBeNull();
    expect(root.querySelector('#f-tags')).toBeNull();
    expect(root.querySelectorAll('input')).toHaveLength(0);
    const note = root.querySelector('textarea');
    expect(note?.value).toBe('旧批注');
    expect(document.activeElement).toBe(note);
    expect(root.querySelector('.foot')?.textContent).toContain('关闭面板时自动写入');
    if (!note) return;
    note.value = '面板里写的批注';
    note.dispatchEvent(new Event('input'));
    expect(actions.postDraft).toHaveBeenLastCalledWith({ title: quoteClip.title, tags: [], note: '面板里写的批注' });
  });
});
