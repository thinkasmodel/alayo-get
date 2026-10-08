// 媒体剪藏的纯函数（ALAG-4）：类别判定、原文件名、媒体文件名、`.meta/<id>.json` 组装、大小格式、data: 地址。
import { canonicalizeUrl } from './canonical';
import { clipBaseName } from './filename';
import { extFromImageMime } from './images';
import { t, type MessageKey } from '@/shared/i18n';
import type { MediaKind } from '@/shared/types';

/** 媒体剪藏的大小上限：音视频超过它存直链流媒体剪藏，图片和 PDF 超过它退回书签剪藏。 */
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;

/**
 * data: 地址的长度上限：暂存队列与页面提示的重放记录都放在 chrome.storage.session（配额 10MB），
 * 超过它的 data: 图片不进这两处。
 */
export const DATA_URL_SESSION_LIMIT = 1024 * 1024;

const MEDIA_KINDS: ReadonlySet<string> = new Set(['image', 'audio', 'video', 'pdf']);

export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && MEDIA_KINDS.has(value);
}

/** content-type 的主体部分，小写、去参数。 */
export function mimeOf(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/** 按 content-type 判类别；不是图片、音频、视频、PDF 返回 null。 */
export function mediaKindFromContentType(contentType: string | null | undefined): MediaKind | null {
  const mime = mimeOf(contentType);
  if (mime === 'application/pdf' || mime === 'application/x-pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

const EXT_KIND: Record<string, MediaKind> = {
  pdf: 'pdf',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  avif: 'image',
  bmp: 'image',
  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  flac: 'audio',
  aac: 'audio',
  opus: 'audio',
  mp4: 'video',
  m4v: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  ogv: 'video',
};

/**
 * 文档本身是媒体文件（图片、音频、视频、PDF）：采集脚本据此跳过正文抽取，交给后台按媒体剪藏处理。
 * text/plain、XML 等其他非 HTML 文档不算，照旧走通用抽取。
 */
export function isMediaDocument(contentType: string | null | undefined): boolean {
  return mediaKindFromContentType(contentType) !== null;
}

/** 按 URL 路径的扩展名判类别（保存中预判图标用）；判不出返回 null。 */
export function mediaKindFromUrl(url: string): MediaKind | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const ext = /\.([a-z0-9]{1,5})$/i.exec(pathname)?.[1]?.toLowerCase();
  return ext ? (EXT_KIND[ext] ?? null) : null;
}

const KIND_LABEL: Record<MediaKind, MessageKey> = { image: 'kind_image', audio: 'kind_audio', video: 'kind_video', pdf: 'kind_pdf' };
const KIND_LABEL_INLINE: Record<MediaKind, MessageKey> = { image: 'kindInline_image', audio: 'kindInline_audio', video: 'kindInline_video', pdf: 'kindInline_pdf' };

/** 类别的显示名：图片、音频、视频、PDF。inline 为句中用的写法（英文小写：image、audio、video、PDF），缺省为独立或句首用的写法。 */
export function mediaKindLabel(kind: MediaKind, inline = false): string {
  return t((inline ? KIND_LABEL_INLINE : KIND_LABEL)[kind]);
}

/** URL 路径的最后一段（decodeURIComponent，失败保留原样）；data: 和解析不了的地址为空串。 */
export function fileNameFromUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  const last = u.pathname.split('/').filter((p) => p !== '').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** `Content-Disposition` 里的文件名：`filename*=UTF-8''…` 优先，其次 `filename="…"`；没有返回空串。 */
export function fileNameFromContentDisposition(header: string | null | undefined): string {
  if (!header) return '';
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star?.[2]) {
    const raw = star[2].trim().replace(/^"|"$/g, '');
    try {
      return baseOf(decodeURIComponent(raw));
    } catch {
      return baseOf(raw);
    }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(header);
  const value = plain?.[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : (plain?.[2]?.trim() ?? '');
  return baseOf(value);
}

/** 去掉路径部分，只留文件名。 */
function baseOf(name: string): string {
  return name.split(/[/\\]/).pop()?.trim() ?? '';
}

/**
 * 文件名拆成主干与扩展名（不含点，小写）；没有扩展名时 ext 为空串。点开头的名字不算扩展名。
 * 扩展名 1～5 位且至少有一个字母：`1706.03762` 这类编号不算扩展名。
 */
export function splitExt(name: string): { stem: string; ext: string } {
  const m = /^(.+)\.([A-Za-z0-9]{1,5})$/.exec(name);
  if (!m?.[1] || !m[2] || !/[A-Za-z]/.test(m[2])) return { stem: name, ext: '' };
  return { stem: m[1], ext: m[2].toLowerCase() };
}

/** extFromImageMime 不认识的媒体类型。 */
const MEDIA_TYPE_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/ogg': 'ogv',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

/**
 * 媒体剪藏可写出的扩展名（ALAG-17）。svg 在集合里只为 MIME 明确是 image/svg+xml 时可用；
 * 按文件名后缀回退时 resolveMediaExt 显式排除 svg（主动内容，只有服务器明确声明才信）。
 */
export const MEDIA_SAFE_EXTS: ReadonlySet<string> = new Set([
  'jpg',
  'png',
  'gif',
  'webp',
  'avif',
  'bmp',
  'svg',
  'mp3',
  'm4a',
  'aac',
  'wav',
  'ogg',
  'flac',
  'webm',
  'mp4',
  'mov',
  'ogv',
  'pdf',
]);

/**
 * 媒体文件的扩展名（ALAG-17）：由 content-type 推出；推得出时服务器文件名和 URL 都不参与。
 * 推不出（空、application/octet-stream、未映射的类型）时取服务器文件名的后缀，没有再取 URL 文件名的后缀，
 * 只接受 MEDIA_SAFE_EXTS 里的（svg 除外）；其余一律 `bin`。
 */
export function resolveMediaExt(contentType: string | null | undefined, serverFileName: string, url: string): string {
  const mime = mimeOf(contentType);
  const mapped = MEDIA_TYPE_EXT[mime] ?? extFromImageMime(mime);
  if (mapped) return mapped;
  const raw = splitExt(serverFileName).ext || splitExt(fileNameFromUrl(url)).ext;
  const candidate = raw === 'jpeg' ? 'jpg' : raw;
  if (candidate !== 'svg' && MEDIA_SAFE_EXTS.has(candidate)) return candidate;
  return 'bin';
}

/** 由扩展名反推 mime（没有 content-type 时写进侧档）；判不出为空串。 */
export function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  for (const [mime, mapped] of Object.entries(MEDIA_TYPE_EXT)) if (mapped === e) return mime;
  if (['png', 'gif', 'webp', 'bmp'].includes(e)) return `image/${e}`;
  return '';
}

/**
 * 媒体文件的基础名（不含扩展名）：`页面标题 - 原文件名主干`；
 * 页面标题为空、或去空白后与原文件名或其主干相同时，只用原文件名主干；没有原文件名时只用页面标题。
 */
export function mediaBaseName(pageTitle: string, fileName: string): string {
  const title = pageTitle.trim();
  const name = fileName.trim();
  const { stem } = splitExt(name);
  if (stem === '') return clipBaseName(title);
  if (title === '' || title === name || title === stem) return clipBaseName(stem);
  return clipBaseName(`${title} - ${stem}`);
}

/** `.meta/<id>.json` 的字段，键序固定（与 designs/alag-4-media/Files.dc.html 样张一致）。 */
export interface MediaMeta {
  id: string;
  file: string;
  /** 规范化的所在网页（出处） */
  source: string;
  /** 规范化的媒体地址；data: 地址写 `data:` 加 mime */
  media_url: string;
  medium: MediaKind;
  /** 页面标题 */
  title: string;
  site: string;
  captured: string;
  bytes: number;
  mime: string;
  tags: string[];
  note: string;
}

export function mediaMetaPath(id: string): string {
  return `.meta/${id}.json`;
}

/** 按固定键序排好，两空格缩进、结尾换行。 */
export function serializeMediaMeta(meta: MediaMeta): string {
  const ordered: MediaMeta = {
    id: meta.id,
    file: meta.file,
    source: meta.source,
    media_url: meta.media_url,
    medium: meta.medium,
    title: meta.title,
    site: meta.site,
    captured: meta.captured,
    bytes: meta.bytes,
    mime: meta.mime,
    tags: [...meta.tags],
    note: meta.note,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** 解析侧档；不是对象时抛错。缺的字段按空值补齐，便于原样写回。 */
export function parseMediaMeta(text: string): MediaMeta {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(t('error_sidecarNotObject'));
  const o = raw as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const medium = isMediaKind(o.medium) ? o.medium : 'image';
  return {
    id: s('id'),
    file: s('file'),
    source: s('source'),
    media_url: s('media_url'),
    medium,
    title: s('title'),
    site: s('site'),
    captured: s('captured'),
    bytes: typeof o.bytes === 'number' && Number.isFinite(o.bytes) ? o.bytes : 0,
    mime: s('mime'),
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string') : [],
    note: s('note'),
  };
}

/** 一位小数，小数是 0 时去掉。 */
function oneDecimal(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const KB = 1024;
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

/** 大小写法（DESIGN.md §3.2）：不到 1MB 写整数 KB；MB、GB 保留一位小数，小数是 0 时去掉。 */
export function formatBytes(bytes: number): string {
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  if (bytes < GB) return `${oneDecimal(bytes / MB)} MB`;
  return `${oneDecimal(bytes / GB)} GB`;
}

/** 下载进度：已下载的量按总数的单位写，如 `12.3 / 40.1 MB`；总数未知时只写已下载的量。 */
export function formatProgressBytes(done: number, total?: number): string {
  if (total === undefined || !Number.isFinite(total) || total <= 0) return formatBytes(done);
  if (total < MB) return `${Math.round(done / KB)} / ${Math.round(total / KB)} KB`;
  const unit = total < GB ? MB : GB;
  return `${oneDecimal(done / unit)} / ${oneDecimal(total / unit)} ${unit === MB ? 'MB' : 'GB'}`;
}

// ---- data: 地址

export function isDataUrl(url: string): boolean {
  return /^data:/i.test(url);
}

/** 非 base64 data: 的载荷逐字节解码：`%XX` 转成对应字节，其余字符按 UTF-8 编码成字节（二进制内容不能走 decodeURIComponent）。 */
function percentDecodeBytes(payload: string): Uint8Array {
  const encoder = new TextEncoder();
  const out: number[] = [];
  let literal = '';
  const flush = () => {
    if (literal !== '') {
      // 逐字节 push：不用 push(...bytes) 展开，长连续文本（数百 KB）会超出参数个数上限
      for (const byte of encoder.encode(literal)) out.push(byte);
    }
    literal = '';
  };
  for (let i = 0; i < payload.length; i++) {
    const hex = payload[i] === '%' ? payload.slice(i + 1, i + 3) : '';
    if (/^[0-9a-fA-F]{2}$/.test(hex)) {
      flush();
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      literal += payload[i];
    }
  }
  flush();
  return new Uint8Array(out);
}

/** 解码 data: 地址；格式不对返回 null。 */
export function decodeDataUrl(url: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^,]*),([\s\S]*)$/i.exec(url);
  if (!m) return null;
  const header = m[1] ?? '';
  const payload = m[2] ?? '';
  const params = header.split(';');
  const mime = (params[0] ?? '').trim().toLowerCase() || 'text/plain';
  const base64 = params.slice(1).some((p) => p.trim().toLowerCase() === 'base64');
  try {
    if (base64) {
      const bin = atob(decodeURIComponent(payload).replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { mime, bytes };
    }
    return { mime, bytes: percentDecodeBytes(payload) };
  } catch {
    return null;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 媒体地址在已保存记录里的键：http(s) 地址规范化；data: 地址用内容的 SHA-256（`data:sha256:<hex>`），
 * 原样存会太长。解不开的 data: 地址按整串的 SHA-256。
 */
export async function mediaKeyOf(url: string): Promise<string> {
  if (!isDataUrl(url)) return canonicalizeUrl(url);
  const decoded = decodeDataUrl(url);
  return `data:sha256:${await sha256Hex(decoded?.bytes ?? new TextEncoder().encode(url))}`;
}

/** 侧档里 media_url 的写法：http(s) 规范化；data: 写 `data:` 加 mime。 */
export function mediaUrlForMeta(url: string, mime: string): string {
  return isDataUrl(url) ? `data:${mime}` : canonicalizeUrl(url);
}
