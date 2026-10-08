// 页面右下角提示（DESIGN.md §3.3，设计稿 Toast.dc.html）：挂在页面上的 closed shadow root 里，同时只有一个。
// 网页里不放任何输入控件（ADR-0008，ALAG-16）：「加批注…」请后台打开工具栏面板，批注在面板里写。
import type { OpenOptionsMessage, ToastActionMessage, ToastActionResponse } from '@/shared/messages';
import { t } from '@/shared/i18n';
import type { SaveOutcome } from '@/shared/types';
import { h, iconEl, type Child } from '../dom';
import { failureRetryable, formatMonthDay, partialToastText, quoteToastText, savedToastText, toastFailureText } from '../format';
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
  iconName: 'check' | 'clock' | 'lock' | null;
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

/** 显示一次保存结果的页面提示；页面上已有的提示被替换。 */
export function mountToast(outcome: SaveOutcome, deps: ToastDeps, doc: Document = document): ToastHandle {
  for (const old of doc.querySelectorAll(`[${TOAST_HOST_ATTR}]`)) {
    old.dispatchEvent(new CustomEvent(DISPOSE_EVENT));
    old.remove();
  }

  const host = doc.createElement('div');
  host.setAttribute(TOAST_HOST_ATTR, '');
  host.setAttribute('style', HOST_STYLE);
  const root = host.attachShadow({ mode: 'closed' });
  root.appendChild(h('style', {}, `${tokensCss}\n${toastCss}`));

  const content = contentFor(outcome);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let hovering = false;
  let gone = false;
  /** 「加批注…」在等后台回应：这期间不计时（移开鼠标也不），免得回应慢时把失败态一起收掉。 */
  let notePending = false;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const startTimer = () => {
    clearTimer();
    if (gone || !content.autoDismiss || hovering || notePending) return;
    timer = setTimeout(dismiss, TOAST_AUTO_MS);
  };
  const teardown = () => {
    gone = true;
    clearTimer();
  };

  function dismiss() {
    if (gone) return;
    teardown();
    box.classList.add('out');
    const remove = () => host.remove();
    if (reducedMotion()) remove();
    else setTimeout(remove, TOAST_FADE_MS);
  }

  const textButton = (label: string, onclick: () => void) => h('button', { type: 'button', class: 'tbtn', onclick }, label);
  const closeButton = () => h('button', { type: 'button', class: 'xbtn', 'aria-label': t('toast_close'), onclick: () => dismiss() }, iconEl('close', 14));

  let closeBtn: HTMLButtonElement | null = null;
  let panelError: HTMLElement | null = null;

  /** 面板没能打开：提示不再自动消失，补关闭按钮，下面加一行说明；按钮恢复可点（设计稿 Toast.html「面板打开失败」）。 */
  const showPanelFailed = (button: HTMLButtonElement) => {
    content.autoDismiss = false;
    clearTimer();
    button.disabled = false;
    if (!closeBtn) {
      closeBtn = closeButton();
      row.append(closeBtn);
    }
    if (!panelError) {
      panelError = h('p', { class: 'noteerr', role: 'status' }, t('toast_panelFailed'));
      row.after(panelError);
    }
  };

  /** 「加批注…」：请后台记下这条剪藏并打开工具栏面板；打开了就收起提示。 */
  const requestNote = async (button: HTMLButtonElement, id: string) => {
    if (notePending || gone) return;
    notePending = true;
    button.disabled = true;
    clearTimer();
    let opened = false;
    try {
      const response = (await deps.sendMessage({ type: 'toast-action', action: 'note', clipId: id })) as Partial<ToastActionResponse> | undefined;
      opened = response?.opened === true;
    } catch (err) {
      console.warn('[Alayo Get] 请求打开面板失败', err);
    }
    notePending = false;
    if (gone) return;
    if (opened) dismiss();
    else showPanelFailed(button);
  };

  const actions: Child[] = [];
  switch (outcome.state) {
    case 'saved':
    case 'fallback': {
      const id = outcome.clip.id;
      const noteButton: HTMLButtonElement = textButton(t('toast_addNote'), () => {
        void requestNote(noteButton, id);
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
    closeBtn = closeButton();
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

  return { host, root, dismiss };
}
