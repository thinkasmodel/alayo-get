// 保存入口的路由（ALAG-4 brief §3）：service worker 按右键位置或标签页决定剪藏形态。纯函数，node 环境测试。
import { escapeMarkdownText } from '@/core/quote';
import { fileNameFromUrl, mediaKindFromContentType, mediaKindFromUrl } from '@/core/media';
import { parseStreamUrl, type ParsedStream } from '@/core/stream';
import { parseXStatusUrl } from '@/page/x/url';
import { t, type MessageKey } from '@/shared/i18n';
import type { QuoteCaptureResponse } from '@/shared/messages';
import type { Capture, MediaKind, Preview, QuoteCaptureInfo } from '@/shared/types';

export const MENU_SAVE_PAGE = 'save-page';
export const MENU_SAVE_LINK = 'save-link';
export const MENU_SAVE_IMAGE = 'save-image';
export const MENU_SAVE_VIDEO = 'save-video';
export const MENU_SAVE_AUDIO = 'save-audio';
export const MENU_SAVE_QUOTE = 'save-quote';

export type MenuContext = 'page' | 'link' | 'image' | 'video' | 'audio' | 'selection';

/** 一项右键菜单；title 是 getter，每次读取时按当前语言取文案（不在模块加载时取，ALAG-7）。 */
function menu(id: string, key: MessageKey, context: MenuContext): { readonly id: string; readonly title: string; readonly context: MenuContext } {
  return {
    id,
    get title() {
      return t(key);
    },
    context,
  };
}

/** 右键菜单（DESIGN.md §4）：每一项都带“Alayo Get”。 */
export const CONTEXT_MENUS: ReadonlyArray<{ readonly id: string; readonly title: string; readonly context: MenuContext }> = [
  menu(MENU_SAVE_PAGE, 'menu_savePage', 'page'),
  menu(MENU_SAVE_LINK, 'menu_saveLink', 'link'),
  menu(MENU_SAVE_IMAGE, 'menu_saveImage', 'image'),
  menu(MENU_SAVE_VIDEO, 'menu_saveVideo', 'video'),
  menu(MENU_SAVE_AUDIO, 'menu_saveAudio', 'audio'),
  menu(MENU_SAVE_QUOTE, 'menu_saveQuote', 'selection'),
];

/** 时间线上右键视频、认不出是哪条帖子（XVideoNeedsPost）。message 按当前语言取。 */
export function xVideoNeedsPost(): { name: 'XVideoNeedsPost'; message: string } {
  return { name: 'XVideoNeedsPost', message: t('error_xVideoTimeline') };
}

/** 右键图片没有可下载的地址（NoDownloadableUrl）。message 按当前语言取。 */
export function noDownloadableUrl(): { name: 'NoDownloadableUrl'; message: string } {
  return { name: 'NoDownloadableUrl', message: t('error_noDownloadableUrl') };
}

/** 右键菜单点击里路由用到的字段（OnClickData 的子集）。 */
export interface ContextClick {
  menuItemId: string | number;
  srcUrl?: string;
  pageUrl?: string;
  frameUrl?: string;
  linkUrl?: string;
  /** 摘录（ALAG-4）：右键所在的 frame（0 为顶层）与选中的纯文本。 */
  frameId?: number;
  selectionText?: string;
}

export type ContextRoute =
  /** 保存当前页（与工具栏、快捷键同一流程）。 */
  | { action: 'page' }
  /** 右键链接：平台链接 → 流媒体剪藏（stream 非空），否则书签剪藏。 */
  | { action: 'link'; url: string; stream: ParsedStream | null }
  /** 在平台视频页（页面或 frame）上右键视频、音频：按该平台存流媒体剪藏，和在页面上保存一样。from 指命中的是页面还是 frame。 */
  | { action: 'stream'; parsed: ParsedStream; from: 'page' | 'frame' }
  /** X 帖子页（或视频专链）上右键视频：按该帖存 X 视频流媒体剪藏（页面里采集）。 */
  | { action: 'x-video'; statusId: string }
  /** 有可下载地址的图片、视频、音频：媒体剪藏（音视频先探测大小，超过上限转直链流媒体剪藏）。 */
  | { action: 'media'; kind: MediaKind; url: string }
  /** blob: 视频、音频：存当前页的流媒体剪藏（platform other）。 */
  | { action: 'blob-stream'; medium: 'video' | 'audio' }
  /** 选中文字：摘录剪藏（ALAG-4）。 */
  | { action: 'quote' }
  /** 不写任何文件，直接返回 failed。 */
  | { action: 'fail'; name: string; message: string }
  /** 不认识的菜单项。 */
  | { action: 'ignore' };

const X_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);

function isXHost(url: string): boolean {
  try {
    return X_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

const KIND_OF_MENU: Record<string, MediaKind> = { [MENU_SAVE_IMAGE]: 'image', [MENU_SAVE_VIDEO]: 'video', [MENU_SAVE_AUDIO]: 'audio' };

/**
 * 右键菜单的路由（brief §3 第 1、3 条），第一个命中的生效：
 * 视频、音频在平台视频页上 → 该平台的流媒体剪藏；x.com 上的视频 → 帖子页按该帖存，否则 XVideoNeedsPost；
 * http(s) 或 data: 地址 → 媒体剪藏；blob: → 图片失败（NoDownloadableUrl），音视频存当前页的直链流媒体剪藏。
 */
export function routeContextClick(info: ContextClick): ContextRoute {
  const id = String(info.menuItemId);
  if (id === MENU_SAVE_PAGE) return { action: 'page' };
  if (id === MENU_SAVE_QUOTE) return { action: 'quote' };
  if (id === MENU_SAVE_LINK) {
    if (!info.linkUrl) return { action: 'ignore' };
    return { action: 'link', url: info.linkUrl, stream: parseStreamUrl(info.linkUrl) };
  }
  const kind = KIND_OF_MENU[id];
  if (!kind) return { action: 'ignore' };
  const pageUrl = info.pageUrl ?? '';
  const src = info.srcUrl ?? '';

  if (kind !== 'image') {
    const onPage = parseStreamUrl(pageUrl);
    const platform = onPage ?? parseStreamUrl(info.frameUrl ?? '');
    if (platform?.platform === 'x' && onPage) return { action: 'x-video', statusId: platform.videoId };
    if (platform && platform.platform !== 'x') return { action: 'stream', parsed: platform, from: onPage ? 'page' : 'frame' };
    if (isXHost(pageUrl)) {
      // 时间线上 Chrome 不告诉我们点的是哪条帖子
      const post = parseXStatusUrl(pageUrl);
      return post ? { action: 'x-video', statusId: post.id } : { action: 'fail', ...xVideoNeedsPost() };
    }
  }

  if (/^(https?:|data:)/i.test(src)) return { action: 'media', kind, url: src };
  if (kind === 'image') return { action: 'fail', ...noDownloadableUrl() };
  return { action: 'blob-stream', medium: kind === 'audio' ? 'audio' : 'video' };
}

export type TabRoute = { action: 'stream'; parsed: ParsedStream } | { action: 'media'; kind: MediaKind } | { action: 'page' };

/**
 * 工具栏、快捷键、右键页面空白处（brief §3 第 2 条）：标签页地址是平台视频（含 X 视频专链）→ 流媒体剪藏；
 * 给了 contentType 且不是 HTML 时按它判类别（PDF、媒体文件本身 → 媒体剪藏）；其余照旧。
 * X 帖子页本身（没有 `/video/n`）不在平台里，仍走 X 文章剪藏。
 */
export function classifyTab(url: string, contentType?: string | null): TabRoute {
  const parsed = parseStreamUrl(url);
  if (parsed) return { action: 'stream', parsed };
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (type !== '' && type !== 'text/html' && type !== 'application/xhtml+xml') {
    const kind = mediaKindFromContentType(type);
    if (kind) return { action: 'media', kind };
  }
  return { action: 'page' };
}

/** 保存中预览卡的图标（brief §3a）：按标签页地址预判，判不出用 web；采集完成后由 previewOf 给出准确值。 */
export function predictPreviewMedium(url: string): Preview['medium'] {
  if (parseStreamUrl(url)) return 'stream';
  return mediaKindFromUrl(url) ?? 'web';
}

/** 媒体剪藏的 Capture：url 是所在网页（出处），文件地址在 media.url。 */
export function mediaCapture(pageUrl: string, pageTitle: string, kind: MediaKind, mediaUrl: string): Capture {
  return {
    url: pageUrl || mediaUrl,
    title: pageTitle,
    site: '',
    author: '',
    published: '',
    description: '',
    coverUrl: '',
    markdown: null,
    textLength: 0,
    kind: 'media',
    media: { kind, url: mediaUrl, fileName: fileNameFromUrl(mediaUrl) },
  };
}

/** 摘录剪藏的 Capture（ALAG-4）：url 是页面地址，title 是页面标题。 */
export function quoteCapture(pageUrl: string, pageTitle: string, quote: QuoteCaptureInfo): Capture {
  return {
    url: pageUrl,
    title: pageTitle,
    site: '',
    author: '',
    published: '',
    description: '',
    coverUrl: '',
    markdown: null,
    textLength: 0,
    kind: 'quote',
    quote,
  };
}

/**
 * 摘录的采集结果（ALAG-4 brief B §1）：页面回了选区就用它；取不到选区、不能注入、页面没回应、选区在子 frame 里时
 * 用右键菜单给的选中文字作纯文本正文，片段为 null，出处用 info.pageUrl，标题用标签页标题。
 */
export function resolveQuoteCapture(
  page: QuoteCaptureResponse | null,
  info: Pick<ContextClick, 'pageUrl' | 'selectionText'>,
  tab: { url?: string; title?: string } | undefined,
  now: Date,
): Capture {
  if (page?.quote) return quoteCapture(page.url, page.title, page.quote);
  return quoteCapture(info.pageUrl ?? tab?.url ?? '', tab?.title ?? '', {
    // 选中文字是纯文本，转义后再当 Markdown 写进摘录文件
    markdown: escapeMarkdownText((info.selectionText ?? '').trim()),
    fragmentUrl: null,
    selectedAt: now.toISOString(),
  });
}
