// 媒体剪藏（ALAG-4）：探测大小、下载（同站才带 cookie，60 秒，边读边计数）、写媒体文件与 `.meta/<id>.json`。
// 音视频超过 100MB 或拿不到大小时转成直链流媒体剪藏；图片、PDF 超过 100MB 退回书签剪藏——这两种转向由 saveClip 接着写。
import { readBodyCapped } from './fetchBody';
import type { ClipResult, FetchLike, WriteCtx } from './saveClip';
import { canonicalizeUrl } from '@/core/canonical';
import { uniqueFileName } from '@/core/filename';
import { siteFromUrl } from '@/core/frontmatter';
import {
  decodeDataUrl,
  fileNameFromContentDisposition,
  fileNameFromUrl,
  isDataUrl,
  MEDIA_MAX_BYTES,
  mediaBaseName,
  mediaKindFromContentType,
  mediaMetaPath,
  mediaUrlForMeta,
  mimeFromExt,
  mimeOf,
  resolveMediaExt,
  serializeMediaMeta,
  splitExt,
} from '@/core/media';
import { mediaCredentials, sameSite } from '@/core/site';
import { classifyDirect } from '@/core/stream';
import { t } from '@/shared/i18n';
import type { Capture, MediaKind } from '@/shared/types';

export const MEDIA_TIMEOUT_MS = 60_000;
export const PROBE_TIMEOUT_MS = 10_000;
/** 下载进度的节流：距上次推送满 250ms 或多下载了 1MB 才推一次。 */
export const PROGRESS_INTERVAL_MS = 250;
export const PROGRESS_STEP_BYTES = 1024 * 1024;

export interface ProbeResult {
  /** content-length；拿不到为 null。 */
  bytes: number | null;
  contentType: string | null;
  /** Content-Disposition 里的文件名；没有为空串。 */
  fileName: string;
}

/** 媒体请求的 cookie 策略（ALAG-18，ADR-0009）：pageUrl 是被保存页面，缺省时取请求地址本身。 */
export interface MediaRequestOptions {
  credentials: RequestCredentials;
  pageUrl?: string;
}

/**
 * 带 cookie 的请求跟随重定向落到了与页面跨站的地址：cookie 已经发出，只能在响应侧丢弃结果。
 * 不带 cookie 或没有重定向信息（res.url 为空）时不拦。
 */
function redirectedCrossSite(res: Response, url: string, options: MediaRequestOptions): boolean {
  return options.credentials === 'include' && res.url !== '' && !sameSite(options.pageUrl ?? url, res.url);
}

function contentLength(res: Response): number | null {
  const raw = res.headers.get('content-length');
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 探测媒体地址的大小与类型，不下载内容：先 HEAD；HEAD 失败或没给 content-length 时 GET，读到响应头就中止。
 * 都失败时 bytes 为 null。带 cookie 的探测跳转到跨站地址时，该次探测视为失败。
 */
export async function probeMedia(fetchFn: FetchLike, url: string, options: MediaRequestOptions): Promise<ProbeResult> {
  const attempt = async (method: 'HEAD' | 'GET'): Promise<ProbeResult | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, { method, credentials: options.credentials, signal: controller.signal });
      if (redirectedCrossSite(res, url, options)) {
        console.info(`[Alayo Get] ${method} 探测媒体时跳转到了跨站地址，丢弃结果：${url} → ${res.url}`);
        return null;
      }
      if (!res.ok) return null;
      return {
        bytes: contentLength(res),
        contentType: res.headers.get('content-type'),
        fileName: fileNameFromContentDisposition(res.headers.get('content-disposition')),
      };
    } catch (err) {
      console.info(`[Alayo Get] ${method} 探测媒体大小失败`, url, err);
      return null;
    } finally {
      clearTimeout(timer);
      // GET 只要响应头：中止请求，不读响应体
      if (method === 'GET') controller.abort();
    }
  };
  const head = await attempt('HEAD');
  if (head && head.bytes !== null) return head;
  const get = await attempt('GET');
  return get ?? head ?? { bytes: null, contentType: null, fileName: '' };
}

export type DownloadResult =
  | { kind: 'ok'; data: Blob; bytes: number; contentType: string | null; fileName: string }
  | { kind: 'too-large'; bytes: number | null };

/**
 * 下载媒体文件：credentials 由调用方按同站规则给（同站带 cookie，登录后才能下的 PDF），60 秒超时；
 * 有 content-length 且超过上限时不读；没有时边读边计数，超过上限就中止（内存里的半截内容丢弃，不写任何文件）。
 * HTTP 错误、超时、带 cookie 的请求跳转到跨站地址时抛错。
 */
export async function downloadMedia(
  fetchFn: FetchLike,
  url: string,
  onProgress: (done: number, total?: number) => void,
  options: MediaRequestOptions,
  maxBytes = MEDIA_MAX_BYTES,
): Promise<DownloadResult> {
  if (isDataUrl(url)) {
    const decoded = decodeDataUrl(url);
    if (!decoded) throw downloadError(t('error_dataUrlDecode'));
    if (decoded.bytes.byteLength > maxBytes) return { kind: 'too-large', bytes: decoded.bytes.byteLength };
    onProgress(decoded.bytes.byteLength, decoded.bytes.byteLength);
    return {
      kind: 'ok',
      data: new Blob([decoded.bytes as Uint8Array<ArrayBuffer>], { type: decoded.mime }),
      bytes: decoded.bytes.byteLength,
      contentType: decoded.mime,
      fileName: '',
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MEDIA_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { credentials: options.credentials, signal: controller.signal });
    if (redirectedCrossSite(res, url, options)) {
      controller.abort();
      throw downloadError(t('error_mediaRedirectedCrossSite'));
    }
    if (!res.ok) throw downloadError(t('error_httpStatus', String(res.status)));
    const declared = contentLength(res);
    if (declared !== null && declared > maxBytes) {
      controller.abort();
      return { kind: 'too-large', bytes: declared };
    }
    const total = declared ?? undefined;
    const contentType = res.headers.get('content-type');
    const fileName = fileNameFromContentDisposition(res.headers.get('content-disposition'));
    let lastAt = Date.now();
    let lastBytes = 0;
    onProgress(0, total);
    const body = await readBodyCapped(res, maxBytes, (received) => {
      const now = Date.now();
      if (now - lastAt >= PROGRESS_INTERVAL_MS || received - lastBytes >= PROGRESS_STEP_BYTES) {
        lastAt = now;
        lastBytes = received;
        onProgress(received, total);
      }
    });
    if (body.kind === 'too-large') {
      controller.abort();
      return { kind: 'too-large', bytes: declared };
    }
    const { chunks, bytes: received } = body;
    onProgress(received, total ?? received);
    return { kind: 'ok', data: new Blob(chunks as Uint8Array<ArrayBuffer>[], { type: contentType ?? '' }), bytes: received, contentType, fileName };
  } catch (err) {
    if (timedOut) throw downloadError(t('error_downloadTimeout', String(MEDIA_TIMEOUT_MS / 1000)));
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function downloadError(message: string): Error {
  const err = new Error(message);
  err.name = 'DownloadError';
  return err;
}

/** 直链标题：`页面标题 - 原文件名`（扩展名保留）；页面标题为空或与原文件名（或其主干）相同时只用原文件名。 */
function directTitle(pageTitle: string, fileName: string, fallback: string): string {
  const title = pageTitle.trim();
  const name = fileName.trim();
  if (name === '') return title || fallback;
  if (title === '' || title === name || title === splitExt(name).stem) return name;
  return `${title} - ${name}`;
}

/**
 * 超过 100MB 或拿不到大小的音视频直链 → 流媒体剪藏（platform other）：出处是直链本身，
 * 所在网页记在 stream.page（与直链相同时不记），大小记在 stream.bytes。
 */
export function directStreamCapture(capture: Capture, probe: Pick<ProbeResult, 'bytes' | 'contentType' | 'fileName'>): Capture {
  const media = capture.media;
  if (!media) throw new Error(t('error_mediaInfoMissing'));
  const typed = mediaKindFromContentType(probe.contentType);
  const medium: 'video' | 'audio' = typed === 'audio' || typed === 'video' ? typed : media.kind === 'audio' ? 'audio' : 'video';
  const name = probe.fileName || media.fileName || fileNameFromUrl(media.url);
  const pageUrl = canonicalizeUrl(capture.url);
  const samePage = pageUrl === canonicalizeUrl(media.url);
  return {
    url: media.url,
    title: directTitle(capture.title, name, media.url),
    site: '',
    author: '',
    published: '',
    description: '',
    coverUrl: '',
    markdown: null,
    textLength: 0,
    kind: 'stream',
    fetched: true,
    stream: {
      platform: 'other',
      videoId: '',
      embed: '',
      duration: null,
      medium,
      ...(samePage ? {} : { page: { url: pageUrl, title: capture.title.trim() } }),
      bytes: probe.bytes,
    },
  };
}

export type MediaOutcome = { kind: 'saved'; result: ClipResult } | { kind: 'stream'; capture: Capture } | { kind: 'bookmark' };

/**
 * 媒体剪藏：音视频先探测大小（超过上限或拿不到 → 直链流媒体剪藏）；下载；写媒体文件 → 写 `.meta/<id>.json`。
 * 图片、PDF 下载时超过上限 → 退回书签剪藏。文件写入经 ctx.write 登记，出错由 saveClip 清理。
 */
export async function saveMediaClip(ctx: WriteCtx, capture: Capture): Promise<MediaOutcome> {
  const media = capture.media;
  if (!media) throw new Error(t('error_mediaInfoMissing'));
  const { kind, url } = media;
  // 同站才带 cookie（ALAG-18，ADR-0009）
  const credentials = mediaCredentials(capture.url, url);
  const requestOptions: MediaRequestOptions = { credentials, pageUrl: capture.url };

  if ((kind === 'video' || kind === 'audio') && !isDataUrl(url)) {
    const probe = await probeMedia(ctx.deps.fetch, url, requestOptions);
    if (classifyDirect(probe.contentType, probe.bytes, kind) === 'stream') {
      return { kind: 'stream', capture: directStreamCapture(capture, probe) };
    }
  }

  const got = await downloadMedia(
    ctx.deps.fetch,
    url,
    (done, total) => ctx.progress(total === undefined ? { phase: 'download', done, kind } : { phase: 'download', done, total, kind }),
    requestOptions,
  );
  if (got.kind === 'too-large') {
    if (kind === 'video' || kind === 'audio') {
      return { kind: 'stream', capture: directStreamCapture(capture, { bytes: got.bytes, contentType: null, fileName: '' }) };
    }
    return { kind: 'bookmark' };
  }

  // 服务器回了网页（登录页、错误页）而不是文件：不写文件、不写记录。跨站请求没带 cookie，提示里说明原因
  const gotMime = mimeOf(got.contentType);
  if (gotMime === 'text/html' || gotMime === 'application/xhtml+xml') {
    throw downloadError(t(credentials === 'omit' ? 'error_notAFileCrossSite' : 'error_notAFile'));
  }

  const name = got.fileName || media.fileName || fileNameFromUrl(url);
  // 扩展名由 content-type 定；服务器文件名只贡献主干，后缀只在白名单内才用（ALAG-17）
  const ext = resolveMediaExt(got.contentType, name, url);
  const mime = mimeOf(got.contentType) || mimeFromExt(ext);
  const pageTitle = capture.title.trim();
  const file = uniqueFileName(mediaBaseName(pageTitle, name), await ctx.deps.library.listRoot(), `.${ext}`);
  const source = canonicalizeUrl(capture.url);
  const site = siteFromUrl(source);
  const title = pageTitle || name || file;

  ctx.progress({ phase: 'write' });
  // 写入顺序：媒体文件 → 侧档；已保存记录由 saveClip 在两者都写成功后提交
  await ctx.write(file, got.data);
  await ctx.write(
    mediaMetaPath(ctx.id),
    serializeMediaMeta({
      id: ctx.id,
      file,
      source,
      media_url: mediaUrlForMeta(url, mime),
      medium: kind,
      title,
      site,
      captured: ctx.captured.toISOString(),
      bytes: got.bytes,
      mime,
      tags: [],
      note: '',
    }),
  );
  return {
    kind: 'saved',
    result: {
      file,
      title,
      medium: kind,
      extract: 'full',
      imageCount: 0,
      imageFailures: 0,
      site,
      extra: { media: { kind, bytes: got.bytes } },
    },
  };
}

/** 判断媒体类别用：标签页地址的 content-type（PDF 查看器不能注入时，SW 用 HEAD 探一次）。 */
export async function probeMediaKind(fetchFn: FetchLike, url: string): Promise<MediaKind | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  // 探的是标签页自身地址，与页面必然同站：mediaCredentials(url, url) 恒为 include
  const probe = await probeMedia(fetchFn, url, { credentials: mediaCredentials(url, url), pageUrl: url });
  return mediaKindFromContentType(probe.contentType);
}
