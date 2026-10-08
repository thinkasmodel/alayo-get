// service worker 接线：快捷键、右键菜单、面板与页面提示的 Port、授权后补写、角标（ADR-0004）；
// 打开选项页、页面提示上的按钮、首次安装打开引导页（ALAG-2B）；媒体剪藏、流媒体剪藏与摘录剪藏的入口与路由（ALAG-4）。
import { ulid } from 'ulid';
import { canonicalizeUrl } from '@/core/canonical';
import { siteFromUrl } from '@/core/frontmatter';
import type { ParsedStream } from '@/core/stream';
import { pinnedLibrary, type Library } from '@/io/library';
import { createPendingQueue } from '@/io/pending';
import { createQuoteEntries } from '@/io/quoteEntries';
import { createQuoteOps } from '@/io/quoteOps';
import { createSavedIndex } from '@/io/savedIndex';
import { createToastRequests } from '@/io/toastRequests';
import { installXAnnotator } from '@/page/x/annotate';
import { parseXStatusUrl } from '@/page/x/url';
import { t } from '@/shared/i18n';
import {
  isCaptureError,
  PANEL_PORT,
  TOAST_NOTE_PORT,
  type CaptureResponse,
  type OpenOptionsMessage,
  type PanelToSw,
  type QuoteCaptureResponse,
  type SwToPanel,
  type ToastActionMessage,
  type ToastMessage,
  type SwToToastNote,
  type ToastNoteToSw,
} from '@/shared/messages';
import type { Capture, PanelState, Preview, SaveOutcome } from '@/shared/types';
import { createBadge } from '@/sw/badge';
import { createClipBook } from '@/sw/clips';
import { handlePanelPort, handleToastNotePort, type PortLike } from '@/sw/ports';
import {
  classifyTab,
  mediaCapture,
  predictPreviewMedium,
  resolveQuoteCapture,
  routeContextClick,
  xVideoNeedsPost,
  type ContextClick,
} from '@/sw/route';
import { createMenuInstaller } from '@/sw/menus';
import { captureLink, flushPending, saveClip, tooLargeForSession, type SaveDeps } from '@/sw/saveClip';
import { probeMediaKind } from '@/sw/saveMedia';
import { blobStreamCapture, captureStreamPage, netdiskStreamCapture, partialStreamCapture } from '@/sw/saveStream';

const CAPTURE_SCRIPT = '/content-scripts/capture.js';

type Tab = Browser.tabs.Tab;

export default defineBackground(() => {
  const index = createSavedIndex();
  const pending = createPendingQueue();
  const badge = createBadge();
  /** 最近保存的剪藏（页面提示写批注、面板关闭写回时按 id 找回）；摘录另记在 storage.session（ALAG-4）。 */
  const clips = createClipBook({ index, quotes: createQuoteEntries(), quoteOps: createQuoteOps(), library: pinnedLibrary });
  /** 页面提示对应的采集结果（存 storage.session，后台重启后仍在）。提示上的“重试”“另存新快照”按它重放。 */
  const toastRequests = createToastRequests();

  /** 每次保存都把剪藏库句柄固定在开始这一刻（pinnedLibrary）。 */
  const deps = (onProgress?: (state: PanelState) => void, library: Library = pinnedLibrary()): SaveDeps => ({
    library,
    index,
    pending,
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    newId: () => ulid(),
    onProgress,
  });

  /** 更新角标并记住所在库；摘录要等摘录记录写进 storage.session（后台被终止后写批注靠它）。 */
  const afterOutcome = async (outcome: SaveOutcome, library: Library): Promise<void> => {
    badge.show(outcome).catch((err) => console.error('[Alayo Get] 角标更新失败', err));
    if (outcome.state === 'saved' || outcome.state === 'fallback') {
      await clips.remember(outcome.clip, library).catch((err) => console.warn('[Alayo Get] 记录摘录失败', err));
    }
  };

  /** 只有标签页标题和地址的采集结果（不能注入，或页面没有回应）。 */
  const tabCapture = (tab: Tab, kind: 'page' | 'uninjectable'): Capture => ({
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    site: '',
    author: '',
    published: '',
    description: '',
    coverUrl: '',
    markdown: null,
    textLength: 0,
    kind,
  });

  /** 向标签页注入采集脚本（它也负责显示页面提示）；页面不允许注入时返回 false。 */
  const injectCapture = async (tabId: number): Promise<boolean> => {
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: [CAPTURE_SCRIPT] });
      return true;
    } catch (err) {
      console.info('[Alayo Get] 页面不允许注入', err);
      return false;
    }
  };

  /**
   * X 帖子页：先在主世界装标注器（ADR-0003 修订），采集脚本派发事件后从 data-alayo-x 读原帖地址、t.co 映射和视频时长。
   * 失败只记一笔，不影响保存（读不到时采集脚本按 DOM 退回）。
   */
  const installAnnotator = async (tabId: number): Promise<void> => {
    try {
      await browser.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: installXAnnotator });
    } catch (err) {
      console.info('[Alayo Get] X 标注器注入失败，按只读 DOM 继续', err);
    }
  };

  /** 注入采集脚本并取回 Capture；注入失败按不能注入的页面处理。 */
  const capturePage = async (tab: Tab): Promise<Capture> => {
    const tabId = tab.id;
    if (tabId === undefined) return tabCapture(tab, 'uninjectable');
    if (parseXStatusUrl(tab.url ?? tab.pendingUrl ?? '')) await installAnnotator(tabId);
    if (!(await injectCapture(tabId))) return tabCapture(tab, 'uninjectable');
    try {
      const res = (await browser.tabs.sendMessage(tabId, { type: 'capture' })) as CaptureResponse | undefined;
      if (res && !isCaptureError(res)) return res;
      console.warn('[Alayo Get] 页面采集出错，存成书签剪藏', res?.error);
    } catch (err) {
      console.warn('[Alayo Get] 页面没有回应采集请求，存成书签剪藏', err);
    }
    return tabCapture(tab, 'page');
  };

  /**
   * X 视频（ALAG-4）：先在主世界装标注器，再注入采集脚本，按帖子 id 取视频信息。
   * 帖子里没有视频、找不到帖子、页面不能注入或没回应时返回 null。
   */
  const requestXVideo = async (tab: Tab | undefined, statusId: string, srcUrl?: string): Promise<Capture | null> => {
    const tabId = tab?.id;
    if (tabId === undefined) return null;
    await installAnnotator(tabId);
    if (!(await injectCapture(tabId))) return null;
    try {
      const res = (await browser.tabs.sendMessage(tabId, { type: 'capture-x-video', statusId, srcUrl })) as CaptureResponse | undefined;
      if (res && !isCaptureError(res)) return res;
      console.info('[Alayo Get] 没有取到 X 视频', res?.error);
    } catch (err) {
      console.warn('[Alayo Get] 页面没有回应 X 视频采集请求', err);
    }
    return null;
  };

  /**
   * 平台视频页（ALAG-4 §5）：YouTube、B 站由 SW 抓视频页；X 视频专链在页面里采集；网盘走通用采集，拿不到标题照旧存书签剪藏。
   * 元数据取不到时退用标签页标题，extract partial。
   */
  const captureStreamTab = async (tab: Tab, parsed: ParsedStream): Promise<Capture> => {
    const title = tab.title ?? '';
    switch (parsed.platform) {
      case 'youtube':
      case 'bilibili':
        return captureStreamPage(parsed, title, (input, init) => fetch(input, init));
      case 'x':
        return (await requestXVideo(tab, parsed.videoId)) ?? partialStreamCapture(parsed, title);
      default: {
        const page = await capturePage(tab);
        return netdiskStreamCapture(page, parsed) ?? { ...page, markdown: null };
      }
    }
  };

  /**
   * 工具栏、快捷键、右键页面空白处的采集（ALAG-4 §3 第 2 条）：平台视频页 → 流媒体剪藏；
   * 标签页是 PDF 或媒体文件本身（采集脚本回传的 contentType；不能注入或没回应时 SW 对地址发 HEAD）→ 媒体剪藏；其余照旧。
   */
  const captureTab = async (tab: Tab): Promise<Capture> => {
    const url = tab.url ?? tab.pendingUrl ?? '';
    const route = classifyTab(url);
    if (route.action === 'stream') return captureStreamTab(tab, route.parsed);
    const capture = await capturePage(tab);
    let kind = null;
    if (capture.contentType !== undefined) {
      const typed = classifyTab(url, capture.contentType);
      if (typed.action === 'media') kind = typed.kind;
    } else if (capture.markdown === null) {
      kind = await probeMediaKind((input, init) => fetch(input, init), url);
    }
    return kind ? mediaCapture(url, tab.title ?? '', kind, url) : capture;
  };

  const extractingState = (tab: Tab): PanelState => {
    const url = tab.url ?? tab.pendingUrl ?? '';
    const source = canonicalizeUrl(url);
    return {
      state: 'saving',
      // 预览卡图标按标签页地址预判，采集完成后由 previewOf 给出准确值（ALAG-4 §3a）
      preview: { title: tab.title || source, site: siteFromUrl(source), source, medium: predictPreviewMedium(url) },
      progress: { phase: 'extract' },
    };
  };

  /** 发页面提示；带上这次保存的采集结果编号，提示上的按钮据此重放同一份内容。 */
  const sendToast = async (tabId: number | undefined, outcome: SaveOutcome, capture?: Capture) => {
    if (tabId === undefined) return;
    let requestId: string | undefined;
    // 太长的 data: 图片不进提示重放记录（storage.session 配额），提示不带 requestId（ALAG-4 §3a）
    if (capture && !tooLargeForSession(capture)) {
      requestId = ulid();
      await toastRequests.put(requestId, capture).catch((err) => {
        console.warn('[Alayo Get] 记录页面提示的采集结果失败', err);
        requestId = undefined;
      });
    }
    const message: ToastMessage = { type: 'toast', outcome, requestId };
    await browser.tabs.sendMessage(tabId, message).catch(() => {
      // 不能注入的页面没有采集脚本，收不到提示；角标已经反映结果。
    });
  };

  /** 保存一份采集结果：剪藏库固定在开始这一刻，结果更新角标并记住所在库。 */
  const saveCapture = async (capture: Capture, snapshot: boolean, onState?: (state: PanelState) => void) => {
    const d = deps(onState);
    const outcome = await saveClip({ capture, snapshot }, d);
    await afterOutcome(outcome, d.library);
    return outcome;
  };

  /** 快捷键、右键菜单、面板共用的保存当前页流程。 */
  const savePage = async (tab: Tab, onState?: (state: PanelState) => void) => {
    onState?.(extractingState(tab));
    const capture = await captureTab(tab);
    const outcome = await saveCapture(capture, false, onState);
    return { capture, outcome };
  };

  const saveFromShortcutOrMenu = async (tab: Tab | undefined) => {
    const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (!target) return;
    const { capture, outcome } = await savePage(target);
    // 流媒体、媒体剪藏可能没经过页面采集（SW 自己抓的），先注入采集脚本，提示才有接收端
    if ((capture.kind === 'stream' || capture.kind === 'media') && target.id !== undefined) await injectCapture(target.id);
    await sendToast(target.id, outcome, capture);
  };

  /** 右键链接：平台链接存流媒体剪藏（ALAG-4 §5），其余照旧存书签剪藏。 */
  const linkCapture = async (linkUrl: string, linkText: string, stream: ParsedStream | null): Promise<Capture> => {
    const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);
    if (!stream) return captureLink(linkUrl, linkText, fetchFn);
    switch (stream.platform) {
      case 'youtube':
      case 'bilibili':
        return captureStreamPage(stream, linkText, fetchFn);
      case 'x':
        // 别处的 X 视频专链：SW 抓不到内容，标题用链接文字或 URL
        return partialStreamCapture(stream, linkText);
      default: {
        const link = await captureLink(linkUrl, linkText, fetchFn);
        return netdiskStreamCapture(link, stream) ?? link;
      }
    }
  };

  const saveLink = async (linkUrl: string, linkText: string, tab: Tab | undefined, stream: ParsedStream | null) => {
    const capture = await linkCapture(linkUrl, linkText, stream);
    const outcome = await saveCapture(capture, false);
    // 右键保存链接时页面里可能还没有采集脚本，先注入，提示才有接收端；不能注入的页面只靠角标。
    if (tab?.id !== undefined && (await injectCapture(tab.id))) await sendToast(tab.id, outcome, capture);
  };

  /** 不写文件、直接失败的保存（右键媒体的路由判定）：更新角标并发页面提示。 */
  const failWithoutSaving = async (tab: Tab | undefined, preview: Preview, error: { name: string; message: string }) => {
    const outcome: SaveOutcome = { state: 'failed', preview, error };
    badge.show(outcome).catch((err) => console.error('[Alayo Get] 角标更新失败', err));
    if (tab?.id !== undefined && (await injectCapture(tab.id))) await sendToast(tab.id, outcome);
  };

  /** 右键图片、视频、音频（ALAG-4 §3 第 1 条）。 */
  const saveContextMedia = async (info: ContextClick, tab: Tab | undefined) => {
    const route = routeContextClick(info);
    const pageUrl = info.pageUrl ?? tab?.url ?? '';
    const pageTitle = tab?.title ?? '';
    const source = canonicalizeUrl(pageUrl);
    const preview: Preview = { title: pageTitle || source, site: siteFromUrl(source), source, medium: 'web' };
    let capture: Capture | null;
    switch (route.action) {
      case 'stream':
        if (route.from === 'page' && tab) capture = await captureStreamTab(tab, route.parsed);
        else if (route.parsed.platform === 'youtube' || route.parsed.platform === 'bilibili') {
          capture = await captureStreamPage(route.parsed, '', (input, init) => fetch(input, init));
        } else capture = partialStreamCapture(route.parsed, '');
        break;
      case 'x-video':
        capture = await requestXVideo(tab, route.statusId, info.srcUrl);
        // 焦点帖里找不到视频（点的是回复里的视频）：同样请用户打开帖子页
        if (!capture) return failWithoutSaving(tab, preview, xVideoNeedsPost());
        break;
      case 'media':
        capture = mediaCapture(pageUrl, pageTitle, route.kind, route.url);
        break;
      case 'blob-stream':
        capture = blobStreamCapture(pageUrl, pageTitle, route.medium);
        break;
      case 'fail':
        return failWithoutSaving(tab, preview, { name: route.name, message: route.message });
      default:
        return;
    }
    const outcome = await saveCapture(capture, false);
    if (tab?.id !== undefined && (await injectCapture(tab.id))) await sendToast(tab.id, outcome, capture);
  };

  /**
   * 选中文字（ALAG-4 brief B §1）：只向顶层 frame 注入采集脚本并发 capture-quote（不往子 frame 注入，免得以后保存这一页时
   * 两个 frame 抢着回应 capture）。选区在子 frame 里（此时不为采集注入）、不能注入、页面没回应或取不到选区时，用右键菜单给的选中文字。
   * 结果以页面提示显示：提示发给顶层 frame 的采集脚本，采集时没注入的（选区在子 frame 里）保存后再向顶层注入，同右键保存链接。
   */
  const saveQuote = async (info: ContextClick, tab: Tab | undefined) => {
    const tabId = tab?.id;
    let injected = false;
    let page: QuoteCaptureResponse | null = null;
    if (tabId !== undefined && (info.frameId ?? 0) === 0 && (await injectCapture(tabId))) {
      injected = true;
      try {
        page = ((await browser.tabs.sendMessage(tabId, { type: 'capture-quote' }, { frameId: 0 })) as QuoteCaptureResponse | undefined) ?? null;
      } catch (err) {
        console.warn('[Alayo Get] 页面没有回应摘录采集请求，改用选中文字', err);
      }
    }
    const resolved = resolveQuoteCapture(page, info, tab, new Date());
    // 每次摘录操作生成一个 opId（放在这里而不在 resolveQuoteCapture：它是纯函数，已有测试按值比较）；
    // 暂存补写与页面提示重放都沿用 Capture 里的它，saveQuote 据此幂等
    const capture: Capture = resolved.quote ? { ...resolved, quote: { ...resolved.quote, opId: ulid() } } : resolved;
    const outcome = await saveCapture(capture, false);
    if (tabId !== undefined && (injected || (await injectCapture(tabId)))) await sendToast(tabId, outcome, capture);
  };

  /**
   * 页面提示上的按钮：snapshot 另存一份新快照，retry 再存一次；结果同样以页面提示显示。
   * 按提示带回的 requestId 重放那条提示对应的采集结果，不按标签页“最后一次保存”推断（codex review 第 6 轮）。
   * 找不到记录（超过保留条数、或浏览器重启）时明确说已过期，不改存当前页（codex review 第 7 轮）。
   */
  const rerunFromToast = async (tab: Tab, action: ToastActionMessage['action'], requestId: string | undefined) => {
    const capture = requestId !== undefined ? await toastRequests.get(requestId) : undefined;
    if (!capture) {
      const source = canonicalizeUrl(tab.url ?? '');
      await sendToast(tab.id, {
        state: 'failed',
        preview: { title: tab.title || source, site: siteFromUrl(source), source, medium: 'web' },
        error: { name: 'ExpiredRequest', message: t('error_expiredRequest') },
      });
      return;
    }
    const outcome = await saveCapture(capture, action === 'snapshot');
    await sendToast(tab.id, outcome, capture);
  };

  // 补写同一时间只跑一次；结果是本轮补存成功（saved / fallback）的条数，回给选项页。
  let flushing: Promise<number> | null = null;
  const flush = (): Promise<number> => {
    if (flushing) return flushing;
    let saved = 0;
    const d = deps();
    flushing = flushPending(d, (outcome) => {
      if (outcome.state === 'saved' || outcome.state === 'fallback') saved++;
      void afterOutcome(outcome, d.library);
    })
      .then(() => saved)
      .catch((err) => {
        console.error('[Alayo Get] 补写失败', err);
        return saved;
      })
      .finally(() => {
        flushing = null;
      });
    return flushing;
  };

  const logError = (what: string) => (err: unknown) => console.error(`[Alayo Get] ${what}`, err);

  // ---- 入口

  /**
   * 右键菜单：页面、链接、图片、视频、音频、选中文字（DESIGN.md §4）。先清空再建；
   * 安装、更新和每次浏览器启动都建一次，换了浏览器语言重启后菜单文字跟着换（ALAG-7）。
   */
  const installMenus = createMenuInstaller({
    removeAll: () => browser.contextMenus.removeAll(),
    create: (props, callback) => browser.contextMenus.create(props, callback),
    lastError: () => browser.runtime.lastError,
  });
  const createContextMenus = () => {
    installMenus().catch(logError('创建右键菜单失败'));
  };

  browser.runtime.onStartup.addListener(createContextMenus);

  browser.runtime.onInstalled.addListener((details) => {
    createContextMenus();
    if (details.reason === 'install') {
      browser.runtime.openOptionsPage().catch(logError('打开首次使用引导失败'));
    }
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'save-page') return;
    saveFromShortcutOrMenu(tab).catch(logError('快捷键保存失败'));
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const route = routeContextClick(info);
    if (route.action === 'page') {
      saveFromShortcutOrMenu(tab).catch(logError('右键保存页面失败'));
    } else if (route.action === 'quote') {
      saveQuote(info, tab).catch(logError('摘录失败'));
    } else if (route.action === 'link') {
      // Chrome 的 OnClickData 没有 linkText（Firefox 才有），取不到就用 URL。
      const linkText = 'linkText' in info && typeof info.linkText === 'string' ? info.linkText : '';
      saveLink(route.url, linkText, tab, route.stream).catch(logError('右键保存链接失败'));
    } else if (route.action !== 'ignore') {
      saveContextMedia(info, tab).catch(logError('右键保存媒体失败'));
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PANEL_PORT) {
      handlePanelPort(port as unknown as PortLike<PanelToSw, SwToPanel>, {
        savePage: async (tabId, onState) => savePage(await browser.tabs.get(tabId), onState),
        saveSnapshot: (capture, onState) => saveCapture(capture, true, onState),
        applyEdits: clips.editClip,
        findClip: clips.findClip,
      });
    } else if (port.name === TOAST_NOTE_PORT) {
      handleToastNotePort(port as unknown as PortLike<ToastNoteToSw, SwToToastNote>, { findClip: clips.findClip, applyEdits: clips.editClip });
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, sender: Browser.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    const type = (message as { type?: unknown } | null)?.type;
    if (type === 'library-granted') {
      // 补写结束后回复实际补存条数；返回 true 表示会异步调用 sendResponse。
      void flush().then((saved) => sendResponse({ saved }));
      return true;
    } else if (type === 'open-options') {
      const { section } = message as OpenOptionsMessage;
      if (section !== 'reauth' && section !== 'library') return;
      const url = browser.runtime.getURL(`/options.html#${section}` as '/options.html');
      browser.tabs.create({ url }).catch(logError('打开选项页失败'));
    } else if (type === 'toast-action') {
      const { action, requestId } = message as ToastActionMessage;
      const tab = sender.tab;
      if (!tab || (action !== 'snapshot' && action !== 'retry')) return;
      rerunFromToast(tab, action, typeof requestId === 'string' ? requestId : undefined).catch(logError('页面提示上的操作失败'));
    }
  });
});
