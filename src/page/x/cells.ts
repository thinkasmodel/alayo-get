// X 会话时间线的 cell 分类，以及单个帖子 article 解析成 XPost（只读 DOM 和 data-alayo-x，只在页面里运行）。
import { parseXStatusUrl, xStatusUrl } from './url';
import { tweetTextToMarkdown, visibleText, type TcoMap } from './text';

export interface XMediaPhoto {
  kind: 'photo';
  /** name= 改成 large */
  url: string;
}
export interface XMediaVideo {
  kind: 'video' | 'gif';
  poster: string;
  durationMs: number | null;
  href: string;
}
export type XMedia = XMediaPhoto | XMediaVideo;
export interface XQuote {
  name: string;
  handle: string;
  datetime: string;
  /** 原帖地址；读不到时为空串 */
  url: string;
  /** 已转义、链接已还原的 Markdown；换行保持原样的 `\n`，排版时由 markdown.ts 处理 */
  textMd: string;
  media: XMedia[];
  truncated: boolean;
}
export interface XCard {
  url: string;
  label: string;
}
export interface XPost {
  id: string;
  handle: string;
  name: string;
  datetime: string;
  url: string;
  /** 已转义、链接已还原的 Markdown；换行保持原样的 `\n`，排版时由 markdown.ts 处理 */
  textMd: string;
  truncated: boolean;
  media: XMedia[];
  quote: XQuote | null;
  card: XCard | null;
}

/** 主世界标注器写在 article 上的数据。 */
export interface AlayoX {
  id: string;
  quote: string;
  tco: Record<string, string>;
  videos: { type: string; durationMs: number | null }[];
}

export type XCell =
  | { kind: 'post'; id: string; handle: string; el: Element; article: Element }
  | { kind: 'separator'; el: Element }
  | { kind: 'button'; el: Element; button: Element }
  | { kind: 'skeleton'; el: Element };

export const TWEET = 'article[data-testid="tweet"]';
const USER_NAME = '[data-testid="User-Name"]';
const SHOW_MORE = '[data-testid="tweet-text-show-more-link"]';
const CELL = '[data-testid="cellInnerDiv"]';
const DURATION_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

/** 会话 cell，按文档顺序；嵌在别的 cell 里的不算。 */
export function listCells(root: ParentNode): Element[] {
  return [...root.querySelectorAll(CELL)].filter((c) => !c.parentElement?.closest(CELL));
}

/** 读 data-alayo-x；缺失或解析失败返回 null（页面里同名属性只当数据用）。 */
export function readAlayoX(article: Element): AlayoX | null {
  const raw = article.getAttribute('data-alayo-x');
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || typeof v.id !== 'string') return null;
    const tco: Record<string, string> = {};
    if (v.tco && typeof v.tco === 'object') {
      for (const [k, url] of Object.entries(v.tco as Record<string, unknown>)) {
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) tco[k] = url;
      }
    }
    const videos: AlayoX['videos'] = [];
    if (Array.isArray(v.videos)) {
      for (const item of v.videos as unknown[]) {
        const o = (item ?? {}) as Record<string, unknown>;
        videos.push({
          type: typeof o.type === 'string' ? o.type : 'video',
          durationMs: typeof o.durationMs === 'number' && Number.isFinite(o.durationMs) ? o.durationMs : null,
        });
      }
    }
    return { id: v.id, quote: typeof v.quote === 'string' ? v.quote : '', tco, videos };
  } catch {
    return null;
  }
}

/**
 * 这个 article 自己的元素：不在嵌套的 article 里，也不在长文 read view 里。
 * `except` 给出的子树（引用框）也排除。
 */
function own(article: Element, selector: string, except: Element | null = null): Element[] {
  return [...article.querySelectorAll(selector)].filter((el) => ownedBy(article, el) && !(except?.contains(el) ?? false));
}

/**
 * el 属于 article 自己：往上走到的第一个帖子 article 就是它，途中没经过长文 read view。
 * 手写父链遍历，不用带属性选择器的 closest（每一步采集都会对几十条帖子重新解析，这里是热点）。
 */
function ownedBy(article: Element, el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const testId = n.getAttribute('data-testid');
    if (testId === 'twitterArticleReadView') return false;
    if (testId === 'tweet' && n.tagName === 'ARTICLE') return n === article;
  }
  return false;
}

/**
 * article 自己的 data-testid 元素，按 testid 分组：一次 querySelectorAll 建好，排除嵌套 article 和 read view。
 * 采集时每一步都会重新解析几十条帖子，逐个用属性选择器查询是热点。
 */
class Owned {
  private readonly byTestId = new Map<string, Element[]>();
  constructor(article: Element) {
    for (const el of article.querySelectorAll('[data-testid]')) {
      if (!ownedBy(article, el)) continue;
      const id = el.getAttribute('data-testid') ?? '';
      const list = this.byTestId.get(id);
      if (list) list.push(el);
      else this.byTestId.set(id, [el]);
    }
  }

  /** 某个 testid 的元素，按文档顺序；`except` 子树（引用框）里的排除。 */
  get(testId: string, except: Element | null = null): Element[] {
    const list = this.byTestId.get(testId) ?? [];
    return except ? list.filter((el) => !except.contains(el)) : list;
  }
}

/** 引用框：article 内第二个 User-Name 所在的 `div[role=link]`。 */
export function quoteBox(article: Element, owned: Owned = new Owned(article)): Element | null {
  const names = owned.get('User-Name');
  const second = names[1];
  if (!second) return null;
  const box = second.closest('div[role="link"]');
  return box && article.contains(box) && box !== article ? box : null;
}

/** article 自己的帖子链接（time 的父级 `a`）→ handle 与 id。编辑过的帖子链接带 `/history`。 */
function statusOf(article: Element, box: Element | null): { handle: string; id: string; datetime: string } | null {
  for (const time of own(article, 'a[href*="/status/"] > time', box)) {
    const href = time.parentElement?.getAttribute('href') ?? '';
    const parsed = parseXStatusUrl(new URL(href, 'https://x.com').href);
    if (parsed) return { ...parsed, datetime: time.getAttribute('datetime') ?? '' };
  }
  return null;
}

/** 卡片 cell 分类：帖子、分隔、按钮、骨架（有 article 但没有 User-Name，还没渲染完）。 */
export function classifyCell(cell: Element): XCell {
  const article = cell.querySelector(TWEET);
  if (article) {
    const owned = new Owned(article);
    if (owned.get('User-Name').length === 0) return { kind: 'skeleton', el: cell };
    const status = statusOf(article, quoteBox(article, owned));
    // 有 User-Name 却没有帖子链接（如推广帖）：不是作者串里的帖子，按分隔处理。
    if (!status) return { kind: 'separator', el: cell };
    return { kind: 'post', id: status.id, handle: status.handle, el: cell, article };
  }
  const button = cell.querySelector('[role="button"]');
  if (button) return { kind: 'button', el: cell, button };
  return { kind: 'separator', el: cell };
}

/** User-Name 里的显示名（第一个 `div[dir=ltr]`）和 `@handle`。 */
function userNameOf(userName: Element | undefined): { name: string; handle: string } {
  if (!userName) return { name: '', handle: '' };
  const name = visibleText(userName.querySelector('div[dir="ltr"]') ?? userName)
    .replace(/\s+/g, ' ')
    .trim();
  let handle = '';
  const walker = userName.ownerDocument.createTreeWalker(userName, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const m = /^@([A-Za-z0-9_]{1,50})$/.exec((n.textContent ?? '').trim());
    if (m?.[1]) {
      handle = m[1];
      break;
    }
  }
  return { name, handle };
}

/** pbs.twimg.com 图片地址改成 name=large。 */
export function largeImage(src: string): string {
  try {
    const u = new URL(src);
    if (u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) u.searchParams.set('name', 'large');
    return u.href;
  } catch {
    return src;
  }
}

/** DOM 角标里的时长（`m:ss` 或 `h:mm:ss` 的叶子文本），在给定范围内找。 */
function domDurationMs(scope: Element): number | null {
  for (const el of scope.querySelectorAll('*')) {
    if (el.childElementCount !== 0) continue;
    const t = (el.textContent ?? '').trim();
    if (!DURATION_RE.test(t)) continue;
    const parts = t.split(':').map(Number);
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    return sec * 1000;
  }
  return null;
}

const PHOTO_BOX = '[data-testid="tweetPhoto"]';

/** 媒体容器：tweetPhoto，嵌在别的 tweetPhoto 里的不单独算。 */
function mediaBoxes(candidates: Element[]): Element[] {
  return candidates.filter((c) => {
    for (let n = c.parentElement; n; n = n.parentElement) if (n.getAttribute('data-testid') === 'tweetPhoto') return false;
    return true;
  });
}

/**
 * 媒体按 tweetPhoto 容器的文档顺序逐个判断，同一个容器只算一个媒体：
 * 有 `video[poster]` 或折叠的视频预览（previewInterstitial）算视频，否则有 pbs.twimg.com/media 图片算图片。
 * 图片和视频一起编号（从 1 开始），视频链接写 `{statusUrl}/video/{n}`；不知道帖子地址时（读不到原帖的引用）链接到 fallbackHref。
 * 视频时长：播放器按顺序取 data-alayo-x.videos 的第 k 个，没有时读 DOM 角标；
 * 折叠预览先读 DOM 角标，读不到再取 videos 的第 k 个。
 */
function mediaOf(boxes: Element[], statusUrl: string, videos: AlayoX['videos'] | null, fallbackHref = statusUrl): XMedia[] {
  const media: XMedia[] = [];
  let k = 0;
  for (const box of boxes) {
    const video = box.querySelector('video[poster]');
    const preview = video ? null : box.querySelector('[data-testid="previewInterstitial"]');
    if (video || preview) {
      const info = videos?.[k];
      k++;
      const poster = video
        ? (video.getAttribute('poster') ?? '')
        : (preview?.querySelector('img[src^="https://pbs.twimg.com/"]')?.getAttribute('src') ?? '');
      const gif = info ? info.type === 'animated_gif' : poster.includes('/tweet_video_thumb/');
      let durationMs: number | null = null;
      if (!gif) {
        durationMs = video
          ? (info?.durationMs ?? domDurationMs(video.closest('[data-testid="videoPlayer"]') ?? box))
          : (domDurationMs(preview ?? box) ?? info?.durationMs ?? null);
      }
      const href = statusUrl ? `${statusUrl}/video/${media.length + 1}` : fallbackHref;
      media.push({ kind: gif ? 'gif' : 'video', poster, durationMs, href });
      continue;
    }
    const img = box.querySelector('img[src^="https://pbs.twimg.com/media/"]');
    if (img) media.push({ kind: 'photo', url: largeImage(img.getAttribute('src') ?? '') });
  }
  return media;
}

/**
 * 链接卡片：t.co 经映射还原；label 取 aria-label（“域名 标题”）里的标题。
 * 播放器类卡片（如 YouTube）没有链接元素，地址取映射里正文没用到的第一个 t.co；读不到地址就不算卡片。
 */
function cardOf(owned: Owned, box: Element | null, tco: TcoMap, text: Element | undefined): XCard | null {
  const wrapper = owned.get('card.wrapper', box)[0];
  if (!wrapper) return null;
  const a = wrapper.querySelector('a[href]');
  const href = a?.getAttribute('href') ?? '';
  const used = new Set(text ? [...text.querySelectorAll('a[href]')].map((l) => l.getAttribute('href')) : []);
  const url = href ? (tco[href] ?? new URL(href, 'https://x.com/').href) : (Object.entries(tco).find(([k]) => !used.has(k))?.[1] ?? '');
  if (!url) return null;
  const aria = (a?.getAttribute('aria-label') ?? '').trim();
  const m = /^(\S+\.\S+)\s+(.+)$/.exec(aria);
  // 小卡片的说明区依次是域名、标题、摘要
  const detail = [...wrapper.querySelectorAll('[data-testid$=".detail"] div[dir="auto"]')]
    .map((d) => visibleText(d).replace(/\s+/g, ' ').trim())
    .filter((t) => t !== '');
  const label = (m?.[2] ?? '').trim() || detail[1] || detail[0] || aria || url;
  return { url, label };
}

/** 引用框里的帖子；原帖地址只在 data-alayo-x.quote 里，twitter.com 归一成 x.com。 */
function quoteOf(box: Element, article: Element, ax: AlayoX | null, tco: TcoMap, outerUrl: string): XQuote {
  const inBox = (selector: string) => [...box.querySelectorAll(selector)].filter((el) => el.closest(TWEET) === article);
  const { name, handle } = userNameOf(inBox(USER_NAME)[0]);
  const parsed = ax?.quote ? parseXStatusUrl(ax.quote) : null;
  const url = parsed ? xStatusUrl(parsed.handle, parsed.id) : '';
  const text = inBox('[data-testid="tweetText"]')[0];
  return {
    name: name || handle,
    handle,
    datetime: inBox('time[datetime]')[0]?.getAttribute('datetime') ?? '',
    url,
    textMd: text ? tweetTextToMarkdown(text, tco) : '',
    // 引用帖的视频时长不在标注数据里（标注器只记外层帖子的视频），读 DOM 角标
    media: mediaOf(mediaBoxes(inBox(PHOTO_BOX)), url, null, outerUrl),
    truncated: inBox(SHOW_MORE).length > 0,
  };
}

/** 单个帖子 article 解析成 XPost；读不到帖子链接（骨架、推广帖）返回 null。 */
export function parsePost(article: Element): XPost | null {
  const owned = new Owned(article);
  const box = quoteBox(article, owned);
  const status = statusOf(article, box);
  if (!status) return null;
  const ax = readAlayoX(article);
  const tco: TcoMap = ax?.tco ?? {};
  const url = xStatusUrl(status.handle, status.id);
  const { name } = userNameOf(owned.get('User-Name', box)[0]);
  const text = owned.get('tweetText', box)[0];
  return {
    id: status.id,
    handle: status.handle,
    name: name || status.handle,
    datetime: status.datetime,
    url,
    textMd: text ? tweetTextToMarkdown(text, tco) : '',
    truncated: owned.get('tweet-text-show-more-link', box).length > 0,
    media: mediaOf(mediaBoxes(owned.get('tweetPhoto', box)), url, ax?.videos ?? null),
    quote: box ? quoteOf(box, article, ax, tco, url) : null,
    card: cardOf(owned, box, tco, text),
  };
}
