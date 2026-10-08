// 页面右下角提示（DESIGN.md §3.3，设计稿 Toast.dc.html）：挂在页面上的 closed shadow root 里，同时只有一个。
import type { OpenOptionsMessage, SwToToastNote, ToastActionMessage, ToastNoteToSw } from '@/shared/messages';
import { t } from '@/shared/i18n';
import type { SaveOutcome } from '@/shared/types';
import { h, iconEl, type Child } from '../dom';
import { failureRetryable, formatMonthDay, partialToastText, quoteToastText, savedToastText, toastFailureText } from '../format';
import tokensCss from '../tokens.css?inline';
import toastCss from './toast.css?inline';

export const TOAST_HOST_ATTR = 'data-alayo-get-toast';
/** 新提示替换旧提示时发给旧宿主元素的事件：旧提示据此清计时器、断开批注 Port。 */
const DISPOSE_EVENT = 'alayo-get-toast-dispose';
export const TOAST_AUTO_MS = 3000;
export const TOAST_FADE_MS = 150;

export interface NotePort {
  postMessage(message: ToastNoteToSw): void;
  disconnect(): void;
  onMessage: { addListener(fn: (message: SwToToastNote) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

/** 提交批注后等后台确认的时限；超时按失败处理，保留输入。 */
export const NOTE_ACK_MS = 8000;

export interface ToastDeps {
  sendMessage(message: OpenOptionsMessage | ToastActionMessage): void;
  /** 连上 'toast-note' Port。 */
  connectNote(): NotePort;
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
  const clipId = outcome.state === 'saved' || outcome.state === 'fallback' ? outcome.clip.id : null;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let hovering = false;
  let expanded = false;
  let gone = false;
  let port: NotePort | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const startTimer = () => {
    clearTimer();
    if (gone || !content.autoDismiss || expanded || hovering) return;
    timer = setTimeout(dismiss, TOAST_AUTO_MS);
  };
  const disconnectPort = () => {
    if (!port) return;
    try {
      port.disconnect();
    } catch {
      // 扩展已重载，Port 早已失效
    }
    port = null;
  };
  const teardown = () => {
    gone = true;
    clearTimer();
    clearAck();
    disconnectPort();
  };

  function dismiss() {
    if (gone) return;
    teardown();
    box.classList.add('out');
    const remove = () => host.remove();
    if (reducedMotion()) remove();
    else setTimeout(remove, TOAST_FADE_MS);
  }

  // 批注：后台空闲约 30 秒会被 Chrome 终止，Port 随之断开。断开后下次发送时重连并重发完整草稿；
  // 提交后等后台回复 committed 才收起，失败或超时保留输入（codex review 第 7 轮）。
  let currentNote = '';
  /** 用户动过批注框：清空成 '' 也算草稿，断线后要补发（codex review 合并前复审）。 */
  let hasDraft = false;
  let awaitingAck = false;
  let ackTimer: ReturnType<typeof setTimeout> | null = null;
  let noteError: HTMLElement | null = null;
  /** 一条提示内自动重连的上限，避免扩展已失效时反复重连。 */
  const MAX_RECONNECTS = 3;
  let reconnects = 0;

  const connect = (): NotePort => {
    const p = deps.connectNote();
    port = p;
    p.onDisconnect.addListener(() => {
      if (port !== p) return;
      port = null;
      if (gone) return;
      // 后台被终止：立刻重连并补发草稿，不等下一次输入——否则用户直接离开页面时批注会丢（codex review 加审轮）。
      if (reconnects >= MAX_RECONNECTS) {
        if (awaitingAck) failCommit(t('toast_noteLostConnection'));
        return;
      }
      reconnects++;
      if (awaitingAck) {
        sendCommit();
      } else if (clipId !== null && hasDraft) {
        deliver({ type: 'draft', clipId, note: currentNote });
      }
    });
    p.onMessage.addListener((message) => {
      if (port !== p || !awaitingAck) return;
      if (message.type === 'commit-failed') failCommit(message.message, true);
      else if (message.note === currentNote) finishCommit();
      else resendCommit();
    });
    return p;
  };

  const tryPost = (p: NotePort, message: ToastNoteToSw): boolean => {
    try {
      p.postMessage(message);
      return true;
    } catch (err) {
      console.debug('[Alayo Get] 批注 Port 已断开，重连', err);
      return false;
    }
  };

  /** 发一条消息；Port 已断开时重连，先补发完整草稿再发这一条。 */
  const deliver = (message: ToastNoteToSw): boolean => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let p = port;
      if (!p) {
        p = connect();
        if (message.type === 'commit' && clipId !== null && !tryPost(p, { type: 'draft', clipId, note: currentNote })) {
          port = null;
          continue;
        }
      }
      if (tryPost(p, message)) return true;
      port = null;
    }
    return false;
  };

  const clearAck = () => {
    if (ackTimer !== null) clearTimeout(ackTimer);
    ackTimer = null;
  };

  function finishCommit() {
    awaitingAck = false;
    clearAck();
    expanded = false;
    noteArea?.remove();
    noteArea = null;
    dismiss();
  }

  /**
   * 批注写回失败。本地的两个原因是小写短语，接在冒号后；service worker 回的原因是整句（可能自带句号），
   * 换用整句的句式，并去掉原因末尾的句号，避免出现两个句号（ALAG-8）。
   */
  function failCommit(reason: string, fromWorker = false) {
    awaitingAck = false;
    clearAck();
    if (!noteArea) return;
    noteError?.remove();
    const text = fromWorker ? t('toast_noteFailedFromWorker', reason.trim().replace(/[.。]+$/, '')) : t('toast_noteFailed', reason);
    noteError = h('p', { class: 'noteerr', role: 'status' }, text);
    noteArea.append(noteError);
  }

  /** 发出当前完整草稿和 commit，并重新计时等待确认。 */
  function sendCommit() {
    clearAck();
    if (clipId === null || !deliver({ type: 'draft', clipId, note: currentNote }) || !deliver({ type: 'commit' })) {
      failCommit(t('toast_noteLostConnection'));
      return;
    }
    ackTimer = setTimeout(() => failCommit(t('toast_noteNoAck')), NOTE_ACK_MS);
  }

  /** 确认的是旧版本（提交后又改了字）：接着提交新版本，不收起。 */
  function resendCommit() {
    sendCommit();
  }

  const commit = () => {
    if (clipId === null) return;
    awaitingAck = true;
    noteError?.remove();
    noteError = null;
    sendCommit();
  };

  let noteArea: HTMLElement | null = null;
  const expandNote = () => {
    if (expanded || clipId === null) return;
    expanded = true;
    clearTimer();
    if (!port) connect();
    addNoteButton?.remove();
    const textarea = h('textarea', { id: 'note', class: 'inp', rows: 2, placeholder: t('ui_notePlaceholder') });
    textarea.addEventListener('input', () => {
      currentNote = textarea.value;
      hasDraft = true;
      deliver({ type: 'draft', clipId, note: currentNote });
    });
    textarea.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        commit();
      }
    });
    noteArea = h('div', { class: 'notearea' }, [
      h('label', { class: 'sr-only', for: 'note' }, t('ui_note')),
      textarea,
      h('div', { class: 'row' }, [
        h('span', { class: 'hint' }, t('toast_noteHint')),
        h('button', { type: 'button', class: 'pbtn', onclick: commit }, t('toast_noteSave')),
      ]),
    ]);
    box.appendChild(noteArea);
    textarea.focus();
  };

  const textButton = (label: string, onclick: () => void) => h('button', { type: 'button', class: 'tbtn', onclick }, label);

  let addNoteButton: HTMLButtonElement | null = null;
  const actions: Child[] = [];
  switch (outcome.state) {
    case 'saved':
    case 'fallback':
      addNoteButton = textButton(t('toast_addNote'), expandNote);
      actions.push(addNoteButton);
      break;
    case 'duplicate':
      actions.push(textButton(t('toast_saveSnapshot'), () => deps.sendMessage({ type: 'toast-action', action: 'snapshot' })));
      break;
    case 'failed':
      // 右键时就判定、不写文件的失败（XVideoNeedsPost、NoDownloadableUrl）重试没有意义，只留关闭（ALAG-4）
      if (failureRetryable(outcome.error)) actions.push(textButton(t('ui_retry'), () => deps.sendMessage({ type: 'toast-action', action: 'retry' })));
      break;
    case 'needs-permission':
      actions.push(textButton(t('toast_allowAccess'), () => deps.sendMessage({ type: 'open-options', section: 'reauth' })));
      break;
  }
  if (!content.autoDismiss) {
    actions.push(h('button', { type: 'button', class: 'xbtn', 'aria-label': t('toast_close'), onclick: () => dismiss() }, iconEl('close', 14)));
  }

  const box = h('div', { class: 'toast', role: 'status', 'data-state': outcome.state }, [
    h('div', { class: 'row' }, [
      content.iconName ? iconEl(content.iconName, 16, `icon ${content.iconClass}`) : null,
      h('div', { class: 'tx' }, [h('div', { class: content.titleClass }, content.title), h('div', { class: 'ts' }, content.desc)]),
      ...actions,
    ]),
  ]);
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
