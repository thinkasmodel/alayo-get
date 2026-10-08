// 工具栏面板（DESIGN.md §3.2，设计稿 designs/alag-2-m1/Main.dc.html）：按状态整体重渲染。
// 本地编辑只发 draft，不触发重渲染；重渲染只在收到 service worker 推来的新状态时发生。
import { lostEditReason } from '@/core/lostEditFile';
import { t } from '@/shared/i18n';
import type { ClipSummary, EditFields, LostEdit, LostEditNotice, PanelState, Preview, SavedIndexData } from '@/shared/types';
import { h, iconEl, richT, type Child } from '../dom';
import { failureDetail, failureReason, formatDate, oversizeNote, partialNote, quoteToastText, savedDescription, savingPercent, savingText } from '../format';
import type { IconName } from '../icons';
import { createTagInput } from './tagInput';

export interface PanelView {
  state: PanelState;
  /** 剪藏库文件夹名（`handle.name`）；null 表示还没有选择剪藏库。 */
  folderName: string | null;
  /** 写回失败留下的草稿：正文末尾每条一个恢复块（ALAG-20）。 */
  lostEdits?: LostEdit[];
  /** 本次面板会话里已处理完的草稿：每条一行小字。 */
  lostNotices?: LostEditNotice[];
}

export interface PanelActions {
  /** 三个字段每次都发全量。 */
  postDraft(fields: Required<EditFields>): void;
  /** 另存一份新快照。 */
  snapshot(): void;
  /** 失败后重试。 */
  retry(): void;
  openOptions(section: 'reauth' | 'library'): void | Promise<void>;
  /** 头部的设置按钮。 */
  openSettings(): void;
  closePanel(): void;
  /** 读已保存记录（标签建议用）。 */
  loadIndex(): Promise<SavedIndexData>;
  /** 恢复块上的按钮（ALAG-20）。 */
  lostEdit(action: 'retry' | 'file' | 'discard', id: string): void;
}

function statusRow(iconName: IconName | null, iconClass: string, title: string, sub: string, titleClass = 'st'): HTMLElement {
  return h('div', { class: 'status' }, [
    iconName ? iconEl(iconName, 16, `sicon ${iconClass}`) : null,
    h('div', { class: 'stext' }, [h('div', { class: titleClass }, title), h('div', { class: 'sm' }, sub)]),
  ]);
}

/** 预览卡字形按剪藏形态取（DESIGN.md §3.2 ALAG-4）：文章与 X 剪藏 doc，书签 link，图片 image，PDF file，音频 audio，视频 video，流媒体 play，摘录 quote。 */
const PREVIEW_ICON: Record<Preview['medium'], IconName> = {
  web: 'doc',
  link: 'link',
  image: 'image',
  pdf: 'file',
  audio: 'audio',
  video: 'video',
  stream: 'play',
  quote: 'quote',
};

const MEDIA_PREVIEW: ReadonlySet<Preview['medium']> = new Set(['image', 'pdf', 'audio', 'video']);

function previewCard(preview: Preview, file?: string): HTMLElement {
  return h('div', { class: 'card' }, [
    iconEl(PREVIEW_ICON[preview.medium] ?? 'doc', 16, 'g'),
    h('div', { class: 'cc' }, [
      h('div', { class: 'ct' }, preview.title),
      preview.site ? h('div', { class: 'pill' }, preview.site) : null,
      file ? h('div', { class: 'fn' }, file) : null,
    ]),
  ]);
}

function fallbackCard(clip: ClipSummary): HTMLElement {
  return h('div', { class: 'card' }, [
    h('div', { class: 'cover' }, iconEl('image', 18)),
    h('div', { class: 'cc' }, [
      h('div', { class: 'ct' }, clip.title),
      clip.site ? h('div', { class: 'pill' }, clip.site) : null,
      h('div', { class: 'mchip' }, `extract: ${clip.extract}`),
    ]),
  ]);
}

function folderPath(folderName: string | null): HTMLElement {
  return h('div', { class: 'path' }, folderName ? [iconEl('folder', 12), h('span', { class: 'pathname' }, folderName)] : []);
}

/**
 * 已保存 / 退化为书签：标题（仅 saved）、标签、批注。返回批注框，供自动聚焦。
 * 摘录剪藏（从页面提示「加批注…」进入的编辑态，ALAG-16）只有批注框；draft 照常发三个字段，applyEdits 对摘录只处理 note。
 */
function editFields(clip: ClipSummary, withTitle: boolean, actions: PanelActions): { nodes: HTMLElement[]; note: HTMLTextAreaElement } {
  const fields = { title: clip.title, tags: [...clip.tags], note: clip.note };
  const post = () => actions.postDraft({ title: fields.title, tags: [...fields.tags], note: fields.note });
  const quote = clip.quote !== undefined;

  const nodes: HTMLElement[] = [];
  if (withTitle && !quote) {
    const title = h('input', { id: 'f-title', class: 'inp', type: 'text', value: clip.title, autocomplete: 'off' });
    title.value = clip.title;
    title.addEventListener('input', () => {
      fields.title = title.value;
      post();
    });
    nodes.push(h('div', { class: 'field' }, [h('label', { class: 'fl', for: 'f-title' }, t('panel_title')), title]));
  }

  if (!quote) {
    const tagInput = createTagInput({
      id: 'f-tags',
      initial: clip.tags,
      loadIndex: actions.loadIndex,
      onChange: (tags) => {
        fields.tags = tags;
        post();
      },
    });
    nodes.push(h('div', { class: 'field' }, [h('label', { class: 'fl', for: 'f-tags' }, t('panel_tags')), tagInput.el]));
  }

  const note = h('textarea', { id: 'f-note', class: 'inp note-input', rows: 3, placeholder: t('ui_notePlaceholder') });
  note.value = clip.note;
  note.addEventListener('input', () => {
    fields.note = note.value;
    post();
  });
  nodes.push(h('div', { class: 'field' }, [h('label', { class: 'fl', for: 'f-note' }, t('ui_note')), note]));
  return { nodes, note };
}

function button(label: string, className: string, onclick: () => void): HTMLButtonElement {
  return h('button', { type: 'button', class: `btn ${className}`, onclick }, label);
}

/** 文件不在、已被替换、其他写入错误三种原因句（「没能打开这条剪藏」与恢复块共用，ALAG-20）。 */
function fileReason(error: { name: string }, file: string): string {
  switch (lostEditReason(error)) {
    case 'missing':
      return t('panel_fileMissing', [file]);
    case 'replaced':
      return t('panel_fileReplaced', [file]);
    case 'other':
      return t('panel_writeFailed', [file]);
  }
}

/** 恢复块（ALAG-20，设计稿 designs/alag-20-lost-edit B 版）：danger 标题、原因、只读的改动字段、三个文字按钮。 */
function lostEditBlock(edit: LostEdit, folderName: string, actions: PanelActions): HTMLElement {
  const { fields } = edit;
  const rows: HTMLElement[] = [];
  const row = (label: string, value: string) => h('div', { class: 'dl' }, [h('div', { class: 'dk' }, label), h('div', { class: 'dv' }, value)]);
  if (fields.title !== undefined) rows.push(row(t('panel_title'), fields.title));
  if (fields.tags !== undefined) rows.push(row(t('panel_tags'), fields.tags.join(t('panel_tagJoin'))));
  if (fields.note !== undefined) rows.push(row(t('ui_note'), fields.note));
  const textButton = (label: string, className: string, action: 'retry' | 'file' | 'discard') =>
    h('button', { type: 'button', class: className, onclick: () => actions.lostEdit(action, edit.id) }, label);
  return h('div', { class: 'lost', 'data-lost-edit': edit.id }, [
    h('div', { class: 'stext' }, [h('div', { class: 'st err' }, t('panel_lostEditTitle')), h('div', { class: 'sm' }, fileReason(edit.error, edit.clip.file))]),
    lostEditReason(edit.error) === 'other' ? h('div', { class: 'mono' }, failureDetail(edit.error, folderName)) : null,
    h('div', { class: 'draft' }, rows),
    h('div', { class: 'acts' }, [
      textButton(t('panel_lostEditDiscard'), 'tbtn quiet', 'discard'),
      textButton(t('panel_lostEditFile'), 'tbtn', 'file'),
      textButton(t('ui_retry'), 'tbtn', 'retry'),
    ]),
  ]);
}

function lostNotice(notice: LostEditNotice): HTMLElement {
  return h('div', { class: 'sm' }, notice.kind === 'filed' ? t('panel_lostEditFiled', [notice.file]) : t('panel_lostEditWritten', [notice.file]));
}

export function renderPanel(root: HTMLElement, view: PanelView, actions: PanelActions): void {
  const { state, folderName } = view;
  const body: Child[] = [];
  let foot: Child[] = [];
  let focusTarget: HTMLElement | null = null;
  const name = folderName ?? '';

  switch (state.state) {
    case 'saving': {
      const percent = savingPercent(state.progress);
      body.push(
        statusRow('spinner', 'accent spin', t('panel_saving'), savingText(state.progress)),
        h(
          'div',
          { class: 'bar', role: 'progressbar', 'aria-label': t('panel_progress'), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(percent) },
          h('div', { class: 'barfill', style: `width:${percent}%` }),
        ),
        previewCard(state.preview),
        // 媒体剪藏存完不能改标题（ALAG-4）
        h('div', { class: 'note' }, MEDIA_PREVIEW.has(state.preview.medium) ? t('panel_savingHintMedia') : t('panel_savingHint')),
      );
      foot = [folderPath(folderName)];
      break;
    }
    case 'saved':
    case 'fallback': {
      const { clip } = state;
      if (state.state === 'saved' && clip.quote) {
        // 摘录剪藏的编辑态（ALAG-16）：状态行同页面提示的“已摘录”，主体只有文件名和批注框
        body.push(statusRow('check', 'success', t('toast_quoteSaved'), quoteToastText({ file: clip.file, quote: clip.quote })));
        body.push(h('div', { class: 'fn' }, clip.file));
      } else if (state.state === 'saved') {
        body.push(statusRow('check', 'success', t('ui_savedTitle'), savedDescription(clip)));
        if (clip.extract === 'partial' && clip.x?.partial) {
          // X 剪藏只存了一部分（ALAG-3，设计稿 designs/alag-3-partial 方案 A）：文件名行右侧加 chip，下一行写原因。
          // 右键保存链接抓取失败的书签剪藏也是 saved + partial，但不属于这个设计，保持原样。
          body.push(h('div', { class: 'fnrow' }, [h('div', { class: 'fn' }, clip.file), h('span', { class: 'mchip' }, `extract: ${clip.extract}`)]));
          body.push(h('div', { class: 'note' }, partialNote(clip.x.partial, clip.x.posts)));
        } else {
          body.push(h('div', { class: 'fn' }, clip.file));
          // 超过 100MB 或拿不到大小的直链（ALAG-4）：文件名下面一行小字，不加 chip
          const oversize = oversizeNote(clip);
          if (oversize) body.push(h('div', { class: 'note' }, oversize));
        }
      } else {
        body.push(statusRow('check', 'success', t('ui_fallbackTitle'), t('ui_fallbackDesc')), fallbackCard(clip));
      }
      // 媒体剪藏只有标签和批注，不显示标题框（改动写进 .meta/<id>.json，不改文件名）
      const { nodes, note } = editFields(clip, state.state === 'saved' && !clip.media, actions);
      body.push(...nodes);
      focusTarget = note;
      foot = [folderPath(folderName), h('span', { class: 'auto' }, t('panel_autoWrite'))];
      break;
    }
    case 'duplicate': {
      body.push(
        statusRow('clock', 'muted', t('panel_duplicateTitle', formatDate(state.previous.savedAt)), t('ui_nothingNew')),
        previewCard(state.preview, state.previous.file),
        h('div', { class: 'note' }, t('panel_duplicateNote')),
      );
      foot = [folderPath(folderName), button(t('panel_saveSnapshot'), 'sec', () => actions.snapshot())];
      break;
    }
    case 'failed': {
      body.push(
        h('div', { class: 'stext' }, [h('div', { class: 'st err' }, t('ui_failedTitle')), h('div', { class: 'sm' }, t('panel_notSaved'))]),
        previewCard(state.preview),
        h('div', { class: 'reason' }, failureReason(state.error, name)),
        h('div', { class: 'mono' }, failureDetail(state.error, name)),
      );
      foot = [
        h('div', { class: 'path' }),
        button(t('panel_chooseAgain'), 'sec', () => void actions.openOptions('library')),
        button(t('ui_retry'), 'pri', () => actions.retry()),
      ];
      break;
    }
    case 'needs-permission': {
      if (folderName === null) {
        body.push(statusRow('lock', 'muted', t('panel_noLibrary'), t('panel_notSaved')));
        foot = [button(t('panel_openSettings'), 'pri wide', () => void actions.openOptions('library'))];
      } else {
        body.push(
          statusRow('lock', 'muted', t('ui_needsPermissionTitle'), t('panel_notSaved')),
          h('div', { class: 'reason' }, t('panel_revoked', folderName)),
          h('div', { class: 'inset' }, richT('panel_reauthHint', [h('b', {}, `“${t('dlg_allowEvery')}”`)])),
        );
        foot = [
          button(t('panel_authorizeAndSave'), 'pri wide', () => {
            void Promise.resolve(actions.openOptions('reauth'))
              .catch(() => undefined)
              .finally(() => actions.closePanel());
          }),
        ];
      }
      break;
    }
    case 'clip-unavailable': {
      // 从页面提示「加批注…」进入前核对文件，文件不在或已被替换（ALAG-20）：没有输入框，也没有按钮
      body.push(
        h('div', { class: 'stext' }, [h('div', { class: 'st err' }, t('panel_clipUnavailableTitle')), h('div', { class: 'sm' }, t('panel_nothingChanged'))]),
        // 这个状态只带文件不在、已被替换两种错误
        h('div', { class: 'reason' }, lostEditReason(state.error) === 'missing' ? t('panel_fileMissing', [state.clip.file]) : t('panel_fileReplaced', [state.clip.file])),
        h('div', { class: 'mono' }, `${state.error.name} · ${state.clip.file}`),
      );
      foot = [folderPath(folderName)];
      break;
    }
  }

  // 写回失败留下的草稿与本次会话已处理完的通知，放在正文最后（ALAG-20）
  for (const edit of view.lostEdits ?? []) body.push(lostEditBlock(edit, name, actions));
  for (const notice of view.lostNotices ?? []) body.push(lostNotice(notice));

  const panel = h('div', { class: 'panel', 'data-state': state.state }, [
    h('header', { class: 'head' }, [
      iconEl('brand', 16, 'brandicon'),
      h('span', { class: 'brand' }, 'Alayo Get'),
      h('button', { type: 'button', class: 'ibtn', 'aria-label': t('ui_settings'), onclick: () => actions.openSettings() }, iconEl('settings', 16)),
    ]),
    h('main', { class: 'body' }, body),
    h('footer', { class: 'foot' }, foot),
  ]);
  root.replaceChildren(panel);
  focusTarget?.focus();
}
