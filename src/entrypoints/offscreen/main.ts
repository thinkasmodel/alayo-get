// offscreen 文档的胶水（ALAG-25，ADR-0011）：SW 用名为 'translate' 的 Port 连过来，
// 由本机引擎驱动的执行器完成翻译。阅读器等扩展页面也可以直接用 runner，不经这里。
import { createChromeEngine } from '@/core/translate/chromeEngine';
import { createTranslationRunner } from '@/core/translate/runner';
import { createIdleCloser, handleTranslateHostPort } from '@/offscreen/host';
import { TRANSLATE_PORT, type SwToTranslateHost, type TranslateHostToSw } from '@/shared/messages';
import type { PortLike } from '@/sw/ports';

// 整个 offscreen 文档共用一个执行器：多个 Port 之间也要 FIFO，并共用引擎的实例缓存。
const service = createTranslationRunner(createChromeEngine());
// 空闲关闭放在文档自己这里计时：SW 的计时器会随休眠丢失（ADR-0011）。
const activity = createIdleCloser({ close: () => window.close() });

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== TRANSLATE_PORT) return;
  handleTranslateHostPort(port as unknown as PortLike<SwToTranslateHost, TranslateHostToSw>, service, activity);
});
