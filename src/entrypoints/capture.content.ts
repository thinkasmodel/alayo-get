// 页面内采集脚本：运行时按需注入，不在 manifest 里常驻（ADR-0004）。
// 响应 'capture'（抽取正文、转 Markdown；X 帖子页走专门适配，ALAG-3）、'capture-x-video'（X 视频的流媒体剪藏，ALAG-4）、
// 'capture-quote'（选区的摘录剪藏，ALAG-4；只注入顶层 frame）与 'toast'（页面右下角提示，DESIGN.md §3.3）。
import { isMediaDocument } from '@/core/media';
import { extractFromDocument } from '@/page/extract';
import { captureQuote } from '@/page/quote';
import { createPageDriver } from '@/page/x/driver';
import { extractX } from '@/page/x/extract';
import { sharedCapture } from '@/page/sharedCapture';
import { parseXStatusUrl } from '@/page/x/url';
import { captureXVideo } from '@/page/x/video';
import type { CaptureResponse, PageMessage, QuoteCaptureResponse } from '@/shared/messages';
import { mountToast } from '@/ui/toast/toast';

const DETACH_KEY = '__alayoGetCaptureDetach';

/** 采集当前页：X 帖子页走专门适配（会滚动、点开回复，异步），其余走通用抽取。出错回 {error}。回传 document.contentType（ALAG-4）。 */
async function captureCurrentPage(): Promise<CaptureResponse> {
  const contentType = document.contentType ?? '';
  try {
    // 文档本身是图片、音视频或 PDF：只回标题、地址和 contentType，由后台按媒体剪藏处理（ALAG-4）；
    // text/plain、XML 等其他非 HTML 文档照旧走通用抽取
    if (isMediaDocument(contentType)) {
      return {
        url: location.href,
        title: document.title,
        site: '',
        author: '',
        published: '',
        description: '',
        coverUrl: '',
        markdown: null,
        textLength: 0,
        kind: 'page',
        contentType,
      };
    }
    if (parseXStatusUrl(location.href)) return { ...(await extractX(document, location.href, createPageDriver())), contentType };
    return { ...extractFromDocument(document, location.href), contentType };
  } catch (err) {
    return { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

/** X 视频：先触发主世界标注（读视频时长），再按帖子 id 取视频信息（ALAG-4）。 */
function captureXVideoNow(statusId: string, srcUrl?: string): CaptureResponse {
  try {
    createPageDriver().annotate();
    return captureXVideo(document, statusId, location.href, srcUrl);
  } catch (err) {
    return { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    // 每次保存都会重新注入。先摘掉上一次注入留下的监听，只保留最新的一个，避免重复回应；
    // 扩展重载后旧监听挂在失效的 runtime 上，同样要换成新的。
    const scope = globalThis as unknown as Record<string, (() => void) | undefined>;
    try {
      scope[DETACH_KEY]?.();
    } catch {
      // 上一个实例所属的扩展已重载，摘不掉也收不到消息，忽略。
    }

    const listener = (message: PageMessage, _sender: unknown, sendResponse: (response: CaptureResponse | QuoteCaptureResponse) => void) => {
      if (message?.type === 'capture') {
        // 异步回应：返回 true，采集完成后再 sendResponse。
        // 重复注入时复用进行中的采集（挂在隔离世界的全局上），不让两个采集器同时操作页面。
        // 按页面身份区分：站内切页后（地址变了）开新的采集，不复用上一帖的结果。
        void sharedCapture(globalThis as unknown as Record<string, unknown>, parseXStatusUrl(location.href)?.id ?? location.href, captureCurrentPage).then(sendResponse);
        return true;
      }
      if (message?.type === 'capture-x-video') {
        sendResponse(captureXVideoNow(message.statusId, message.srcUrl));
        return;
      }
      if (message?.type === 'capture-quote') {
        let response: QuoteCaptureResponse;
        try {
          response = captureQuote();
        } catch (err) {
          // 取选区或转换出错：按取不到处理，后台改用右键菜单给的选中文字
          console.warn('[Alayo Get] 摘录采集出错', err);
          response = { url: location.href, title: document.title, quote: null };
        }
        sendResponse(response);
        return;
      }
      if (message?.type === 'toast') {
        const requestId = message.requestId;
        mountToast(message.outcome, {
          sendMessage: (m) => {
            // 提示上的按钮带上所属请求，后台按它找回这条提示对应的采集结果；后台的回应（「加批注…」是否打开了面板）交回提示
            const out = m.type === 'toast-action' ? { ...m, requestId } : m;
            return browser.runtime.sendMessage(out).catch((err: unknown) => {
              console.warn('[Alayo Get] 发送提示动作失败', err);
              return undefined;
            });
          },
        });
      }
    };
    browser.runtime.onMessage.addListener(listener);
    scope[DETACH_KEY] = () => browser.runtime.onMessage.removeListener(listener);
  },
});
