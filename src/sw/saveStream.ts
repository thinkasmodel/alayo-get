// 流媒体剪藏（ALAG-4）：采集（service worker 抓 YouTube、B 站视频页的服务端 HTML；网盘、X 视频、直链的 Capture 拼装）
// 与写入（封面下载、`.md`）。查重、加锁、清理、提交已保存记录由 saveClip 负责。
import { HTML_MAX_BYTES, readTextCapped } from './fetchBody';
import type { ClipResult, FetchLike, WriteCtx } from './saveClip';
import { canonicalizeUrl } from '@/core/canonical';
import { buildStreamMarkdown } from '@/core/document';
import { clipBaseName, uniqueFileName } from '@/core/filename';
import { siteFromUrl } from '@/core/frontmatter';
import { assetPath } from '@/core/images';
import { parseStreamHtml, parseStreamUrl, type ParsedStream } from '@/core/stream';
import { t } from '@/shared/i18n';
import type { Capture, StreamCaptureInfo } from '@/shared/types';

export const STREAM_PAGE_TIMEOUT_MS = 10_000;

function streamInfo(parsed: ParsedStream, extra: Partial<StreamCaptureInfo> = {}): StreamCaptureInfo {
  return { platform: parsed.platform, videoId: parsed.videoId, embed: parsed.embed, duration: null, medium: 'video', ...extra };
}

/** 只有地址和标题的流媒体剪藏（元数据没取到：extract partial）。 */
export function partialStreamCapture(parsed: ParsedStream, title: string): Capture {
  return {
    url: parsed.canonical,
    title: title.trim() || parsed.canonical,
    site: '',
    author: '',
    published: '',
    description: '',
    coverUrl: '',
    markdown: null,
    textLength: 0,
    kind: 'stream',
    fetched: false,
    stream: streamInfo(parsed),
  };
}

/**
 * YouTube、B 站：抓视频页（10 秒，带 cookie），按纯文本解析元数据。
 * b23.tv 短链按跟随跳转后的 res.url 再解析一次。抓取失败退用 fallbackTitle（标签页标题或链接文字），extract partial。
 * 其余平台不抓，直接返回 partial。
 */
export async function captureStreamPage(parsed: ParsedStream, fallbackTitle: string, fetchFn: FetchLike): Promise<Capture> {
  const partial = partialStreamCapture(parsed, fallbackTitle);
  if (parsed.platform !== 'youtube' && parsed.platform !== 'bilibili') return partial;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_PAGE_TIMEOUT_MS);
  try {
    const res = await fetchFn(parsed.canonical, { credentials: 'include', signal: controller.signal });
    if (!res.ok) return partial;
    let target = parsed;
    if (target.videoId === '') {
      // b23.tv：跟随跳转后的地址才是视频页
      const resolved = parseStreamUrl(res.url || '');
      if (!resolved || resolved.platform !== 'bilibili' || resolved.videoId === '') return partial;
      target = resolved;
    }
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type !== '' && !type.includes('html')) return partialStreamCapture(target, fallbackTitle);
    const html = await readTextCapped(res, HTML_MAX_BYTES);
    if (html === null) {
      controller.abort();
      console.warn('[Alayo Get] 视频页超过 4MB，按抓取失败处理，只记地址和标题', target.canonical);
      return partialStreamCapture(target, fallbackTitle);
    }
    const meta = parseStreamHtml(parsed.platform, html, res.url || target.canonical);
    // 同意页、登录页、重定向到别的视频时，页面里的 ID 与要存的不一致：按抓取失败处理
    if (!meta.videoIds.includes(target.videoId)) return partialStreamCapture(target, fallbackTitle);
    return {
      url: target.canonical,
      title: meta.title.trim() || fallbackTitle.trim() || target.canonical,
      site: '',
      author: meta.author,
      published: meta.published,
      description: meta.description,
      coverUrl: meta.cover,
      markdown: null,
      textLength: 0,
      kind: 'stream',
      fetched: true,
      // 嵌入地址以 URL 推出的为准（带 B 站分 P），推不出时用页面里的 og:video
      stream: streamInfo(target, { embed: target.embed || meta.embed, duration: meta.duration }),
    };
  } catch (err) {
    console.warn('[Alayo Get] 抓取视频页失败，只记地址和标题', parsed.canonical, err);
    return partial;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 网盘：页面采集（capturePage）或右键链接抓取（captureLink）的结果，拿到非空标题（不等于 URL 本身）就存流媒体剪藏，
 * duration 为 null、medium 为 video；拿不到返回 null，由调用方照旧存书签剪藏。
 */
export function netdiskStreamCapture(capture: Capture, parsed: ParsedStream): Capture | null {
  const title = capture.title.trim();
  if (title === '' || title === capture.url.trim() || title === parsed.canonical) return null;
  return {
    url: parsed.canonical,
    title,
    site: capture.site,
    author: capture.author,
    published: capture.published,
    description: capture.description,
    coverUrl: capture.coverUrl,
    markdown: null,
    textLength: 0,
    kind: 'stream',
    // 右键链接没抓到目标页时 extract partial；页面采集算取到了
    fetched: capture.kind === 'link' ? capture.fetched === true : true,
    stream: streamInfo(parsed),
  };
}

/**
 * 网页播放器的 blob: 视频、音频：没有可下载的地址，存当前页的流媒体剪藏（platform other，videoId 与 embed 为空）。
 * 出处就是当前页，不再写“来自”那一行，也没有大小。
 */
export function blobStreamCapture(pageUrl: string, pageTitle: string, medium: 'video' | 'audio'): Capture {
  return {
    url: pageUrl,
    title: pageTitle.trim() || pageUrl,
    site: '',
    author: '',
    published: '',
    description: '',
    coverUrl: '',
    markdown: null,
    textLength: 0,
    kind: 'stream',
    fetched: true,
    stream: { platform: 'other', videoId: '', embed: '', duration: null, medium },
  };
}

/** YouTube 的 maxresdefault 不一定有，失败再试 hqdefault。 */
function youtubeFallbackCover(capture: Capture): string | null {
  const info = capture.stream;
  if (info?.platform !== 'youtube' || info.videoId === '') return null;
  const fallback = `https://i.ytimg.com/vi/${info.videoId}/hqdefault.jpg`;
  return fallback === capture.coverUrl ? null : fallback;
}

/**
 * 写流媒体剪藏：下载封面进 `.assets/<id>/cover.<ext>`（失败时正文用远程地址、cover 字段为空串），再写 `.md`。
 */
export async function writeStreamClip(ctx: WriteCtx, capture: Capture): Promise<ClipResult> {
  const info = capture.stream;
  if (!info) throw new Error(t('error_streamInfoMissing'));
  const source = canonicalizeUrl(capture.url);
  const title = capture.title.trim() || source;
  const extract = capture.fetched ? 'full' : 'partial';
  let imageCount = 0;
  let imageFailures = 0;
  let coverPath = '';
  let coverRef = '';

  if (/^https?:\/\//i.test(capture.coverUrl)) {
    ctx.progress({ phase: 'images', done: 0, total: 1 });
    let got = await ctx.downloadImage(capture.coverUrl);
    const fallback = got ? null : youtubeFallbackCover(capture);
    if (fallback) got = await ctx.downloadImage(fallback);
    if (got) {
      coverPath = assetPath(ctx.id, 'cover', got.ext);
      await ctx.write(coverPath, got.data);
      coverRef = coverPath;
      imageCount++;
    } else {
      coverRef = capture.coverUrl;
      imageFailures++;
    }
    ctx.progress({ phase: 'images', done: 1, total: 1 });
  }
  ctx.progress({ phase: 'write' });

  const markdown = buildStreamMarkdown({
    frontmatter: {
      id: ctx.id,
      source,
      medium: info.medium,
      title,
      author: capture.author,
      published: capture.published,
      captured: ctx.captured,
      tags: [],
      note: '',
      extract,
    },
    stream: { platform: info.platform, video_id: info.videoId, embed: info.embed, duration: info.duration, cover: coverPath },
    coverRef,
    info,
    description: capture.description,
  });
  const file = uniqueFileName(clipBaseName(title), await ctx.deps.library.listRoot());
  await ctx.write(file, markdown);

  const oversize = info.platform === 'other' && info.bytes !== undefined ? { oversize: { bytes: info.bytes } } : {};
  return {
    file,
    title,
    medium: info.medium,
    extract,
    imageCount,
    imageFailures,
    // 与 frontmatter 的 site 一致（直链时是直链的域名，不是所在网页）
    site: siteFromUrl(source),
    extra: { stream: { platform: info.platform, duration: info.duration, medium: info.medium, ...oversize } },
  };
}
