// 选项页（DESIGN.md §3.5，设计稿 Onboarding.dc.html、Reauth.dc.html）：首次使用引导、设置、重新授权。
// 选目录（showDirectoryPicker）与恢复授权（requestPermission）只在这里做（ADR-0004）。
import { currentLang, t, tn } from '@/shared/i18n';
import type { PendingSave } from '@/shared/types';
import { h, iconEl, richT, type Child } from '../dom';
import { PENDING_SHOWN } from '../format';

type PermissionResult = 'granted' | 'prompt' | 'denied';

/** FSA 目录句柄里本页用到的部分（TS 的 DOM 库没有权限方法）。 */
export interface LibraryHandle {
  readonly name: string;
  queryPermission(desc: { mode: 'readwrite' }): Promise<PermissionResult>;
  requestPermission(desc: { mode: 'readwrite' }): Promise<PermissionResult>;
}

export interface OptionsDeps {
  loadHandle(): Promise<LibraryHandle | undefined>;
  saveHandle(handle: LibraryHandle): Promise<void>;
  /** 生产实现调 `showDirectoryPicker({ id: 'alayo-get-library', mode: 'readwrite', startIn: 'documents' })`。 */
  pickDirectory(): Promise<LibraryHandle>;
  listPending(): Promise<PendingSave[]>;
  /**
   * 发 `{ type: 'library-granted' }`，等 service worker 补写结束后返回实际补存的条数。
   * 没收到回复（service worker 出错）时返回 undefined。
   */
  notifyGranted(): Promise<GrantedResult | undefined>;
  /** 生产实现：browser.runtime.getPlatformInfo() 的 os === 'mac' → 'mac'，其余 'other'。 */
  platform(): Promise<'mac' | 'other'>;
  /** 生产实现：browser.commands.getAll() 里 name 为 'save-page' 的 shortcut；找不到或为空串 → null。 */
  shortcut(): Promise<string | null>;
}

export interface OptionsPage {
  /** 按锚点定位：`#reauth`、`#library`。 */
  applyAnchor(hash: string): void;
}

export interface GrantedResult {
  /** 实际补存成功的条数。 */
  saved: number;
}

// 授权成功后先显示“正在补存”，等 service worker 回复补写结果再改成“补存了 N 条”，不提前说已存入（DESIGN §1.3）。
type ReauthStatus =
  | { kind: 'idle' }
  | { kind: 'denied' }
  | { kind: 'granted'; count: number; saved: number | null; done: boolean };

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

function button(label: string, className: string, onclick: () => void, extra: Record<string, string | boolean> = {}): HTMLButtonElement {
  return h('button', { type: 'button', class: `btn ${className}`, onclick, ...extra }, label);
}

function topBar(caption: string): HTMLElement {
  return h('div', { class: 'top' }, [iconEl('brand', 18, 'brandicon'), h('span', {}, 'Alayo Get'), h('em', {}, caption)]);
}

/** Chrome 询问框示意图（不是可点的控件）。 */
function dialogMock(): HTMLElement {
  return h('div', { class: 'dlg', role: 'img', 'aria-label': t('dlg_label') }, [
    h('div', { class: 'dl', style: 'width:78%' }),
    h('div', { class: 'dl', style: 'width:52%' }),
    h('div', { class: 'dbtns' }, [
      h('span', { class: 'dbtn' }, t('dlg_allowOnce')),
      h('span', { class: 'dbtn hl' }, t('dlg_allowEvery')),
      h('span', { class: 'dbtn' }, t('dlg_deny')),
    ]),
  ]);
}

function key(text: string): HTMLElement {
  return h('span', { class: 'k' }, text);
}

/** 重新授权说明里加粗的“每次访问时都允许”，与询问框示意的按钮同一文案。 */
function allowEveryVisit(): HTMLElement {
  return h('b', {}, `“${t('dlg_allowEvery')}”`);
}

/** 保存方式。快捷键原样显示用户实际设置的组合键；用户清空了快捷键时显示“未设置”。 */
function saveWays(shortcut: string | null): Child[] {
  const keys = shortcut ? key(shortcut) : h('span', { class: 'none' }, t('opt_shortcutNotSet'));
  return [
    h('div', { class: 'fl section' }, t('opt_waysTitle')),
    h('div', { class: 'keys' }, [
      h('div', { class: 'kr' }, [t('opt_wayToolbar'), h('span', {}, t('opt_wayToolbarDesc'))]),
      h('div', { class: 'kr' }, [h('div', {}, richT('opt_wayShortcut', [keys])), h('span', {}, t('opt_wayShortcutDesc'))]),
      h('div', { class: 'kr' }, [t('opt_wayMenu'), h('span', {}, t('opt_wayMenuDesc'))]),
      h('div', { class: 'kr' }, [t('opt_wayChangeShortcut'), h('span', {}, 'chrome://extensions/shortcuts')]),
    ]),
  ];
}

/**
 * 配合 Alayo Workbench 使用的可选说明（ALAG-6）：首次设置页与设置页共用，默认收起。
 * 页面每次重绘都会重建这个节点，展开状态由调用方保存：`open` 决定初始是否展开，展开或收起时回调 `onToggle`。
 */
function workbenchSection(open: boolean, onToggle: (open: boolean) => void): HTMLDetailsElement {
  // 重绘后被替换下来的旧节点仍会派发 toggle，忽略它
  const ontoggle = () => {
    if (details.isConnected) onToggle(details.open);
  };
  const details: HTMLDetailsElement = h('details', { class: 'wb', open, ontoggle }, [
    h('summary', {}, [
      h('div', { class: 'wbt' }, [
        h('b', {}, [t('wb_title'), h('i', {}, t('wb_optional'))]),
        h('span', {}, t('wb_summary')),
      ]),
      iconEl('chevronRight', 16, 'chev'),
    ]),
    h('div', { class: 'wbb' }, [
      h('div', { class: 'ways' }, [
        h('div', { class: 'way' }, [
          h('div', { class: 'wt' }, t('wb_newSpaceTitle')),
          h('div', { class: 'path' }, richT('wb_newSpacePath', [key(t('wb_menuFile')), key(t('wb_menuNewSpace')), key('⌘N')])),
        ]),
        h('div', { class: 'way' }, [
          h('div', { class: 'wt' }, t('wb_existingTitle')),
          h('div', { class: 'path' }, richT('wb_existingPath', [key(t('wb_menuFile')), key(t('wb_menuEditSpace')), key(t('wb_menuAddFolder'))])),
        ]),
      ]),
      h('p', { class: 'p' }, t('wb_after')),
    ]),
  ]);
  return details;
}

function pendingTitle(item: PendingSave): string {
  return item.capture.title || item.capture.url;
}

export async function renderOptions(root: HTMLElement, deps: OptionsDeps): Promise<OptionsPage> {
  // 系统与快捷键只在打开页面时取一次，重绘沿用
  const [platform, shortcut] = await Promise.all([deps.platform(), deps.shortcut()]);
  /** Workbench 只有 Mac 版：其他系统不显示这一节（ALAG-7）。 */
  const showWorkbench = platform === 'mac';
  let handle = await deps.loadHandle();
  let permission: PermissionResult = handle ? await handle.queryPermission({ mode: 'readwrite' }) : 'prompt';
  let view: 'onboarding' | 'settings' = handle ? 'settings' : 'onboarding';
  /** 进入设置页时权限不是 granted 才显示重新授权卡片；授权成功后卡片留着显示结果。 */
  let showReauth = handle !== undefined && permission !== 'granted';
  let reauth: ReauthStatus = { kind: 'idle' };
  /** Workbench 小节是否展开；首次设置页与设置页共用，重绘时沿用。 */
  let workbenchOpen = false;
  const onWorkbenchToggle = (open: boolean) => {
    workbenchOpen = open;
  };
  const pending: PendingSave[] = showReauth ? await deps.listPending() : [];

  const chooseFolder = async () => {
    let picked: LibraryHandle;
    try {
      picked = await deps.pickDirectory();
    } catch (err) {
      if (!isAbort(err)) console.error('[Alayo Get] 选择文件夹失败', err);
      return;
    }
    await deps.saveHandle(picked);
    handle = picked;
    // 刚选完，本次会话已有权限，service worker 可以补写暂存的剪藏
    permission = await picked.queryPermission({ mode: 'readwrite' }).catch((): PermissionResult => 'granted');
    if (permission === 'granted' && reauth.kind !== 'granted') showReauth = false;
    await deps.notifyGranted();
    render();
  };

  const authorize = async () => {
    if (!handle) return;
    // 先调 requestPermission（需要用户激活），再读点击前的队列长度
    const request = handle.requestPermission({ mode: 'readwrite' });
    const before = deps.listPending().catch(() => pending);
    let result: PermissionResult;
    try {
      result = await request;
    } catch (err) {
      console.error('[Alayo Get] 请求授权失败', err);
      result = 'denied';
    }
    const count = (await before).length;
    permission = result;
    if (result === 'granted') {
      reauth = { kind: 'granted', count, saved: null, done: count === 0 };
      render();
      if (count > 0) {
        const reply = await deps.notifyGranted();
        reauth = { kind: 'granted', count, saved: reply?.saved ?? null, done: true };
      } else {
        await deps.notifyGranted();
      }
    } else {
      reauth = { kind: 'denied' };
    }
    render();
    if (result !== 'granted') root.querySelector<HTMLButtonElement>('#authorize')?.focus();
  };

  const chosenRow = (name: string, inset: boolean): HTMLElement =>
    h('div', { class: inset ? 'chosen inset' : 'chosen' }, [
      iconEl('folder', 16, 'muted'),
      h('code', {}, name),
      button(t('opt_change'), 'sec', () => void chooseFolder()),
    ]);

  const reauthCard = (): HTMLElement => {
    if (reauth.kind === 'granted') {
      const title = !reauth.done
        ? tn('opt_grantedSaving', reauth.count)
        : reauth.saved !== null && reauth.saved > 0
          ? tn('opt_grantedSaved', reauth.saved)
          : t('opt_granted');
      return h('section', { class: 'card', id: 'reauth' }, [
        iconEl('check', 18, 'ic ok'),
        h('div', { class: 'sc' }, [h('div', { class: 'stt' }, title), h('p', { class: 'p' }, t('opt_grantedHint'))]),
      ]);
    }
    const name = handle?.name ?? '';
    const shown = pending.slice(0, PENDING_SHOWN);
    return h('section', { class: 'card focus', id: 'reauth' }, [
      iconEl('lock', 14, 'ic'),
      h('div', { class: 'sc' }, [
        h('div', { class: 'stt' }, t('ui_needsPermissionTitle')),
        h('p', { class: 'p' }, richT('opt_reauthBody', [document.createTextNode(name), allowEveryVisit()])),
        dialogMock(),
        pending.length > 0
          ? h('div', { class: 'pend' }, [
              h('div', { class: 'pl' }, tn('opt_pending', pending.length)),
              ...shown.map((item) => h('div', { class: 'pi' }, pendingTitle(item))),
              pending.length > PENDING_SHOWN ? h('div', { class: 'pi more' }, t('opt_pendingMore', String(pending.length))) : null,
            ])
          : null,
        h('div', {}, button(t('opt_authorize'), 'pri', () => void authorize(), { id: 'authorize' })),
        reauth.kind === 'denied' ? h('p', { class: 'p denied' }, t('opt_denied')) : null,
      ]),
    ]);
  };

  /** 首次设置第 1 步的文件夹建议：所有系统都写建议；Mac 上接着写 iCloud 那句（中文直接相连，英文空一格）。 */
  const folderSuggestion = (): string =>
    platform === 'mac'
      ?`${t('opt_folderSuggest')}${currentLang() === 'en' ? ' ' : ''}${t('opt_folderICloud')}`
      : t('opt_folderSuggest');

  const settingsView = (): Child[] => [
    topBar(t('ui_settings')),
    showReauth ? reauthCard() : null,
    h('div', { class: 'fl section', id: 'library' }, t('opt_library')),
    h('div', { class: 'card compact' }, h('div', { class: 'sc' }, chosenRow(handle?.name ?? '', false))),
    showWorkbench ? workbenchSection(workbenchOpen, onWorkbenchToggle) : null,
    ...saveWays(shortcut),
  ];

  const onboardingView = (): Child[] => {
    const chosen = handle !== undefined;
    return [
      topBar(t('opt_setup')),
      h('h1', {}, t('opt_heading')),
      h('p', { class: 'lead' }, t('opt_lead')),
      h('section', { class: 'step', id: 'library' }, [
        chosen ? h('div', { class: 'num n-done' }, iconEl('stepCheck', 14)) : h('div', { class: 'num n-now' }, '1'),
        h('div', { class: 'sc' }, [
          h('div', { class: 'stt' }, [t('opt_stepLibrary'), chosen ? h('span', {}, t('opt_done')) : null]),
          chosen && handle ? chosenRow(handle.name, true) : h('div', {}, button(t('opt_chooseFolder'), 'pri', () => void chooseFolder())),
          h('p', { class: 'p' }, folderSuggestion()),
        ]),
      ]),
      h('section', { class: 'step' }, [
        h('div', { class: 'num n-info' }, iconEl('lock', 14)),
        h('div', { class: 'sc' }, [
          h('div', { class: 'stt' }, t('opt_stepReauth')),
          h('p', { class: 'p' }, richT('opt_stepReauthBody', [allowEveryVisit()])),
          dialogMock(),
          h('div', { class: 'cap' }, t('opt_dialogCaption')),
        ]),
      ]),
      showWorkbench ? workbenchSection(workbenchOpen, onWorkbenchToggle) : null,
      ...saveWays(shortcut),
      h(
        'div',
        { class: 'foot' },
        button(
          t('opt_getStarted'),
          'pri',
          () => {
            if (!handle) return;
            view = 'settings';
            showReauth = permission !== 'granted';
            render();
            document.documentElement.scrollTop = 0;
          },
          { disabled: !chosen },
        ),
      ),
    ];
  };

  function render() {
    // toggle 事件异步派发，重绘可能抢在它前面：以页面上小节的当前状态为准（codex review 第 1 轮）
    const shown = root.querySelector<HTMLDetailsElement>('details.wb');
    if (shown) workbenchOpen = shown.open;
    root.replaceChildren(
      h('div', { class: 'wrap', 'data-view': view === 'onboarding' ? 'onboarding' : showReauth ? 'reauth' : 'settings' }, view === 'onboarding' ? onboardingView() : settingsView()),
    );
  }

  const applyAnchor = (hash: string) => {
    if (hash === '#reauth') {
      const card = root.querySelector<HTMLElement>('#reauth');
      card?.scrollIntoView?.({ block: 'start' });
      root.querySelector<HTMLButtonElement>('#authorize')?.focus();
    } else if (hash === '#library') {
      root.querySelector<HTMLElement>('#library')?.scrollIntoView?.({ block: 'start' });
    }
  };

  render();
  return { applyAnchor };
}
