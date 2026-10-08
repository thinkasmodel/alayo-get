// 界面的英文渲染（ALAG-7 brief B §5）：英文环境下面板、页面提示、标签输入、选项页看得到的文字不含中日韩字符；
// 选项页的系统差异（快捷键原样显示、未设置、iCloud 一句与 Workbench 小节只在 Mac 显示）中英文各测一遍。
// 英文逐条取自 designs/alag-6-7/Strings.dc.html 与 OnboardingEn / SettingsEn / PanelEn 三张英文稿。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMessageSourceForTest } from '@/shared/i18n';
import type { ToastNoteToSw } from '@/shared/messages';
import type { Capture, ClipSummary, PanelState, PendingSave, Preview, SavedEntry, SavedIndexData, SaveOutcome } from '@/shared/types';
import { CJK, useLocale } from '../../tests/setup/i18n';
import { richT } from './dom';
import { renderOptions, type LibraryHandle, type OptionsDeps } from './options/render';
import { renderPanel, type PanelActions } from './panel/render';
import { createTagInput } from './panel/tagInput';
import { mountToast, NOTE_ACK_MS, type NotePort, type ToastDeps } from './toast/toast';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 用户看得到或读屏会读出的文字：文本节点拼起来（等同 textContent，但跳过 <style>、<script>——
 * 页面提示的 shadow root 里放着样式表，构建产物里样式表的注释是中文），再接上所有元素的 aria-label、placeholder、title。
 */
function visibleText(root: Node): string {
  const texts: string[] = [];
  const attrs: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.parentElement?.closest('style, script')) texts.push(node.textContent ?? '');
    } else if (node instanceof Element) {
      for (const name of ['aria-label', 'placeholder', 'title']) {
        const value = node.getAttribute(name);
        if (value !== null) attrs.push(value);
      }
    }
  }
  return [texts.join(''), ...attrs].join('\n');
}

/** 英文界面：不含中日韩字符（含全角标点）。 */
function expectNoCjk(root: Node): string {
  const text = visibleText(root);
  expect(text.match(CJK)?.[0], text).toBeUndefined();
  return text;
}

const buttonLabels = (root: ParentNode) => [...root.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
const buttonIn = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

afterEach(() => document.body.replaceChildren());

describe('visibleText 与 richT', () => {
  it('visibleText 拼接文本与 aria-label、placeholder、title，跳过 <style>', () => {
    const root = document.createElement('div');
    root.innerHTML = '<style>/* 注释 */</style><p title="T">a<b>b</b></p><button aria-label="L"></button><input placeholder="P">';
    expect(visibleText(root)).toBe('ab\nT\nL\nP');
  });

  it('richT 按占位符位置放节点，语序可与 nodes 顺序不同', () => {
    setMessageSourceForTest((_key, subs) => `second ${(subs as string[])[1]} then first ${(subs as string[])[0]}.`);
    const one = document.createElement('i');
    one.textContent = '1';
    const two = document.createElement('b');
    two.textContent = '2';
    const p = document.createElement('p');
    for (const child of richT('opt_wayShortcut', [one, two])) if (child) p.append(child);
    expect(p.innerHTML).toBe('second <b>2</b> then first <i>1</i>.');
  });
});

describe('英文：工具栏面板', () => {
  beforeEach(() => useLocale('en'));

  const preview: Preview = {
    title: 'Designing for calm: notes on interface restraint',
    site: 'rauno.me',
    source: 'https://rauno.me/calm',
    medium: 'web',
  };
  const clip: ClipSummary = {
    id: '01JEN',
    file: 'Designing for calm.md',
    title: 'Designing for calm',
    medium: 'web',
    site: 'rauno.me',
    source: 'https://rauno.me/calm',
    extract: 'full',
    imageCount: 3,
    imageFailures: 1,
    tags: ['design'],
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
  const xClip: ClipSummary = {
    ...clip,
    medium: 'x',
    extract: 'partial',
    imageCount: 0,
    imageFailures: 0,
    x: { form: 'thread', posts: 1, partial: { limit: false, timeout: true, truncated: 1 } },
  };

  const actions = (): PanelActions => ({
    postDraft: vi.fn(),
    snapshot: vi.fn(),
    retry: vi.fn(),
    openOptions: vi.fn(),
    openSettings: vi.fn(),
    closePanel: vi.fn(),
    loadIndex: vi.fn(async () => ({})),
  });

  function render(state: PanelState, folderName: string | null = 'Alayo Get'): HTMLElement {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    renderPanel(root, { state, folderName }, actions());
    return root;
  }

  const cases: Array<[string, PanelState, string | null, string[]]> = [
    [
      '保存中',
      { state: 'saving', preview, progress: { phase: 'images', done: 7, total: 12 } },
      'Alayo Get',
      ['Saving…', 'Article extracted. Downloading images 7 / 12', 'Save progress', 'You can edit the title, tags and note once saving finishes.'],
    ],
    [
      '媒体保存中',
      { state: 'saving', preview: { ...preview, medium: 'image' }, progress: { phase: 'extract' } },
      'Alayo Get',
      ['Saving…', 'You can add tags and a note once saving finishes.'],
    ],
    [
      '成功',
      { state: 'saved', clip, tagSuggestions: [] },
      'Alayo Get',
      ['Saved to library', 'Article · 3 images · 1 failed to download', 'Title', 'Tags', 'Note', 'Add a note (optional)', 'Type and press Return', 'Remove tag design', 'Saved when you close the panel'],
    ],
    [
      'X 只存了一部分（条数为 1）',
      { state: 'saved', clip: xClip, tagSuggestions: [] },
      'Alayo Get',
      ['Saved to library', 'Loading didn’t finish within 15 seconds. Saved the 1 post loaded. 1 long post showed only its beginning in the list. A link to the full post is included.'],
    ],
    [
      '书签',
      { state: 'fallback', clip: { ...clip, extract: 'fallback' }, tagSuggestions: [] },
      'Alayo Get',
      ['Saved as a bookmark', 'Couldn’t extract the article. Saved the title, description and cover.', 'Tags', 'Note'],
    ],
    [
      '重复保存',
      { state: 'duplicate', preview, previous },
      'Alayo Get',
      [
        'Already saved on 2026-09-28',
        'Nothing new was saved',
        'The original file may have been moved or edited, so it won’t be overwritten. To keep the current version, save a new snapshot. Its file name will end in “ (2)”.',
        'Save new snapshot',
      ],
    ],
    [
      '失败',
      { state: 'failed', preview, error: { name: 'NotFoundError', message: 'gone' } },
      'Alayo Get',
      ['Couldn’t save to library', 'This page hasn’t been saved yet', 'Can’t find the library folder “Alayo Get”. It may have been moved, renamed or deleted.', 'Choose folder again…', 'Retry'],
    ],
    ['未选库', { state: 'needs-permission', preview }, null, ['No library folder yet', 'This page hasn’t been saved yet', 'Open settings…']],
    [
      '需授权',
      { state: 'needs-permission', preview },
      'Alayo Get',
      [
        'Allow access to your library again',
        'This page hasn’t been saved yet',
        'After restarting, Chrome removed permission to write to the “Alayo Get” folder.',
        'Click the button below. When Chrome asks, choose “Allow on every visit” so you won’t be asked again after restarting.',
        'Allow access and save…',
      ],
    ],
  ];

  it.each(cases)('%s：不含中日韩字符，文案按英文表', (_name, state, folderName, expected) => {
    const root = render(state, folderName);
    const text = expectNoCjk(root);
    for (const s of [...expected, 'Settings']) expect(text).toContain(s);
  });

  it('需授权：“Allow on every visit”加粗', () => {
    const root = render({ state: 'needs-permission', preview });
    expect(root.querySelector('.inset b')?.textContent).toBe('“Allow on every visit”');
  });
});

describe('英文：标签输入', () => {
  beforeEach(() => useLocale('en'));

  const entry = (id: string, tags: string[]): SavedEntry => ({
    id,
    file: `${id}.md`,
    title: id,
    medium: 'web',
    source: `https://example.com/${id}`,
    savedAt: '2026-09-28T12:00:00.000Z',
    tags,
  });
  // calm-tech ×2、calm ×1
  const index: SavedIndexData = { a: entry('a', ['calm-tech', 'calm']), b: entry('b', ['calm-tech']) };

  it('建议列表：新建标签、1 clip / 2 clips；chip 的删除按钮与占位', async () => {
    const tagInput = createTagInput({ id: 'tags', initial: ['design'], loadIndex: async () => index, onChange: vi.fn() });
    document.body.replaceChildren(tagInput.el);
    tagInput.input.value = 'cal';
    tagInput.input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    const options = [...tagInput.el.querySelectorAll('[role="option"]')].map((o) => [o.querySelector('.optlabel')?.textContent, o.querySelector('em')?.textContent]);
    expect(options).toEqual([
      ['calm-tech', '2 clips'],
      ['calm', '1 clip'],
      ['Create tag “cal”', 'Return'],
    ]);
    const text = expectNoCjk(tagInput.el);
    expect(text).toContain('Remove tag design');
    expect(text).toContain('Type and press Return');
  });
});

describe('英文：页面右下角提示', () => {
  beforeEach(() => {
    useLocale('en');
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const clip: ClipSummary = {
    id: '01JTOASTEN',
    file: 'Why calm interfaces are harder to build.md',
    title: 'Why calm interfaces are harder to build',
    medium: 'web',
    site: 'example.com',
    source: 'https://example.com/calm',
    extract: 'full',
    imageCount: 0,
    imageFailures: 0,
    tags: [],
    note: '',
    savedAt: '2026-10-06T12:00:00.000Z',
  };
  const preview: Preview = { title: clip.title, site: clip.site, source: clip.source, medium: 'web' };
  const quoteClip: ClipSummary = {
    ...clip,
    medium: 'quote',
    file: 'Quotes - Thinking, Fast and Slow notes.md',
    quote: { fileId: 'F', entry: 3, anchor: '', fragment: true, recreated: false },
  };

  /** 批注 Port：`broken` 时每次发送都抛错（扩展已失效）。 */
  function makeDeps(broken = false) {
    const notes: ToastNoteToSw[] = [];
    const connectNote = vi.fn(
      (): NotePort => ({
        postMessage: (m) => {
          if (broken) throw new Error('Attempting to use a disconnected port object');
          notes.push(m);
        },
        disconnect: () => undefined,
        onMessage: { addListener: () => undefined },
        onDisconnect: { addListener: () => undefined },
      }),
    );
    return { sendMessage: vi.fn(), connectNote } satisfies ToastDeps;
  }

  const cases: Array<[string, SaveOutcome, string[]]> = [
    ['成功', { state: 'saved', clip, tagSuggestions: [] }, ['Saved to library', clip.title, 'Add note']],
    ['摘录', { state: 'saved', clip: quoteClip, tagSuggestions: [] }, ['Quote saved', 'Quote 3 · Quotes - Thinking, Fast and Slow notes.md', 'Add note']],
    [
      '书签',
      { state: 'fallback', clip: { ...clip, extract: 'fallback' }, tagSuggestions: [] },
      ['Saved as a bookmark', 'Couldn’t extract the article. Saved the title, description and cover.', 'Add note'],
    ],
    [
      '重复保存',
      {
        state: 'duplicate',
        preview,
        previous: { id: '01JOLD', file: clip.file, title: clip.title, medium: 'web', source: clip.source, savedAt: new Date(2026, 8, 28, 12).toISOString(), tags: [] },
      },
      ['Already saved on Sep 28', 'Nothing new was saved', 'Save new snapshot'],
    ],
    ['失败', { state: 'failed', preview, error: { name: 'NotFoundError', message: 'gone' } }, ['Couldn’t save to library', 'Can’t find the library folder. Not saved', 'Retry', 'Close']],
    [
      '需授权',
      { state: 'needs-permission', preview },
      ['Allow access to your library again', 'Not saved yet. It will be saved once you allow access.', 'Allow access…', 'Close'],
    ],
  ];

  it.each(cases)('%s：不含中日韩字符，文案按英文表', (_name, outcome, expected) => {
    const toast = mountToast(outcome, makeDeps());
    const text = expectNoCjk(toast.root);
    for (const s of expected) expect(text).toContain(s);
  });

  it('重复保存：标题是 Already saved on Sep 28（日期后不多空格）', () => {
    const toast = mountToast(cases[3]![1], makeDeps());
    expect(toast.root.querySelector('.tt')?.textContent).toBe('Already saved on Sep 28');
  });

  it('展开批注', () => {
    const toast = mountToast({ state: 'saved', clip, tagSuggestions: [] }, makeDeps());
    buttonIn(toast.root, 'Add note')?.click();
    expect(toast.root.querySelector('textarea')?.getAttribute('placeholder')).toBe('Add a note (optional)');
    const text = expectNoCjk(toast.root);
    for (const s of ['Note', 'Saved when you press Return or Esc']) expect(text).toContain(s);
    expect(buttonLabels(toast.root)).toContain('Save');
  });

  it('批注失败：没有收到扩展的确认', () => {
    const toast = mountToast({ state: 'saved', clip, tagSuggestions: [] }, makeDeps());
    buttonIn(toast.root, 'Add note')?.click();
    buttonIn(toast.root, 'Save')?.click();
    vi.advanceTimersByTime(NOTE_ACK_MS);
    expect(toast.root.querySelector('.noteerr')?.textContent).toBe('Couldn’t save the note: the extension didn’t respond. Press Return to try again.');
    expectNoCjk(toast.root);
  });

  it('批注失败：和扩展的连接断开了', () => {
    const toast = mountToast({ state: 'saved', clip, tagSuggestions: [] }, makeDeps(true));
    buttonIn(toast.root, 'Add note')?.click();
    buttonIn(toast.root, 'Save')?.click();
    expect(toast.root.querySelector('.noteerr')?.textContent).toBe('Couldn’t save the note: lost connection to the extension. Press Return to try again.');
    expectNoCjk(toast.root);
  });

  // ALAG-8：service worker 回的失败原因是整句（可能自带句号），不能接在冒号后面
  describe('批注失败：原因来自 service worker', () => {
    function mountWithReply(locale: 'en' | 'zh_CN') {
      useLocale(locale);
      let listener: ((m: unknown) => void) | undefined;
      const deps = {
        sendMessage: vi.fn(),
        connectNote: vi.fn(
          (): NotePort => ({
            postMessage: () => undefined,
            disconnect: () => undefined,
            onMessage: { addListener: (fn) => void (listener = fn as (m: unknown) => void) },
            onDisconnect: { addListener: () => undefined },
          }),
        ),
      } satisfies ToastDeps;
      const toast = mountToast({ state: 'saved', clip, tagSuggestions: [] }, deps);
      buttonIn(toast.root, locale === 'en' ? 'Add note' : '加批注')?.click();
      buttonIn(toast.root, locale === 'en' ? 'Save' : '写入')?.click();
      return { toast, reply: (message: string) => listener?.({ type: 'commit-failed', message }) };
    }

    it('英文：原因自成一句', () => {
      const { toast, reply } = mountWithReply('en');
      reply('Can’t find this clip');
      expect(toast.root.querySelector('.noteerr')?.textContent).toBe('Couldn’t save the note. Can’t find this clip. Press Return to try again.');
    });

    it('英文：原因自带句号时只留一个', () => {
      const { toast, reply } = mountWithReply('en');
      reply('A requested file or directory could not be found. ');
      expect(toast.root.querySelector('.noteerr')?.textContent).toBe(
        'Couldn’t save the note. A requested file or directory could not be found. Press Return to try again.',
      );
    });

    it('中文：句式不变，原因自带句号时只留一个', () => {
      const { toast, reply } = mountWithReply('zh_CN');
      reply('找不到这条剪藏。');
      expect(toast.root.querySelector('.noteerr')?.textContent).toBe('没能写入批注：找不到这条剪藏。可以再按回车试一次。');
    });
  });
});

// ---- 选项页 ----

type Perm = 'granted' | 'prompt' | 'denied';

function fakeHandle(name: string, query: Perm, request: Perm = 'granted'): LibraryHandle {
  return { name, queryPermission: vi.fn(async () => query), requestPermission: vi.fn(async () => request) };
}

function pendingItems(n: number): PendingSave[] {
  return Array.from({ length: n }, (_, i) => {
    const capture: Capture = {
      url: `https://example.com/${i + 1}`,
      title: `Pending clip ${i + 1}`,
      site: '',
      author: '',
      published: '',
      description: '',
      coverUrl: '',
      markdown: null,
      textLength: 0,
      kind: 'page',
    };
    return { capture, snapshot: false };
  });
}

interface DepsOptions {
  handle?: LibraryHandle;
  pending?: PendingSave[];
  platform?: 'mac' | 'other';
  shortcut?: string | null;
  picked?: LibraryHandle;
  /** 补写结果；不给时按队列全部补存成功回复。 */
  granted?: () => ReturnType<OptionsDeps['notifyGranted']>;
}

function makeDeps(o: DepsOptions = {}): OptionsDeps {
  const pending = o.pending ?? [];
  let stored = o.handle;
  return {
    loadHandle: async () => stored,
    saveHandle: async (h) => {
      stored = h;
    },
    pickDirectory: async () => {
      if (!o.picked) throw new Error('no picked handle');
      return o.picked;
    },
    listPending: async () => pending,
    notifyGranted: o.granted ?? (async () => ({ saved: pending.length })),
    platform: async () => o.platform ?? 'mac',
    shortcut: async () => (o.shortcut === undefined ? '⌥⇧S' : o.shortcut),
  };
}

async function mount(deps: OptionsDeps) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  await renderOptions(root, deps);
  return root;
}

const folderNote = (root: HTMLElement) => root.querySelector('#library .p')?.textContent;
const shortcutRow = (root: HTMLElement) => root.querySelectorAll('.keys .kr')[1]?.firstChild?.textContent;

describe('英文：选项页', () => {
  beforeEach(() => useLocale('en'));

  it('首次设置（Windows，Alt+Shift+S）：没有 Workbench 小节、没有 iCloud，快捷键原样显示，文件夹建议是 hard drive 那句', async () => {
    const root = await mount(makeDeps({ platform: 'other', shortcut: 'Alt+Shift+S' }));
    expect(root.querySelector('details.wb')).toBeNull();
    const text = expectNoCjk(root);
    expect(text).not.toContain('iCloud');
    expect(text).not.toContain('Workbench');
    expect(root.querySelector('.keys .k')?.textContent).toBe('Alt+Shift+S');
    expect(shortcutRow(root)).toBe('Shortcut Alt+Shift+S');
    expect(folderNote(root)).toBe('We suggest creating a new folder named “Alayo Get” on this computer’s hard drive.');
    for (const s of [
      'Setup',
      'Save web pages as local files',
      'Alayo Get saves articles, X posts, quotes, images and videos as files in a local folder you choose. Articles are saved as Markdown, so any editor or notes app can open them.',
      'Choose a library folder',
      'After restarting the browser, allow access once more',
      'Chrome keeps access to a newly chosen folder only until the browser closes. The first time you save after a restart, Alayo Get will ask for access again. Choose “Allow on every visit” and you won’t be asked again.',
      'Illustration of Chrome’s permission prompt',
      'Allow this time',
      'Allow on every visit',
      'Don’t allow',
      'Illustration of Chrome’s prompt. The exact wording depends on your browser.',
      'Ways to save',
      'Click the toolbar icon',
      'Save this page and open the panel to edit title, tags and note',
      'Save this page directly; a notice appears at the bottom right',
      'Right-click menu',
      'This page, a link, an image, audio or video, or selected text',
      'Change shortcut',
    ]) {
      expect(text).toContain(s);
    }
    expect(buttonLabels(root)).toEqual(['Choose folder…', 'Get started']);
  });

  it('首次设置（Mac）：文件夹建议后空一格接 iCloud 句；Workbench 小节为英文', async () => {
    const root = await mount(makeDeps({ platform: 'mac' }));
    expect(folderNote(root)).toBe(
      'We suggest creating a new folder named “Alayo Get” on this computer’s hard drive. Avoid iCloud Drive: with “Optimize Mac Storage” turned on, files may be replaced with placeholders.',
    );
    expect(root.querySelector('details.wb summary')?.textContent).toBe(
      'Use with Alayo WorkbenchOptionalIf you use Workbench, add the library folder as a monitored folder. Each new clip will then show up for you to add.',
    );
    const paths = [...root.querySelectorAll('details.wb .path')].map((el) => el.textContent);
    expect(paths).toEqual([
      'In the menu bar, choose File › New Space… (⌘N) and select the “Alayo Get” folder. The space will be named Alayo Get.',
      'File › Edit Current Space… › Monitored Folders › Add Folder…, select the folder, then click “Add to Monitored Folders”.',
    ]);
    expect([...root.querySelectorAll('details.wb .k')].map((el) => el.textContent)).toEqual(['File', 'New Space…', '⌘N', 'File', 'Edit Current Space…', 'Add Folder…']);
    const text = expectNoCjk(root);
    for (const s of ['Create a new space', 'Add to an existing space', 'After that, each time you save, Workbench shows “The source has 1 new file” at the top. Click “View” and add it from the Review Inbox.']) {
      expect(text).toContain(s);
    }
  });

  it('首次设置选好文件夹后：Done、Change…、Get started 可点', async () => {
    const root = await mount(makeDeps({ picked: fakeHandle('Alayo Get', 'granted') }));
    buttonIn(root, 'Choose folder…')?.click();
    await flush();
    await flush();
    const text = expectNoCjk(root);
    expect(text).toContain('Done');
    expect(buttonIn(root, 'Change…')).toBeDefined();
    expect(buttonIn(root, 'Get started')?.disabled).toBe(false);
  });

  it('设置页（已授权）：Settings、Library', async () => {
    const root = await mount(makeDeps({ handle: fakeHandle('Alayo Get', 'granted') }));
    const text = expectNoCjk(root);
    for (const s of ['Settings', 'Library', 'Use with Alayo Workbench']) expect(text).toContain(s);
  });

  it('设置页 + 重新授权 + 待补存 1 条 + 快捷键未设置', async () => {
    const root = await mount(makeDeps({ handle: fakeHandle('Alayo Get', 'prompt'), pending: pendingItems(1), shortcut: null }));
    const text = expectNoCjk(root);
    expect(root.querySelector('.pl')?.textContent).toBe('1 clip will be saved after you allow access');
    expect(root.querySelector('.kr .none')?.textContent).toBe('Not set');
    expect(root.querySelector('.keys .k')).toBeNull();
    expect(shortcutRow(root)).toBe('Shortcut Not set');
    expect(root.querySelector('#reauth .stt')?.textContent).toBe('Allow access to your library again');
    expect(root.querySelector('#reauth .p')?.textContent).toBe(
      'After restarting, Chrome removed permission to write to the “Alayo Get” folder. Click “Allow access…” and choose “Allow on every visit” in the prompt, so you won’t be asked again after future restarts.',
    );
    expect(root.querySelector('#reauth .p b')?.textContent).toBe('“Allow on every visit”');
    expect(text).toContain('Pending clip 1');
    expect(buttonIn(root, 'Allow access…')).toBeDefined();
  });

  it('待补存 2 条与超过显示条数', async () => {
    const two = await mount(makeDeps({ handle: fakeHandle('Alayo Get', 'prompt'), pending: pendingItems(2) }));
    expect(two.querySelector('.pl')?.textContent).toBe('2 clips will be saved after you allow access');
    expectNoCjk(two);
    const seven = await mount(makeDeps({ handle: fakeHandle('Alayo Get', 'prompt'), pending: pendingItems(7) }));
    expect(seven.querySelector('.pi.more')?.textContent).toBe('7 in total');
    expectNoCjk(seven);
  });

  it('授权被拒', async () => {
    const root = await mount(makeDeps({ handle: fakeHandle('Alayo Get', 'prompt', 'denied'), pending: pendingItems(1) }));
    buttonIn(root, 'Allow access…')?.click();
    await flush();
    expect(root.querySelector('.denied')?.textContent).toBe('Access wasn’t allowed. You can click “Allow access…” again.');
    expectNoCjk(root);
  });

  it.each([
    [1, 'Access allowed. Saving 1 pending clip…', 'Access allowed. Saved 1 pending clip'],
    [2, 'Access allowed. Saving 2 pending clips…', 'Access allowed. Saved 2 pending clips'],
  ])('授权成功，补存 %i 条：补写中与补写结束', async (n, saving, saved) => {
    let reply: (value: { saved: number }) => void = () => undefined;
    const granted = () => new Promise<{ saved: number }>((resolve) => (reply = resolve));
    const root = await mount(makeDeps({ handle: fakeHandle('Alayo Get', 'prompt'), pending: pendingItems(n), granted }));
    buttonIn(root, 'Allow access…')?.click();
    await flush();
    expect(root.querySelector('#reauth .stt')?.textContent).toBe(saving);
    expectNoCjk(root);
    reply({ saved: n });
    await flush();
    expect(root.querySelector('#reauth .stt')?.textContent).toBe(saved);
    const text = expectNoCjk(root);
    expect(text).toContain('You can close this page and keep browsing.');
  });

  it('授权成功、队列为空：Access allowed', async () => {
    const root = await mount(makeDeps({ handle: fakeHandle('Alayo Get', 'prompt') }));
    buttonIn(root, 'Allow access…')?.click();
    await flush();
    expect(root.querySelector('#reauth .stt')?.textContent).toBe('Access allowed');
    expectNoCjk(root);
  });
});

describe('中文：选项页的系统差异', () => {
  it('非 Mac：首次设置页与设置页都没有 Workbench 小节；文件夹建议只有新文案，没有 iCloud 句', async () => {
    const onboarding = await mount(makeDeps({ platform: 'other' }));
    expect(onboarding.querySelector('details.wb')).toBeNull();
    expect(onboarding.textContent).not.toContain('iCloud');
    expect(folderNote(onboarding)).toBe('建议在本机硬盘上新建一个“Alayo Get”文件夹。');
    const settings = await mount(makeDeps({ platform: 'other', handle: fakeHandle('Alayo Get', 'prompt'), pending: pendingItems(1) }));
    expect(settings.querySelector('details.wb')).toBeNull();
    expect(settings.textContent).not.toContain('Workbench');
  });

  it('Mac：文件夹建议后直接接 iCloud 句', async () => {
    const root = await mount(makeDeps({ platform: 'mac' }));
    expect(folderNote(root)).toBe('建议在本机硬盘上新建一个“Alayo Get”文件夹。不要放进 iCloud 云盘：开了“优化 Mac 存储空间”后，文件可能被替换成占位文件。');
    expect(root.querySelector('details.wb')).not.toBeNull();
  });

  it('快捷键：原样显示用户设置的组合键；清空时显示“未设置”', async () => {
    const set = await mount(makeDeps({ shortcut: 'Ctrl+Shift+Y' }));
    expect(set.querySelector('.keys .k')?.textContent).toBe('Ctrl+Shift+Y');
    expect(shortcutRow(set)).toBe('快捷键 Ctrl+Shift+Y');
    const none = await mount(makeDeps({ shortcut: null }));
    expect(none.querySelector('.kr .none')?.textContent).toBe('未设置');
    expect(none.querySelector('.keys .k')).toBeNull();
    expect(shortcutRow(none)).toBe('快捷键 未设置');
  });
});
