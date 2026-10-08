// 工具栏面板（DESIGN.md §3.2）：打开即保存，按 service worker 推来的状态重渲染，字段改动随时同步，关闭即写入。
import { get } from 'idb-keyval';
import { LIBRARY_HANDLE_KEY } from '@/io/library';
import { createSavedIndex } from '@/io/savedIndex';
import { currentLang } from '@/shared/i18n';
import { PANEL_PORT, type OpenOptionsMessage, type PanelToSw, type SwToPanel } from '@/shared/messages';
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
  };

  function connect() {
    const next = browser.runtime.connect({ name: PANEL_PORT });
    next.onMessage.addListener((message: SwToPanel) => {
      if (next !== port || message?.type !== 'state') return;
      const state = message.state;
      if (state.state === 'saved' || state.state === 'fallback') clipId = state.clip.id;
      renderPanel(root, { state, folderName }, actions);
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
