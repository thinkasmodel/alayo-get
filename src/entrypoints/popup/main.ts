// 工具栏面板（DESIGN.md §3.2）：打开即保存，按 service worker 推来的状态重渲染，字段改动随时同步，关闭即写入。
import { get } from 'idb-keyval';
import { LIBRARY_HANDLE_KEY } from '@/io/library';
import { createSavedIndex } from '@/io/savedIndex';
import { currentLang } from '@/shared/i18n';
import { PANEL_PORT, type OpenOptionsMessage, type PanelToSw, type SwToPanel } from '@/shared/messages';
import type { LostEdit, LostEditNotice, PanelState } from '@/shared/types';
import { renderPanel, type PanelActions } from '@/ui/panel/render';
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

  let port: Port | null = null;
  /** 已存下的剪藏 id 和最后一次完整草稿：service worker 被终止导致断线时，用它们重连并接着编辑（codex review 第 8 轮）。 */
  let clipId: string | null = null;
  let lastFields: Parameters<PanelActions['postDraft']>[0] | null = null;
  /** lastFields 属于哪条剪藏。 */
  let lastFieldsClipId: string | null = null;
  /** 最后一次收到的面板状态，和写回失败留下的草稿（ALAG-20）；两者任一变化都整体重渲染。 */
  let lastState: PanelState | null = null;
  let lost: { edits: LostEdit[]; notices: LostEditNotice[] } = { edits: [], notices: [] };

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
    renderPanel(root, { state, folderName, lostEdits: lost.edits, lostNotices: lost.notices }, actions);
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
      send({ type: 'draft', fields });
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
  };

  function connect() {
    const next = browser.runtime.connect({ name: PANEL_PORT });
    next.onMessage.addListener((message: SwToPanel) => {
      if (next !== port) return;
      if (message?.type === 'state') {
        const state = message.state;
        // clip-unavailable 不设 clipId：断线后没有可以接着编辑的剪藏
        if (state.state === 'saved' || state.state === 'fallback') clipId = state.clip.id;
        lastState = state;
        rerender(false);
      } else if (message?.type === 'lost-edits') {
        lost = { edits: message.edits, notices: message.notices };
        rerender(true);
      }
    });
    // 面板还开着时断线（service worker 被终止）：重连，接着编辑同一条剪藏，并补发最后一次完整草稿。
    // 面板自己关闭或主动换 Port 时不会触发这里。
    next.onDisconnect.addListener(() => {
      if (next !== port) return;
      port = null;
      if (clipId === null) return;
      connect();
      send({ type: 'resume', clipId });
      if (lastFields) send({ type: 'draft', fields: lastFields });
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
