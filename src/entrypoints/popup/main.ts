// 工具栏面板（DESIGN.md §3.2）：打开即保存，按 service worker 推来的状态重渲染，字段改动随时同步，关闭即写入。
import { get } from 'idb-keyval';
import { createChromeEngine, isTranslationSupported } from '@/core/translate/chromeEngine';
import { isTargetTag, resolveTarget, type TargetTag } from '@/core/translate/targets';
import { LIBRARY_HANDLE_KEY } from '@/io/library';
import { createSavedIndex } from '@/io/savedIndex';
import { createTranslationSettings, DEFAULT_TRANSLATION_SETTINGS, type TranslationSettings } from '@/io/translationSettings';
import { currentLang } from '@/shared/i18n';
import { PANEL_PORT, type OpenOptionsMessage, type PanelToSw, type SwToPanel } from '@/shared/messages';
import type { EditFields, LostEdit, LostEditNotice, PanelState, TranslationView } from '@/shared/types';
import { changedFields } from '@/core/editFields';
import { mergeIncoming, type FormFields } from '@/ui/panel/merge';
import { renderPanel, updateTranslationBlock, type PanelActions, type PanelTranslation } from '@/ui/panel/render';
import type { TranslationDownloadState } from '@/ui/panel/translation';
import '@/ui/tokens.css';
import './style.css';

type Port = Browser.runtime.Port;

async function main() {
  document.documentElement.lang = currentLang() === 'zh' ? 'zh-CN' : 'en';
  const root = document.getElementById('app') ?? document.body;
  // 句柄只用来显示文件夹名；读不到时底栏留空，并按"还没有选择剪藏库"显示需要授权的状态
  const handle = await get<FileSystemDirectoryHandle>(LIBRARY_HANDLE_KEY).catch(() => undefined);
  const folderName = handle?.name ?? null;
  const index = createSavedIndex();
  // 翻译块（ALAG-27）：支持标记由面板加载时写入；设置现读。用户选过的目标在重渲染之间保留。
  const translationSettingsStore = createTranslationSettings();
  const translationSupported = isTranslationSupported();
  let translationSettings: TranslationSettings = DEFAULT_TRANSLATION_SETTINGS;
  let translationView: TranslationView | null = null;
  let translationDownload: TranslationDownloadState | null = null;
  let translationTarget: TargetTag | null = null;
  let translationClipId: string | null = null;
  await translationSettingsStore.setSupported(translationSupported).catch((err: unknown) => {
    console.warn('[Alayo Get] 记录翻译支持标记失败', err);
  });
  translationSettings = await translationSettingsStore.get().catch((err: unknown) => {
    console.warn('[Alayo Get] 读取翻译设置失败，按默认值显示', err);
    return DEFAULT_TRANSLATION_SETTINGS;
  });

  let port: Port | null = null;
  /** 已存下的剪藏 id 和最后一次完整草稿：service worker 被终止导致断线时，用它们重连并接着编辑（codex review 第 8 轮）。 */
  let clipId: string | null = null;
  let lastFields: FormFields | null = null;
  /** lastFields 属于哪条剪藏。 */
  let lastFieldsClipId: string | null = null;
  /** 最后一条 saved / fallback 状态里剪藏的三个字段（不含本地叠加）：本地改动按它算（codex review 第 5 轮）。 */
  let baselineFields: FormFields | null = null;
  /** 最后一条 state 消息的基线号；每条 draft 都带上，service worker 据此丢弃旧表单的修改（ALAG-20）。 */
  let lastBaseline: number | undefined;
  const draftMessage = (fields: EditFields): PanelToSw =>
    lastBaseline === undefined ? { type: 'draft', fields } : { type: 'draft', fields, baseline: lastBaseline };
  /** 最后一次收到的面板状态，和写回失败留下的草稿（ALAG-20）；两者任一变化都整体重渲染。 */
  let lastState: PanelState | null = null;
  let lost: { edits: LostEdit[]; notices: LostEditNotice[] } = { edits: [], notices: [] };

  /** 当前翻译块的数据；整块重渲染与只更新翻译块时共用（ALAG-27）。 */
  const translationData = (): PanelTranslation => ({
    supported: translationSupported,
    settings: translationSettings,
    ...(translationView ? { view: translationView } : {}),
    ...(translationDownload ? { download: translationDownload } : {}),
    ...(translationTarget ? { selectedTarget: translationTarget } : {}),
  });

  /**
   * 按最后的状态和草稿重渲染。只因草稿列表变化而重渲染时，编辑态的字段按已经输入的内容显示：
   * 否则输入框会回到已存的值，而 service worker 里的草稿还是输入过的内容。
   */
  const rerender = (keepInput: boolean) => {
    if (lastState === null) return;
    let state = lastState;
    if (keepInput && lastFields && (state.state === 'saved' || state.state === 'fallback') && state.clip.id === lastFieldsClipId) {
      state = { ...state, clip: { ...state.clip, ...lastFields } };
    }
    renderPanel(
      root,
      {
        state,
        folderName,
        lostEdits: lost.edits,
        lostNotices: lost.notices,
        translation: translationData(),
      },
      actions,
    );
  };

  const send = (message: PanelToSw) => {
    try {
      port?.postMessage(message);
    } catch (err) {
      console.warn('[Alayo Get] 面板与 service worker 的连接已断开', err);
    }
  };

  const actions: PanelActions = {
    postDraft: (fields) => {
      lastFields = fields;
      lastFieldsClipId = clipId;
      send(draftMessage(fields));
    },
    snapshot: () => send({ type: 'snapshot' }),
    retry: () => {
      // service worker 一侧每个 Port 只接受一次 start，重试换一个新 Port 再发
      port?.disconnect();
      connect();
      start();
    },
    openOptions: async (section) => {
      const message: OpenOptionsMessage = { type: 'open-options', section };
      await browser.runtime.sendMessage(message);
    },
    openSettings: () => void browser.runtime.openOptionsPage(),
    closePanel: () => window.close(),
    loadIndex: () => index.all(),
    lostEdit: (action, id) => send({ type: 'lost-edit', action, id }),
    selectTranslationTarget: (target) => {
      translationTarget = target;
    },
    translate: (target) => {
      translationTarget = target;
      send({ type: 'translate', target });
    },
    startTranslationDownload: (model, target) => {
      translationDownload = { kind: 'downloading', model, fraction: 0 };
      updateTranslationBlock(root, translationData(), actions);
      const fail = (err: unknown): void => {
        const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        translationDownload = { kind: 'download-failed', model, message };
        updateTranslationBlock(root, translationData(), actions);
      };
      let engine;
      try {
        engine = createChromeEngine();
      } catch (err) {
        fail(err);
        return;
      }
      // 必须在这里、任何 await 之前开始下载：下载要求用户手势（ALAG-24）。
      let started: Promise<void>;
      try {
        started = engine.download(model, (fraction) => {
          if (translationDownload?.kind !== 'downloading') return;
          translationDownload = { kind: 'downloading', model, fraction };
          updateTranslationBlock(root, translationData(), actions);
        });
      } catch (err) {
        fail(err);
        return;
      }
      started.then(
        () => {
          // 下载完自动用同一目标翻译；检测模型下完后若还缺翻译模型，会再回到 C 态，需要再点一次。
          const chosen = isTargetTag(target) ? target : resolveTarget(translationSettings.target, currentLang());
          translationTarget = chosen;
          translationDownload = null;
          send({ type: 'translate', target: chosen });
          updateTranslationBlock(root, translationData(), actions);
        },
        (err: unknown) => fail(err),
      );
    },
  };

  function connect() {
    const next = browser.runtime.connect({ name: PANEL_PORT });
    next.onMessage.addListener((message: SwToPanel) => {
      if (next !== port) return;
      if (message?.type === 'state') {
        const state = message.state;
        const nextClipId = state.state === 'saved' || state.state === 'fallback' ? state.clip.id : null;
        if (nextClipId !== translationClipId) {
          translationClipId = nextClipId;
          translationView = null;
          translationDownload = null;
          translationTarget = null;
        }
        lastBaseline = message.baseline;
        // clip-unavailable 不设 clipId：断线后没有可以接着编辑的剪藏
        if (state.state === 'saved' || state.state === 'fallback') {
          clipId = state.clip.id;
          const clipFields: FormFields = { title: state.clip.title, tags: [...state.clip.tags], note: state.clip.note };
          if (lastFieldsClipId === state.clip.id) {
            // 同一条剪藏的新基线（如重试写回后）：用户相对上一基线改过的字段叠回去，
            // 有本地改动就按新基线重发（带旧基线号的那条已被 service worker 丢弃，codex review 第 5 轮）
            const { merged, localEdits } = mergeIncoming(baselineFields, lastFields, clipFields);
            baselineFields = clipFields;
            lastFields = merged;
            lastState = { ...state, clip: { ...state.clip, ...merged } };
            rerender(false);
            if (Object.keys(localEdits).length > 0) send(draftMessage(merged));
            return;
          }
          baselineFields = clipFields;
          lastFields = clipFields;
          lastFieldsClipId = state.clip.id;
        }
        lastState = state;
        rerender(false);
      } else if (message?.type === 'translation') {
        if (message.clipId !== translationClipId) return;
        translationView = message.view;
        if (message.view.phase === 'running') translationDownload = null;
        updateTranslationBlock(root, translationData(), actions);
      } else if (message?.type === 'lost-edits') {
        lost = { edits: message.edits, notices: message.notices };
        rerender(true);
      }
    });
    // 面板还开着时断线（service worker 被终止）：重连，接着编辑同一条剪藏，并补发用户相对基线改过的字段。
    // 面板自己关闭或主动换 Port 时不会触发这里。
    next.onDisconnect.addListener(() => {
      if (next !== port) return;
      port = null;
      if (clipId === null) return;
      connect();
      // 带上基线号和它对应的表单基线，service worker 按它从之后的 draft 里提取改过的字段（第 7 轮）
      send({
        type: 'resume',
        clipId,
        ...(lastBaseline === undefined ? {} : { baseline: lastBaseline }),
        ...(baselineFields ? { baselineFields } : {}),
      });
      // 只补发改过的字段：没改的不发，后台被终止期间文件在别处被改过也不会被面板的旧值覆盖（codex review 第 5 轮）
      const diff = baselineFields && lastFields ? changedFields(baselineFields, lastFields) : {};
      if (Object.keys(diff).length > 0) send(draftMessage(diff));
    });
    port = next;
  }

  connect();
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  if (tabId === undefined) console.warn('[Alayo Get] 取不到当前标签页');

  function start() {
    if (tabId === undefined) return;
    send({ type: 'start', tabId });
  }
  start();
}

main().catch((err) => console.error('[Alayo Get] 面板初始化失败', err));
