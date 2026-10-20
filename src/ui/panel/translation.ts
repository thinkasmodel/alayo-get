// 面板里的翻译块（ALAG-27 §5）：状态推导是纯函数（blockModel），DOM 只按模型画。
// 顺序：浏览器不支持 → 本地下载状态 → SW 推来的 view → 空闲。下载只能由这里的点击触发（ALAG-24）。
import { sameLanguage } from '@/core/translate/language';
import { isTargetTag, languageName, resolveTarget, TARGET_LANGUAGES, type TargetSetting, type TargetTag } from '@/core/translate/targets';
import type { ModelSpec } from '@/core/translate/types';
import { currentLang, t, tn } from '@/shared/i18n';
import type { TranslationView } from '@/shared/types';
import { h, iconEl, type Child } from '../dom';

export type TranslationDownloadState =
  | { kind: 'downloading'; model: ModelSpec; fraction: number }
  | { kind: 'download-failed'; model: ModelSpec; message: string };

export interface TranslationBlockInput {
  /** 剪藏文件名（aborted 的「文件不见了」用）。 */
  file: string;
  supported: boolean;
  settings: { target: TargetSetting; always: boolean };
  view?: TranslationView;
  /** 面板本地的下载状态（优先于 SW 的 view）。 */
  download?: TranslationDownloadState;
  /** 用户在这次面板会话里选过的目标；没动过时用设置值。 */
  selectedTarget?: TargetTag;
  /** 当前界面语言；缺省读当前文案语言。 */
  uiLang?: 'zh' | 'en';
}

export type TranslationBlockKind =
  | 'idle'
  | 'unsupported'
  | 'downloading'
  | 'download-failed'
  | 'running'
  | 'complete'
  | 'skipped'
  | 'partial'
  | 'needs-download'
  | 'unsupported-pair'
  | 'source-unknown'
  | 'engine-failed'
  | 'aborted'
  | 'already-translated';

export type TranslationIcon = 'translate' | 'download' | 'check' | 'info' | 'error';

export interface TranslationButton {
  kind: 'translate' | 'download' | 'retry';
  label: string;
  /** 下载要用的模型。 */
  model?: ModelSpec;
  /** 下载完自动翻译、重试时用的目标语言。 */
  target?: string;
}

export interface TranslationBlockModel {
  kind: TranslationBlockKind;
  icon: TranslationIcon;
  /** 第一行文字（有下拉框时是下拉框的标签）。 */
  title: string;
  /** 说明行。 */
  desc?: string;
  /** 等宽错误原文。 */
  mono?: string;
  /** 下拉框（空闲、不支持、跳过、语言对不支持）。 */
  select?: { options: ReadonlyArray<TargetTag>; selected: TargetTag; label: string; disabled?: boolean };
  button?: TranslationButton;
  /** 下载进度（0–1）或翻译进度。 */
  fraction?: number;
  progress?: { done: number; total: number };
  /** 翻译时下拉框/按钮灰掉。 */
  disabled?: boolean;
}

export interface TranslationBlockActions {
  /** 记住用户选的目标（重渲染之间保留）。 */
  select(target: TargetTag): void;
  translate(target: TargetTag): void;
  /** 必须同步开始下载：调用方在点击处理函数里、任何 await 之前调 createChromeEngine().download。 */
  download(model: ModelSpec, target: string): void;
}

const OPTIONS = TARGET_LANGUAGES.map((language) => language.tag) as TargetTag[];

const pairOf = (from: string, to: string): string => t('tr_pair', [languageName(from), languageName(to)]);

/** 第一个不同于原文语言的选项；原文语言未知时取第一个。 */
function firstOther(source: string | undefined): TargetTag {
  if (source === undefined || source === '') return OPTIONS[0] ?? 'zh';
  return OPTIONS.find((tag) => !sameLanguage(tag, source)) ?? OPTIONS[0] ?? 'zh';
}

function finishModel(view: Extract<TranslationView, { phase: 'finished' }>, file: string): TranslationBlockModel {
  const { outcome } = view;
  const target = view.target;
  const lang = languageName(target);
  switch (outcome.status) {
    case 'complete': {
      const fromTo = outcome.source ? pairOf(outcome.source, target) : lang;
      return {
        kind: 'complete',
        icon: 'check',
        title: t('tr_done', [lang]),
        desc: tn('tr_doneDesc', outcome.applied, fromTo),
      };
    }
    case 'skipped':
      if (outcome.total === 0) {
        // 没有可翻译的文字：不是“原文就是目标语言”（ALAG-27 续修 1）。
        return { kind: 'skipped', icon: 'info', title: t('tr_nothingToTranslate') };
      }
      return {
        kind: 'skipped',
        icon: 'info',
        title: t('tr_skipped', [lang]),
        select: { options: OPTIONS, selected: firstOther(outcome.source), label: t('tr_tryOther') },
        button: { kind: 'translate', label: t('tr_translate'), target },
      };
    case 'partial':
      return {
        kind: 'partial',
        icon: 'error',
        title: t('tr_partial'),
        desc: t('tr_partialDesc', [String(outcome.applied), String(outcome.total)]),
        ...(outcome.error?.code === 'engine-failed' ? { mono: outcome.error.message } : {}),
      };
    case 'aborted':
      if (outcome.reason === 'already-translated') {
        return { kind: 'already-translated', icon: 'info', title: t('tr_alreadyTranslated') };
      }
      return {
        kind: 'aborted',
        icon: 'error',
        title: t('tr_stopped'),
        desc: fileGoneText(outcome.reason, file),
      };
    case 'failed': {
      const error = outcome.error;
      if (error?.code === 'needs-download') {
        if (error.model.kind === 'detector') {
          return {
            kind: 'needs-download',
            icon: 'download',
            title: t('tr_needsDetector'),
            desc: t('tr_needsDetectorDesc'),
            button: { kind: 'download', label: t('tr_downloadAndTranslate'), model: error.model, target },
          };
        }
        return {
          kind: 'needs-download',
          icon: 'download',
          title: t('tr_needsModel'),
          desc: t('tr_needsModelDesc', [pairOf(error.model.source, error.model.target)]),
          button: { kind: 'download', label: t('tr_downloadAndTranslate'), model: error.model, target },
        };
      }
      if (error?.code === 'unsupported-pair') {
        return {
          kind: 'unsupported-pair',
          icon: 'error',
          title: t('tr_failed'),
          desc: t('tr_unsupportedPair', [pairOf(error.source, error.target)]),
          select: { options: OPTIONS, selected: firstOther(error.source), label: t('tr_tryOther') },
          button: { kind: 'translate', label: t('tr_translate'), target },
        };
      }
      if (error?.code === 'source-unknown') {
        return { kind: 'source-unknown', icon: 'error', title: t('tr_failed'), desc: t('tr_sourceUnknown') };
      }
      return {
        kind: 'engine-failed',
        icon: 'error',
        title: t('tr_failed'),
        desc: t('tr_nothingTranslated'),
        ...(error?.code === 'engine-failed' ? { mono: error.message } : {}),
        button: { kind: 'retry', label: t('ui_retry'), target },
      };
    }
  }
}

/** aborted 的原因句；record/file/id 三类都是「文件不见了」，其余（含未知）按写入出错。 */
function fileGoneText(reason: string | undefined, file: string): string {
  if (reason === 'record-missing' || reason === 'file-missing' || reason === 'id-mismatch') return t('tr_fileGone', [file]);
  return t('tr_writeFailed');
}

export function blockModel(input: TranslationBlockInput): TranslationBlockModel {
  const uiLang = input.uiLang ?? currentLang();
  const settingsTarget = resolveTarget(input.settings.target, uiLang);
  const selected = input.selectedTarget !== undefined && isTargetTag(input.selectedTarget) ? input.selectedTarget : settingsTarget;

  if (!input.supported) {
    return {
      kind: 'unsupported',
      icon: 'translate',
      title: t('tr_translateTo'),
      desc: t('tr_unsupportedBrowser'),
      select: { options: OPTIONS, selected, label: t('tr_translateTo'), disabled: true },
      button: { kind: 'translate', label: t('tr_translate') },
      disabled: true,
    };
  }

  const download = input.download;
  if (download?.kind === 'downloading') {
    if (download.model.kind === 'detector') {
      return {
        kind: 'downloading',
        icon: 'download',
        title: t('tr_downloadingDetector'),
        desc: t('tr_downloadingDetectorDesc'),
        fraction: download.fraction,
      };
    }
    return {
      kind: 'downloading',
      icon: 'download',
      title: t('tr_downloading'),
      desc: t('tr_downloadingDesc', [pairOf(download.model.source, download.model.target)]),
      fraction: download.fraction,
    };
  }
  if (download?.kind === 'download-failed') {
    return {
      kind: 'download-failed',
      icon: 'error',
      title: t('tr_downloadFailed'),
      mono: download.message,
      button: {
        kind: 'download',
        label: t('ui_retry'),
        model: download.model,
        target: download.model.kind === 'translator' ? download.model.target : input.view?.target,
      },
    };
  }

  const view = input.view;
  if (view?.phase === 'running') {
    return {
      kind: 'running',
      icon: 'translate',
      title: t('tr_translating', [languageName(view.target)]),
      desc: t('tr_closeHint'),
      progress: { done: view.done, total: view.total },
    };
  }
  if (view?.phase === 'finished') return finishModel(view, input.file);

  return {
    kind: 'idle',
    icon: 'translate',
    title: t('tr_translateTo'),
    desc: t('tr_onlyThis'),
    select: { options: OPTIONS, selected, label: t('tr_translateTo') },
    button: { kind: 'translate', label: t('tr_translate') },
  };
}

function selectEl(model: NonNullable<TranslationBlockModel['select']>, actions: TranslationBlockActions): HTMLSelectElement {
  const select = h('select', { class: 'sel', ...(model.disabled ? { disabled: true } : {}) });
  for (const tag of model.options) {
    const endonym = TARGET_LANGUAGES.find((language) => language.tag === tag)?.endonym ?? tag;
    select.append(h('option', { value: tag }, endonym));
  }
  select.value = model.selected;
  select.addEventListener('change', () => {
    if (isTargetTag(select.value)) actions.select(select.value);
  });
  return select;
}

function selectWrap(select: HTMLSelectElement): HTMLElement {
  return h('span', { class: 'selw' }, [select, iconEl('chevronDown', 12, 'chev')]);
}

function progressBar(now: number, max: number, label: string): HTMLElement {
  const percent = max > 0 ? Math.min(100, Math.max(0, (now / max) * 100)) : 0;
  return h('div', { class: 'bar', role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': now }, [
    h('i', { style: `width:${percent}%` }),
  ]);
}

/** 按模型画翻译块；按钮的点击回调同步调用，下载因此仍带着用户手势。 */
export function renderTranslationBlock(model: TranslationBlockModel, actions: TranslationBlockActions): HTMLElement {
  const select = model.select ? selectEl(model.select, actions) : null;
  if (select) select.id = 'tr-target';
  const selectedTarget = (): TargetTag => (select && isTargetTag(select.value) ? select.value : (model.select?.selected ?? 'zh'));
  const translationTarget = (): TargetTag => (bTarget() ?? selectedTarget());
  function bTarget(): TargetTag | undefined {
    const target = model.button?.target;
    return target !== undefined && isTargetTag(target) ? target : undefined;
  }

  const button = (() => {
    if (!model.button) return null;
    const b = model.button;
    const onclick = (): void => {
      if (b.kind === 'download') {
        if (b.model) actions.download(b.model, b.target ?? selectedTarget());
      } else if (b.kind === 'retry') {
        actions.translate(translationTarget());
      } else {
        actions.translate(selectedTarget());
      }
    };
    const className = b.kind === 'download' ? 'btn pri' : 'btn sec';
    return h('button', { type: 'button', class: className, onclick, ...(model.disabled ? { disabled: true } : {}) }, b.label);
  })();

  const firstRow: Child[] = [iconEl(model.icon, 16, `ticon ${model.icon === 'check' ? 'success' : model.icon === 'error' ? 'errc' : ''}`.trim())];
  if (select && model.kind !== 'skipped' && model.kind !== 'unsupported-pair') {
    firstRow.push(h('label', { class: 'tl', for: 'tr-target' }, model.select?.label ?? model.title));
    firstRow.push(selectWrap(select));
    firstRow.push(button);
  } else {
    firstRow.push(h('span', { class: 'tl' }, model.title));
    // 还没分好段（total 为 0）时不显示「0 / 0」
    if (model.progress && model.progress.total > 0) firstRow.push(h('span', { class: 'num' }, t('tr_progress', [String(model.progress.done), String(model.progress.total)])));
    if (model.fraction !== undefined) firstRow.push(h('span', { class: 'num' }, `${Math.round(model.fraction * 100)}%`));
    if (button) firstRow.push(button);
  }

  const children: Child[] = [h('div', { class: 'trow' }, firstRow)];
  if (model.progress) children.push(progressBar(model.progress.done, model.progress.total, model.title));
  if (model.fraction !== undefined) children.push(progressBar(Math.round(model.fraction * 100), 100, model.title));
  if (model.desc) children.push(h('span', { class: 'sm' }, model.desc));
  if (model.mono) children.push(h('div', { class: 'mono' }, model.mono));
  if (select && (model.kind === 'skipped' || model.kind === 'unsupported-pair')) {
    children.push(
      h('div', { class: 'trow' }, [
        h('label', { class: 'tl dim', for: 'tr-target' }, model.select?.label ?? t('tr_tryOther')),
        selectWrap(select),
        button,
      ]),
    );
  }
  return h('div', { class: 'tr', 'data-kind': model.kind, 'data-translation-block': '' }, children);
}
