// 选项页（DESIGN.md §3.5）：首次使用引导、设置、重新授权。选目录和恢复授权只在这里做（ADR-0004）。
import { get, set } from 'idb-keyval';
import { LIBRARY_HANDLE_KEY } from '@/io/library';
import { createPendingQueue } from '@/io/pending';
import { currentLang, t } from '@/shared/i18n';
import type { LibraryGrantedMessage } from '@/shared/messages';
import { renderOptions, type LibraryHandle, type OptionsDeps } from '@/ui/options/render';
import '@/ui/tokens.css';
import './style.css';

// TS 的 DOM 库没有 showDirectoryPicker，这里补最小声明。
interface DirectoryPickerWindow {
  showDirectoryPicker(options: { id: string; mode: 'readwrite'; startIn: 'documents' }): Promise<LibraryHandle>;
}

async function main() {
  document.documentElement.lang = currentLang() === 'zh' ? 'zh-CN' : 'en';
  document.title = t('opt_pageTitle');
  const root = document.getElementById('app') ?? document.body;
  const pending = createPendingQueue();

  const deps: OptionsDeps = {
    loadHandle: () => get<LibraryHandle>(LIBRARY_HANDLE_KEY),
    saveHandle: (handle) => set(LIBRARY_HANDLE_KEY, handle),
    pickDirectory: () =>
      (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
        id: 'alayo-get-library',
        mode: 'readwrite',
        startIn: 'documents',
      }),
    listPending: () => pending.list(),
    notifyGranted: async () => {
      const message: LibraryGrantedMessage = { type: 'library-granted' };
      try {
        const reply = (await browser.runtime.sendMessage(message)) as { saved?: unknown } | undefined;
        return typeof reply?.saved === 'number' ? { saved: reply.saved } : undefined;
      } catch (err) {
        console.warn('[Alayo Get] 通知补写失败', err);
        return undefined;
      }
    },
    platform: async () => {
      try {
        const info = await browser.runtime.getPlatformInfo();
        return info.os === 'mac' ? 'mac' : 'other';
      } catch (err) {
        console.warn('[Alayo Get] 读取系统信息失败，按非 Mac 显示', err);
        return 'other';
      }
    },
    shortcut: async () => {
      try {
        const commands = await browser.commands.getAll();
        return commands.find((c) => c.name === 'save-page')?.shortcut || null;
      } catch (err) {
        console.warn('[Alayo Get] 读取快捷键失败，按未设置显示', err);
        return null;
      }
    },
  };

  const page = await renderOptions(root, deps);
  page.applyAnchor(location.hash);
  window.addEventListener('hashchange', () => page.applyAnchor(location.hash));
}

main().catch((err) => console.error('[Alayo Get] 选项页初始化失败', err));
