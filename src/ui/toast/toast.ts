// 页面右下角提示（DESIGN.md §3.3，设计稿 Toast.dc.html）：挂在页面上的 closed shadow root 里，同时只有一个。
// 网页里不放任何输入控件（ADR-0008，ALAG-16）：「加批注…」请后台打开工具栏面板，批注在面板里写。
// ALAG-27：翻译进度与结果接在同一条剪藏的保存提示下面；没有保存提示时单独一条。
import { languageName } from '@/core/translate/targets';
import type { OpenOptionsMessage, ToastActionMessage, ToastActionResponse, ToastTranslationMessage } from '@/shared/messages';
import { t, tn } from '@/shared/i18n';
import type { SaveOutcome, TranslationOutcome, TranslationView } from '@/shared/types';
import { h, iconEl, type Child } from '../dom';
import { failureRetryable, formatMonthDay, partialToastText, quoteToastText, savedToastText, toastFailureText } from '../format';
import type { IconName } from '../icons';
import tokensCss from '../tokens.css?inline';
import toastCss from './toast.css?inline';

export const TOAST_HOST_ATTR = 'data-alayo-get-toast';
/** 新提示替换旧提示时发给旧宿主元素的事件：旧提示据此清计时器。 */
const DISPOSE_EVENT = 'alayo-get-toast-dispose';
export const TOAST_AUTO_MS = 3000;
export const TOAST_FADE_MS = 150;

export interface ToastDeps {
  /** 发给后台；「加批注…」等它的回应（ToastActionResponse），其余不看返回值。 */
  sendMessage(message: OpenOptionsMessage | ToastActionMessage): Promise<unknown> | void;
}

export interface ToastHandle {
  host: HTMLElement;
  /** closed shadow root；只交给调用方（测试），页面拿不到。 */
  root: ShadowRoot;
  /** 淡出并移除。 */
  dismiss(): void;
}

const HOST_STYLE = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;display:block;';

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Content {
  iconName: IconName | null;
  iconClass: string;
  title: string;
  titleClass: string;
  desc: string;
  autoDismiss: boolean;
}

function contentFor(outcome: SaveOutcome): Content {
  switch (outcome.state) {
    case 'saved': {
      const { clip } = outcome;
      // 摘录剪藏：标题“已摘录”，说明行写第几条与文件名（ALAG-4，DESIGN.md §3.3）
      if (clip.quote) {
        return { iconName: 'check', iconClass: 'success', title: t('toast_quoteSaved'), titleClass: 'tt', desc: quoteToastText({ file: clip.file, quote: clip.quote }), autoDismiss: true };
      }
      // X 剪藏只存了一部分时，说明行写一个原因（ALAG-3，DESIGN.md §3.3）；媒体与流媒体剪藏按 DESIGN.md §3.3 的 ALAG-4 行
      const desc = clip.extract === 'partial' && clip.x?.partial ? partialToastText(clip.x.partial, clip.x.posts) : savedToastText(clip);
      return { iconName: 'check', iconClass: 'success', title: t('ui_savedTitle'), titleClass: 'tt', desc, autoDismiss: true };
    }
    case 'fallback':
      return {
        iconName: 'check',
        iconClass: 'success',
        title: t('ui_fallbackTitle'),
        titleClass: 'tt',
        desc: t('ui_fallbackDesc'),
        autoDismiss: true,
      };
    case 'duplicate':
      return {
        iconName: 'clock',
        iconClass: 'muted',
        title: t('toast_duplicateTitle', formatMonthDay(outcome.previous.savedAt)),
        titleClass: 'tt',
        desc: t('ui_nothingNew'),
        autoDismiss: true,
      };
    case 'failed':
      return { iconName: null, iconClass: '', title: t('ui_failedTitle'), titleClass: 'tt err', desc: toastFailureText(outcome.error), autoDismiss: false };
    case 'needs-permission':
      return {
        iconName: 'lock',
        iconClass: 'muted',
        title: t('ui_needsPermissionTitle'),
        titleClass: 'tt',
        desc: t('toast_needsPermissionDesc'),
        autoDismiss: false,
      };
  }
}

// ---- 翻译提示（ALAG-27）

/** 当前显示的提示：同 clip 的保存提示收到 translation 时更新翻译行，不重建整条提示。 */
interface ActiveToast {
  host: HTMLElement;
  clipId: string | null;
  kind: 'save' | 'translation';
  update(view: TranslationView): void;
}

/** 跨消息、跨采集脚本重新注入都要保留的提示状态（同页面的隔离世界共享）。页面导航后自然重置。 */
interface ToastSharedState {
  /** 当前提示对应的剪藏；重新注入后仍可接着更新旧提示。 */
  active: ActiveToast | null;
  /** 用户点 × 关掉的剪藏：之后的 running 更新不再显示；常驻结果会再弹一条单独提示。 */
  userClosed: Set<string>;
}

const TOAST_STATE_KEY = '__alayoGetToastState';

function sharedToastState(): ToastSharedState {
  const scope = globalThis as unknown as Record<string, unknown>;
  const existing = scope[TOAST_STATE_KEY];
  if (typeof existing === 'object' && existing !== null && (existing as ToastSharedState).userClosed instanceof Set) {
    return existing as ToastSharedState;
  }
  const next: ToastSharedState = { active: null, userClosed: new Set() };
  scope[TOAST_STATE_KEY] = next;
  return next;
}

/** 采集脚本每次保存都会重新注入；模块级变量会丢，所以要放在 globalThis 上。 */
const shared = sharedToastState();

const pair = (from: string, to: string): string => t('tr_pair', [languageName(from), languageName(to)]);

const pairOfOutcome = (outcome: TranslationOutcome, target: string): string => {
  const error = outcome.error;
  if (error?.code === 'needs-download') {
    return error.model.kind === 'translator' ? pair(error.model.source, error.model.target) : languageName(target);
  }
  if (error?.code === 'unsupported-pair') return pair(error.source, error.target);
  return outcome.source ? pair(outcome.source, target) : languageName(target);
};

/** 结束结果里可以 3 秒后自动消失的：译完、原文就是目标语言、已经译过。 */
function transient(view: TranslationView): boolean {
  if (view.phase !== 'finished') return false;
  const { outcome } = view;
  if (outcome.status === 'complete' || outcome.status === 'skipped') return true;
  return outcome.status === 'aborted' && outcome.reason === 'already-translated';
}

interface TranslateButton {
  label: string;
  action: 'translate-panel' | 'retranslate';
}

interface AttachedContent {
  icon: IconName;
  iconClass: string;
  line: Child[];
  num?: string;
  detail?: string;
  mono?: string;
  button?: TranslateButton;
  bar?: { now: number; max: number };
  auto: boolean;
}

/** 接在保存提示下面的翻译行（设计稿 1a–1c；失败等状态沿用同样的行）。 */
function attachedContent(view: TranslationView, file: string): AttachedContent {
  const target = languageName(view.target);
  if (view.phase === 'running') {
    return {
      icon: 'translate',
      iconClass: '',
      line: [t('tr_translating', [target])],
      // 还没分好段（total 为 0）时不显示「0 / 0」
      ...(view.total > 0 ? { num: t('tr_progress', [String(view.done), String(view.total)]) } : {}),
      bar: { now: view.done, max: view.total },
      auto: false,
    };
  }
  const { outcome } = view;
  switch (outcome.status) {
    case 'complete':
      return { icon: 'check', iconClass: 'success', line: [t('tr_done', [target])], num: tn('tr_count', outcome.applied), auto: true };
    case 'skipped':
      if (outcome.total === 0) return { icon: 'info', iconClass: '', line: [t('tr_nothingToTranslate')], auto: true };
      return { icon: 'info', iconClass: '', line: [t('tr_skipped', [target])], auto: true };
    case 'aborted':
      if (outcome.reason === 'already-translated') {
        return { icon: 'info', iconClass: '', line: [t('tr_alreadyTranslated')], auto: true };
      }
      return { icon: 'error', iconClass: 'err', line: [h('b', { class: 'err' }, t('tr_stopped'))], detail: reasonText(outcome.reason, file), auto: false };
    case 'partial':
      return {
        icon: 'error',
        iconClass: 'err',
        line: [h('b', { class: 'err' }, t('tr_partial')), t('toast_trPartial', [String(outcome.applied), String(outcome.total)])],
        ...(outcome.error?.code === 'engine-failed' ? { mono: outcome.error.message } : {}),
        auto: false,
      };
    case 'failed': {
      const error = outcome.error;
      if (error?.code === 'needs-download') {
        return {
          icon: 'download',
          iconClass: '',
          line: [error.model.kind === 'detector' ? t('tr_needsDetector') : t('tr_needsModel')],
          detail:
            error.model.kind === 'detector'
              ? t('tr_needsDetectorDesc')
              : t('toast_trModelSize', [pair(error.model.source, error.model.target)]),
          button: { label: t('toast_trDownload'), action: 'translate-panel' },
          auto: false,
        };
      }
      if (error?.code === 'unsupported-pair') {
        return { icon: 'error', iconClass: 'err', line: [h('b', { class: 'err' }, t('tr_failed'))], detail: t('tr_unsupportedPair', [pair(error.source, error.target)]), auto: false };
      }
      if (error?.code === 'source-unknown') {
        return { icon: 'error', iconClass: 'err', line: [h('b', { class: 'err' }, t('tr_failed'))], detail: t('tr_sourceUnknown'), auto: false };
      }
      return {
        icon: 'error',
        iconClass: 'err',
        line: [h('b', { class: 'err' }, t('tr_failed'))],
        detail: t('tr_nothingTranslated'),
        ...(error?.code === 'engine-failed' ? { mono: error.message } : {}),
        button: { label: t('ui_retry'), action: 'retranslate' },
        auto: false,
      };
    }
  }
}

interface StandaloneContent {
  icon: IconName;
  iconClass: string;
  title: string;
  titleClass: string;
  desc: string;
  num?: string;
  mono?: string;
  button?: TranslateButton;
  bar?: { now: number; max: number };
  auto: boolean;
}

/** 面板关掉后单独一条翻译提示（设计稿 2a–2c；其余状态沿用同样结构）。 */
function standaloneContent(view: TranslationView, clipTitle: string, file: string): StandaloneContent {
  const target = languageName(view.target);
  if (view.phase === 'running') {
    return {
      icon: 'translate',
      iconClass: 'muted',
      title: t('tr_translating', [target]),
      titleClass: 'tt',
      desc: clipTitle,
      ...(view.total > 0 ? { num: t('tr_progress', [String(view.done), String(view.total)]) } : {}),
      bar: { now: view.done, max: view.total },
      auto: false,
    };
  }
  const { outcome } = view;
  switch (outcome.status) {
    case 'complete':
      return {
        icon: 'check',
        iconClass: 'success',
        title: t('tr_done', [target]),
        titleClass: 'tt',
        desc: tn('tr_doneDesc', outcome.applied, pairOfOutcome(outcome, view.target)),
        auto: true,
      };
    case 'skipped':
      return {
        icon: 'info',
        iconClass: 'muted',
        title: outcome.total === 0 ? t('tr_nothingToTranslate') : t('tr_skipped', [target]),
        titleClass: 'tt',
        desc: clipTitle,
        auto: true,
      };
    case 'aborted':
      if (outcome.reason === 'already-translated') {
        return { icon: 'info', iconClass: 'muted', title: t('tr_alreadyTranslated'), titleClass: 'tt', desc: clipTitle, auto: true };
      }
      return {
        icon: 'error',
        iconClass: 'err',
        title: t('tr_stopped'),
        titleClass: 'tt err',
        desc: reasonText(outcome.reason, file),
        auto: false,
      };
    case 'partial':
      return {
        icon: 'error',
        iconClass: 'err',
        title: t('tr_partial'),
        titleClass: 'tt err',
        desc: t('tr_partialDesc', [String(outcome.applied), String(outcome.total)]),
        ...(outcome.error?.code === 'engine-failed' ? { mono: outcome.error.message } : {}),
        auto: false,
      };
    case 'failed': {
      const error = outcome.error;
      if (error?.code === 'needs-download') {
        if (error.model.kind === 'detector') {
          return {
            icon: 'download',
            iconClass: 'muted',
            title: t('tr_needsDetector'),
            titleClass: 'tt',
            desc: t('tr_needsDetectorDesc'),
            button: { label: t('toast_trDownload'), action: 'translate-panel' },
            auto: false,
          };
        }
        return {
          icon: 'download',
          iconClass: 'muted',
          title: t('tr_needsModel'),
          titleClass: 'tt',
          desc: t('toast_trModelSize', [pair(error.model.source, error.model.target)]),
          button: { label: t('toast_trDownload'), action: 'translate-panel' },
          auto: false,
        };
      }
      if (error?.code === 'unsupported-pair') {
        return {
          icon: 'error',
          iconClass: 'err',
          title: t('tr_failed'),
          titleClass: 'tt err',
          desc: t('tr_unsupportedPair', [pair(error.source, error.target)]),
          auto: false,
        };
      }
      if (error?.code === 'source-unknown') {
        return { icon: 'error', iconClass: 'err', title: t('tr_failed'), titleClass: 'tt err', desc: t('tr_sourceUnknown'), auto: false };
      }
      return {
        icon: 'error',
        iconClass: 'err',
        title: t('tr_failed'),
        titleClass: 'tt err',
        desc: t('tr_nothingTranslated'),
        ...(error?.code === 'engine-failed' ? { mono: error.message } : {}),
        button: { label: t('ui_retry'), action: 'retranslate' },
        auto: false,
      };
    }
  }
}

function reasonText(reason: string | undefined, file: string): string {
  if (reason === 'record-missing' || reason === 'file-missing' || reason === 'id-mismatch') return t('tr_fileGone', [file]);
  return t('tr_writeFailed');
}

function progressBar(now: number, max: number, label: string): HTMLElement {
  const percent = max > 0 ? Math.min(100, Math.max(0, (now / max) * 100)) : 0;
  return h('div', { class: 'bar', role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': now }, [
    h('i', { style: `width:${percent}%` }),
  ]);
}

function clearOtherToasts(doc: Document): void {
  for (const old of doc.querySelectorAll(`[${TOAST_HOST_ATTR}]`)) {
    old.dispatchEvent(new CustomEvent(DISPOSE_EVENT));
    old.remove();
  }
}

function makeHost(doc: Document): { host: HTMLElement; root: ShadowRoot } {
  const host = doc.createElement('div');
  host.setAttribute(TOAST_HOST_ATTR, '');
  host.setAttribute('style', HOST_STYLE);
  const root = host.attachShadow({ mode: 'closed' });
  root.appendChild(h('style', {}, `${tokensCss}\n${toastCss}`));
  return { host, root };
}

function textButton(label: string, onclick: () => void): HTMLButtonElement {
  return h('button', { type: 'button', class: 'tbtn', onclick }, label);
}

function closeButton(dismiss: () => void): HTMLButtonElement {
  return h('button', { type: 'button', class: 'xbtn', 'aria-label': t('toast_close'), onclick: dismiss }, iconEl('close', 14));
}

/** 显示一次保存结果的页面提示；页面上已有的提示被替换。 */
export function mountToast(outcome: SaveOutcome, deps: ToastDeps, doc: Document = document): ToastHandle {
  clearOtherToasts(doc);

  const { host, root } = makeHost(doc);
  const content = contentFor(outcome);
  const savedClipId = outcome.state === 'saved' ? outcome.clip.id : null;
  const savedClipFile = outcome.state === 'saved' ? outcome.clip.file : '';
  if (savedClipId !== null) shared.userClosed.delete(savedClipId);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let hovering = false;
  let gone = false;
  /** 「加批注…」在等后台回应：这期间不计时（移开鼠标也不），免得回应慢时把失败态一起收掉。 */
  let notePending = false;
  /** 翻译行接上后覆盖原有的自动消失规则：running 期间不消失，结束后按结果。 */
  let translationAuto: boolean | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const startTimer = () => {
    clearTimer();
    if (gone || hovering || notePending) return;
    const auto = translationAuto ?? content.autoDismiss;
    if (!auto) return;
    timer = setTimeout(() => dismiss(), TOAST_AUTO_MS);
  };
  let self: ActiveToast | null = null;
  const teardown = () => {
    gone = true;
    clearTimer();
    if (shared.active === self) shared.active = null;
  };

  function dismiss(byUser = false) {
    if (gone) return;
    if (byUser && savedClipId !== null) shared.userClosed.add(savedClipId);
    teardown();
    box.classList.add('out');
    const remove = () => host.remove();
    if (reducedMotion()) remove();
    else setTimeout(remove, TOAST_FADE_MS);
  }

  let closeBtn: HTMLButtonElement | null = null;
  let panelError: HTMLElement | null = null;

  const ensureClose = () => {
    if (closeBtn) return;
    closeBtn = closeButton(() => dismiss(true));
    row.append(closeBtn);
  };

  /** 面板没能打开：提示不再自动消失，补关闭按钮，下面加一行说明；按钮恢复可点（设计稿 Toast.html「面板打开失败」）。 */
  const showPanelFailed = (button: HTMLButtonElement) => {
    content.autoDismiss = false;
    translationAuto = false;
    clearTimer();
    button.disabled = false;
    ensureClose();
    if (!panelError) {
      panelError = h('p', { class: 'noteerr', role: 'status' }, t('toast_panelFailed'));
      row.after(panelError);
    }
  };

  /** 请后台记下这条剪藏并打开工具栏面板；打开了就收起提示。 */
  const requestPanel = async (button: HTMLButtonElement, action: 'note' | 'translate-panel', id: string): Promise<void> => {
    if (notePending || gone) return;
    notePending = true;
    button.disabled = true;
    clearTimer();
    let opened = false;
    try {
      const response = (await deps.sendMessage({ type: 'toast-action', action, clipId: id })) as Partial<ToastActionResponse> | undefined;
      opened = response?.opened === true;
    } catch (err) {
      console.warn('[Alayo Get] 请求打开面板失败', err);
    }
    notePending = false;
    if (gone) return;
    if (opened) dismiss();
    else showPanelFailed(button);
  };

  /** 翻译行（接在这条保存提示下面）；不重建整条提示，保留「加批注…」与 hover 状态。 */
  const updateTranslation = (view: TranslationView): void => {
    if (gone) return;
    const translation = attachedContent(view, savedClipFile);
    translationAuto = translation.auto;
    clearTimer();
    ensureClose();

    const line: Child[] = [
      iconEl(translation.icon, 14, `ticon ${translation.iconClass}`.trim()),
      h('span', {}, translation.line),
    ];
    if (translation.num !== undefined) line.push(h('span', { class: 'num' }, translation.num));
    if (translation.button) {
      const button = textButton(translation.button.label, () => {
        if (translation.button?.action === 'translate-panel' && savedClipId !== null) {
          void requestPanel(button, 'translate-panel', savedClipId);
        } else {
          button.disabled = true;
          void deps.sendMessage({ type: 'toast-action', action: 'retranslate', clipId: savedClipId ?? '' });
        }
      });
      line.push(button);
    }
    const rows: Child[] = [h('div', { class: 'trl' }, line)];
    if (translation.bar) rows.push(progressBar(translation.bar.now, translation.bar.max, t('tr_translate')));
    if (translation.detail) rows.push(h('div', { class: 'trd' }, translation.detail));
    if (translation.mono) rows.push(h('div', { class: 'trm' }, translation.mono));

    const next = h('div', { class: 'trs' }, rows);
    const old = box.querySelector('.trs');
    if (old) old.replaceWith(next);
    else row.after(next);
    if (translationAuto) startTimer();
  };

  const actions: Child[] = [];
  switch (outcome.state) {
    case 'saved':
    case 'fallback': {
      const id = outcome.clip.id;
      const noteButton: HTMLButtonElement = textButton(t('toast_addNote'), () => {
        void requestPanel(noteButton, 'note', id);
      });
      actions.push(noteButton);
      break;
    }
    case 'duplicate':
      actions.push(textButton(t('toast_saveSnapshot'), () => void deps.sendMessage({ type: 'toast-action', action: 'snapshot' })));
      break;
    case 'failed':
      // 右键时就判定、不写文件的失败（XVideoNeedsPost、NoDownloadableUrl）重试没有意义，只留关闭（ALAG-4）
      if (failureRetryable(outcome.error)) actions.push(textButton(t('ui_retry'), () => void deps.sendMessage({ type: 'toast-action', action: 'retry' })));
      break;
    case 'needs-permission':
      actions.push(textButton(t('toast_allowAccess'), () => void deps.sendMessage({ type: 'open-options', section: 'reauth' })));
      break;
  }
  if (!content.autoDismiss) {
    closeBtn = closeButton(() => dismiss(true));
    actions.push(closeBtn);
  }

  const row = h('div', { class: 'row' }, [
    content.iconName ? iconEl(content.iconName, 16, `icon ${content.iconClass}`) : null,
    h('div', { class: 'tx' }, [h('div', { class: content.titleClass }, content.title), h('div', { class: 'ts' }, content.desc)]),
    ...actions,
  ]);
  const box = h('div', { class: 'toast', role: 'status', 'data-state': outcome.state }, [row]);
  box.addEventListener('mouseenter', () => {
    hovering = true;
    clearTimer();
  });
  box.addEventListener('mouseleave', () => {
    hovering = false;
    startTimer();
  });
  root.appendChild(box);

  host.addEventListener(DISPOSE_EVENT, teardown);
  (doc.body ?? doc.documentElement).appendChild(host);
  startTimer();
  const handle: ToastHandle = { host, root, dismiss: () => dismiss() };
  self = { host, clipId: savedClipId, kind: 'save', update: updateTranslation };
  shared.active = self;
  return handle;
}

/** 单独一条翻译提示：替换掉其他提示（与「同时只有一个提示」一致）。 */
function mountTranslationToast(message: ToastTranslationMessage, deps: ToastDeps, doc: Document): void {
  clearOtherToasts(doc);
  const { host, root } = makeHost(doc);
  const { clipId } = message;
  shared.userClosed.delete(clipId);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let hovering = false;
  let gone = false;
  let current = standaloneContent(message.view, message.title, message.file ?? message.title);
  let panelError: HTMLElement | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const startTimer = () => {
    clearTimer();
    if (gone || hovering || !current.auto) return;
    timer = setTimeout(() => dismiss(false), TOAST_AUTO_MS);
  };
  const teardown = () => {
    gone = true;
    clearTimer();
    if (shared.active === handle) shared.active = null;
  };
  function dismiss(byUser: boolean) {
    if (gone) return;
    if (byUser) shared.userClosed.add(clipId);
    teardown();
    box.classList.add('out');
    const remove = () => host.remove();
    if (reducedMotion()) remove();
    else setTimeout(remove, TOAST_FADE_MS);
  }

  const requestPanel = async (button: HTMLButtonElement): Promise<void> => {
    button.disabled = true;
    clearTimer();
    let opened = false;
    try {
      const response = (await deps.sendMessage({ type: 'toast-action', action: 'translate-panel', clipId })) as Partial<ToastActionResponse> | undefined;
      opened = response?.opened === true;
    } catch (err) {
      console.warn('[Alayo Get] 请求打开面板失败', err);
    }
    if (gone) return;
    if (opened) dismiss(false);
    else {
      button.disabled = false;
      current = { ...current, auto: false };
      panelError?.remove();
      panelError = h('p', { class: 'noteerr', role: 'status' }, t('toast_panelFailed'));
      box.append(panelError);
      clearTimer();
    }
  };

  const render = (): void => {
    const actions: Child[] = [];
    if (current.num !== undefined) actions.push(h('span', { class: 'num' }, current.num));
    if (current.button) {
      const button = textButton(current.button.label, () => {
        if (current.button?.action === 'translate-panel') {
          void requestPanel(button);
        } else {
          button.disabled = true;
          void deps.sendMessage({ type: 'toast-action', action: 'retranslate', clipId });
        }
      });
      actions.push(button);
    }
    actions.push(closeButton(() => dismiss(true)));
    const row = h('div', { class: 'row' }, [
      iconEl(current.icon, 18, `icon ${current.iconClass}`.trim()),
      h('div', { class: 'tx' }, [h('div', { class: current.titleClass }, current.title), h('div', { class: 'ts wrap' }, current.desc)]),
      ...actions,
    ]);
    const children: Array<Node | string> = [row];
    if (current.bar) children.push(progressBar(current.bar.now, current.bar.max, current.title));
    if (current.mono) children.push(h('div', { class: 'trm' }, current.mono));
    panelError = null;
    box.replaceChildren(...children);
    startTimer();
  };

  const box = h('div', { class: 'toast', role: 'status', 'data-state': 'translation' });
  box.addEventListener('mouseenter', () => {
    hovering = true;
    clearTimer();
  });
  box.addEventListener('mouseleave', () => {
    hovering = false;
    startTimer();
  });
  root.appendChild(box);
  host.addEventListener(DISPOSE_EVENT, teardown);
  (doc.body ?? doc.documentElement).appendChild(host);
  render();

  const handle: ActiveToast = {
    host,
    clipId,
    kind: 'translation',
    update: (view) => {
      if (gone) return;
      current = standaloneContent(view, message.title, message.file ?? message.title);
      render();
    },
  };
  shared.active = handle;
}

/**
 * 收到翻译进度/结果：同一条剪藏的保存提示还在时，在它下面加/更新翻译行；
 * 否则单独弹一条翻译提示。用户点 × 关掉后 running 不再显示，只有常驻结果会再弹。
 */
export function showTranslation(message: ToastTranslationMessage, deps: ToastDeps, doc: Document = document): void {
  const { clipId, view } = message;
  // 页面重新加载、或提示已被移除：旧句柄失效，按“没有提示”处理。
  if (shared.active && !shared.active.host.isConnected) shared.active = null;
  if (shared.userClosed.has(clipId)) {
    if (view.phase === 'running') return;
    if (transient(view)) return;
    shared.userClosed.delete(clipId);
  }
  const current = shared.active;
  if (current && current.clipId === clipId) {
    current.update(view);
    return;
  }
  mountTranslationToast(message, deps, doc);
}
