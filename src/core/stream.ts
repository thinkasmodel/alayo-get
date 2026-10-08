// 流媒体剪藏的纯函数（ALAG-4）：平台 URL 识别、平台显示名、时长格式、服务端 HTML 的元数据解析。
// service worker 里没有 DOM（ADR-0004），HTML 一律按纯文本解析；不调用任何平台 API。
import { normalizePublished } from './frontmatter';
import { MEDIA_MAX_BYTES, mediaKindFromContentType } from './media';
import { decodeEntities } from './meta';
import { t, type MessageKey } from '@/shared/i18n';
import type { MediaKind, Platform } from '@/shared/types';

/** 按 URL 识别出的平台视频（直链 other 不在此列）。 */
export interface ParsedStream {
  platform: Exclude<Platform, 'other'>;
  /** 平台内 ID；b23.tv 短链在跟随跳转前为空串。 */
  videoId: string;
  /** 平台视频页的规范地址（已保存记录按它规范化后的值去重）。 */
  canonical: string;
  /** 嵌入地址；推不出时为空串。 */
  embed: string;
}

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const BILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com']);
const X_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
const BAIDU_HOSTS = new Set(['pan.baidu.com', 'yun.baidu.com']);
const HOSTS_115 = new Set(['115.com', 'www.115.com', '115cdn.com', 'www.115cdn.com', 'anxia.com', 'www.anxia.com']);
const QUARK_HOSTS = new Set(['pan.quark.cn']);

/** 有提取码时保留为 `?name=value`，没有为空串。 */
function codeQuery(u: URL, name: string): string {
  const value = u.searchParams.get(name);
  return value ? `?${name}=${encodeURIComponent(value)}` : '';
}

function youtube(u: URL, host: string, parts: string[]): ParsedStream | null {
  let id: string | null = null;
  if (host === 'youtu.be') id = parts[0] ?? null;
  else if (YT_HOSTS.has(host)) {
    if (parts[0] === 'watch' && parts.length === 1) id = u.searchParams.get('v');
    else if ((parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed') && parts.length >= 2) id = parts[1] ?? null;
  }
  if (!id || !YT_ID.test(id)) return null;
  return {
    platform: 'youtube',
    videoId: id,
    canonical: `https://www.youtube.com/watch?v=${id}`,
    embed: `https://www.youtube.com/embed/${id}`,
  };
}

function bilibili(u: URL, host: string, parts: string[], raw: string): ParsedStream | null {
  if (host === 'b23.tv') {
    if (parts.length === 0) return null;
    // 短链：跟随跳转后的地址再解析一次（抓取时用 res.url）
    return { platform: 'bilibili', videoId: '', canonical: raw, embed: '' };
  }
  if (!BILI_HOSTS.has(host)) return null;
  if (parts[0] === 'video' && parts[1]) {
    const id = parts[1];
    const bv = /^BV[0-9A-Za-z]{10}$/.test(id);
    const av = /^av(\d+)$/i.exec(id);
    if (!bv && !av) return null;
    const videoId = bv ? id : `av${av?.[1] ?? ''}`;
    const p = Number(u.searchParams.get('p'));
    const page = Number.isInteger(p) && p > 1 ? p : 1;
    const embedBase = bv ? `https://player.bilibili.com/player.html?bvid=${id}` : `https://player.bilibili.com/player.html?aid=${av?.[1] ?? ''}`;
    return {
      platform: 'bilibili',
      videoId,
      canonical: `https://www.bilibili.com/video/${videoId}${page > 1 ? `?p=${page}` : ''}`,
      embed: page > 1 ? `${embedBase}&page=${page}` : embedBase,
    };
  }
  if (parts[0] === 'bangumi' && parts[1] === 'play' && parts[2] && /^(ep|ss)\d+$/.test(parts[2])) {
    return { platform: 'bilibili', videoId: parts[2], canonical: `https://www.bilibili.com/bangumi/play/${parts[2]}`, embed: '' };
  }
  return null;
}

function xVideo(host: string, parts: string[]): ParsedStream | null {
  if (!X_HOSTS.has(host)) return null;
  const [handle, status, id, video, n] = parts;
  if (parts.length !== 5 || status !== 'status' || video !== 'video') return null;
  if (!handle || !/^[A-Za-z0-9_]{1,50}$/.test(handle) || !id || !/^\d{1,25}$/.test(id) || !n || !/^\d{1,2}$/.test(n)) return null;
  return { platform: 'x', videoId: id, canonical: `https://x.com/${handle}/status/${id}/video/${n}`, embed: '' };
}

function netdisk(u: URL, host: string, parts: string[]): ParsedStream | null {
  if (BAIDU_HOSTS.has(host)) {
    let surl: string | null = null;
    if (parts[0] === 's' && parts.length === 2) surl = /^1([\w-]+)$/.exec(parts[1] ?? '')?.[1] ?? null;
    else if (host === 'pan.baidu.com' && parts[0] === 'share' && parts[1] === 'init' && parts.length === 2) surl = u.searchParams.get('surl');
    if (!surl || !/^[\w-]+$/.test(surl)) return null;
    return { platform: 'baidupan', videoId: surl, canonical: `https://pan.baidu.com/s/1${surl}${codeQuery(u, 'pwd')}`, embed: '' };
  }
  if (HOSTS_115.has(host)) {
    const code = parts[0] === 's' && parts.length === 2 ? parts[1] : undefined;
    if (!code || !/^[\w-]+$/.test(code)) return null;
    return { platform: '115', videoId: code, canonical: `https://115cdn.com/s/${code}${codeQuery(u, 'password')}`, embed: '' };
  }
  if (QUARK_HOSTS.has(host)) {
    const id = parts[0] === 's' && parts.length === 2 ? parts[1] : undefined;
    if (!id || !/^[\w-]+$/.test(id)) return null;
    return { platform: 'quark', videoId: id, canonical: `https://pan.quark.cn/s/${id}${codeQuery(u, 'pwd')}`, embed: '' };
  }
  return null;
}

/**
 * 平台 URL 识别：YouTube、B 站、X 视频专链、百度网盘、115、夸克。其余（含 X 帖子页本身、频道页、搜索页）返回 null。
 */
export function parseStreamUrl(url: string): ParsedStream | null {
  const raw = url.trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter((p) => p !== '');
  return youtube(u, host, parts) ?? bilibili(u, host, parts, raw) ?? xVideo(host, parts) ?? netdisk(u, host, parts);
}

const LABELS: Record<Exclude<Platform, 'other'>, MessageKey> = {
  youtube: 'platform_youtube',
  bilibili: 'platform_bilibili',
  x: 'platform_x',
  baidupan: 'platform_baidupan',
  '115': 'platform_115',
  quark: 'platform_quark',
};

/** 平台显示名；直链为“视频直链”或“音频直链”。 */
export function platformLabel(platform: Platform, medium: 'video' | 'audio' = 'video'): string {
  if (platform === 'other') return t(medium === 'audio' ? 'platform_directAudio' : 'platform_directVideo');
  return t(LABELS[platform]);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 时长（秒）：不到 1 小时写 m:ss，否则 h:mm:ss（同 ALAG-3：`0:47`、`3:33`、`1:02:03`）。 */
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/**
 * 直链音视频（platform other）的判定：视频、音频在拿不到大小或超过 100MB 时存流媒体剪藏，否则存媒体剪藏。
 * 图片、PDF 永远是媒体剪藏（超过上限另由下载时退回书签剪藏）。content-type 判不出类别时用 fallbackKind。
 */
export function classifyDirect(contentType: string | null, bytes: number | null, fallbackKind?: MediaKind): 'media' | 'stream' {
  const kind = mediaKindFromContentType(contentType) ?? fallbackKind ?? null;
  if (kind !== 'video' && kind !== 'audio') return 'media';
  return bytes === null || !Number.isFinite(bytes) || bytes > MEDIA_MAX_BYTES ? 'stream' : 'media';
}

// ---- 服务端 HTML 解析

/**
 * 从 `start`（指向 `{`）截出配对的 JSON 对象文本并解析；字符串里的括号与转义不计。截不出或解析失败返回 null。
 */
export function extractJsonObject(text: string, start: number): unknown {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 找到 `name = {` 赋值语句，截出右边的对象。 */
function assignedObject(html: string, name: string): Record<string, unknown> | null {
  const re = new RegExp(`${name.replace(/[.$]/g, '\\$&')}\\s*=\\s*\\{`, 'g');
  for (const m of html.matchAll(re)) {
    const value = extractJsonObject(html, (m.index ?? 0) + m[0].length - 1);
    if (value && typeof value === 'object') return value as Record<string, unknown>;
  }
  return null;
}

/** 按 `a.b.c` 取嵌套字段。 */
function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** `<meta property|name="key" content="…">`，同名取第一个；键小写。 */
function metaTags(html: string): Map<string, string> {
  const metas = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of m[0].matchAll(/([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      const k = (a[1] ?? '').toLowerCase();
      if (!attrs.has(k)) attrs.set(k, a[2] ?? a[3] ?? a[4] ?? '');
    }
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    const content = attrs.get('content');
    if (key === '' || content === undefined || metas.has(key)) continue;
    metas.set(key, decodeEntities(content).replace(/\s+/g, ' ').trim());
  }
  return metas;
}

function htmlTitle(html: string): string {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1] ?? '').replace(/\s+/g, ' ').trim() : '';
}

function absolute(url: string, base: string): string {
  if (url === '') return '';
  try {
    return new URL(url, base).href;
  } catch {
    return '';
  }
}

/** 视频页里取到的元数据；取不到的项为空串或 null。 */
export interface StreamMeta {
  title: string;
  author: string;
  /** 秒 */
  duration: number | null;
  /** 简介全文 */
  description: string;
  /** ISO 时间（能解析时） */
  published: string;
  /** 封面地址（https） */
  cover: string;
  /** 嵌入地址（og:video） */
  embed: string;
  /**
   * 页面自称的视频 ID（用来核对抓到的是不是要存的那个视频）：YouTube 为 videoDetails.videoId；
   * B 站有 videoData 时为 bvid 与 `av<aid>`，没有时（番剧页）为 og:url、canonical 里的 `ep<数字>`、`ss<数字>`。取不到为空数组。
   */
  videoIds: string[];
}

const BILI_TITLE_SUFFIX = /_哔哩哔哩_bilibili$/;

function parseYouTube(html: string, pageUrl: string): StreamMeta {
  const metas = metaTags(html);
  const player = assignedObject(html, 'ytInitialPlayerResponse');
  const details = pick(player, 'videoDetails');
  const thumbs = pick(details, 'thumbnail.thumbnails');
  const lastThumb = Array.isArray(thumbs) ? str(pick(thumbs[thumbs.length - 1], 'url')) : '';
  return {
    title: str(pick(details, 'title')) || metas.get('og:title') || htmlTitle(html).replace(/ - YouTube$/, ''),
    author: str(pick(details, 'author')) || str(pick(player, 'microformat.playerMicroformatRenderer.ownerChannelName')),
    duration: num(pick(details, 'lengthSeconds')),
    description: str(pick(details, 'shortDescription')) || (metas.get('og:description') ?? ''),
    published: normalizePublished(
      str(pick(player, 'microformat.playerMicroformatRenderer.publishDate')) || str(pick(player, 'microformat.playerMicroformatRenderer.uploadDate')),
    ),
    cover: absolute(metas.get('og:image') || lastThumb, pageUrl),
    embed: absolute(metas.get('og:video:url') || metas.get('og:video') || '', pageUrl),
    videoIds: [str(pick(details, 'videoId'))].filter((id) => id !== ''),
  };
}

/** 页面 `<link rel="canonical">` 的 href；没有为空串。 */
function canonicalHref(html: string): string {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?canonical\b/i.test(m[0])) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(m[0]);
    return decodeEntities(href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim();
  }
  return '';
}

function biliVideoIds(video: unknown, metas: Map<string, string>, html: string): string[] {
  if (video && typeof video === 'object') {
    const aid = num(pick(video, 'aid'));
    return [str(pick(video, 'bvid')), aid !== null ? `av${aid}` : ''].filter((id) => id !== '');
  }
  // 番剧 ep/ss 页没有 videoData：看 og:url、canonical 里的 ep/ss 号
  const urls = [metas.get('og:url') ?? '', canonicalHref(html)];
  return urls.flatMap((u) => [...u.matchAll(/(?:^|\/)((?:ep|ss)\d+)(?=[/?#]|$)/g)].map((m) => m[1] ?? '')).filter((id) => id !== '');
}

function parseBilibili(html: string, pageUrl: string): StreamMeta {
  const metas = metaTags(html);
  const state = assignedObject(html, 'window.__INITIAL_STATE__') ?? assignedObject(html, '__INITIAL_STATE__');
  const video = pick(state, 'videoData');
  const pubdate = num(pick(video, 'pubdate'));
  const pic = str(pick(video, 'pic')).replace(/^http:\/\//i, 'https://').replace(/^\/\//, 'https://');
  const ogTitle = (metas.get('og:title') || htmlTitle(html)).replace(BILI_TITLE_SUFFIX, '');
  return {
    title: str(pick(video, 'title')) || ogTitle,
    author: str(pick(video, 'owner.name')) || (metas.get('author') ?? ''),
    duration: num(pick(video, 'duration')) ?? num(metas.get('video:duration')),
    // og:description 混有播放量和相关视频，不能当简介；只取 videoData.desc
    description: str(pick(video, 'desc')),
    published: pubdate !== null ? new Date(pubdate * 1000).toISOString() : normalizePublished(metas.get('video:release_date') ?? ''),
    cover: pic || absolute(metas.get('og:image') ?? '', pageUrl),
    embed: absolute(metas.get('og:video') || metas.get('og:video:url') || '', pageUrl),
    videoIds: biliVideoIds(video, metas, html),
  };
}

/** 解析 YouTube、B 站视频页的服务端 HTML。 */
export function parseStreamHtml(platform: 'youtube' | 'bilibili', html: string, pageUrl: string): StreamMeta {
  const meta = platform === 'youtube' ? parseYouTube(html, pageUrl) : parseBilibili(html, pageUrl);
  if (meta.videoIds.length > 0) return meta;
  // 平台 JSON 取不到视频 ID（只剩 og 元数据）：用 og:url、canonical 里同平台的视频 ID 做核对
  const urls = [metaTags(html).get('og:url') ?? '', canonicalHref(html)];
  const ids = urls.flatMap((u) => {
    const parsed = parseStreamUrl(u);
    return parsed && parsed.platform === platform && parsed.videoId !== '' ? [parsed.videoId] : [];
  });
  return { ...meta, videoIds: [...new Set(ids)] };
}
