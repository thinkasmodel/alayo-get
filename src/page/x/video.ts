// X 视频的流媒体剪藏（ALAG-4）：在帖子页或视频专链上，按帖子 id 找到 article，取作者、正文和第一个视频的封面与时长。
// 只读当前页 DOM 和主世界标注的 data-alayo-x（ADR-0003）；调用前由采集脚本先触发一次标注。
import { t } from '@/shared/i18n';
import type { CaptureResponse } from '@/shared/messages';
import { parsePost, quoteBox, TWEET, type XMediaVideo, type XPost } from './cells';
import { paragraphs, plainText } from './markdown';
import { parseXStatusUrl } from './url';

const TITLE_CODE_POINTS = 30;

/** 视频专链里的序号（`/video/<n>`）；不是专链返回 null。 */
function videoIndexOf(url: string): number | null {
  const m = /\/status\/\d+\/video\/(\d{1,2})(?:[/?#]|$)/.exec(url);
  return m?.[1] ? Number(m[1]) : null;
}

/**
 * 找 statusId 对应的帖子，拼成 X 视频的流媒体剪藏（kind 'stream'，platform x）。
 * 标题照 ALAG-3 写 `@handle - 正文前 30 码点`，作者写 `Name (@handle)`，简介是帖子正文 Markdown。
 * 帖子里没有视频（如右键的是回复里的视频）回 `XVideoNeedsPost`；页面上找不到这条帖子回 `XPostNotFound`。
 */
export function captureXVideo(doc: Document, statusId: string, pageUrl: string, srcUrl?: string): CaptureResponse {
  // 右键的视频有 src 时，按这个 video 所在的帖子生成结果（回复里的视频不再存成主帖的视频）
  // 传了 srcUrl 但页面上找不到对应的 video（如播放器重建换了 src）→ 认不出，不退回焦点帖；
  // 没传 srcUrl（视频专链）或 video 不在帖子里（灯箱）→ 按 statusId 找焦点帖
  const found = srcUrl ? videoOwner(doc, srcUrl) : null;
  if (srcUrl && !found) return { error: `XVideoNeedsPost: ${t('error_xVideoOwnerUnknown')}` };
  const owner = found?.article ? { video: found.video, article: found.article } : null;
  if (owner) {
    const post = parsePost(owner.article);
    if (!post) return { error: `XVideoNeedsPost: ${t('error_xVideoOwnerUnknown')}` };
    // 视频在引用框里：按引用帖生成结果；引用地址读不到（标注器没生效）或引用里没有视频 → 认不出
    if (quoteBox(owner.article)?.contains(owner.video)) {
      const quote = post.quote;
      const ref = quote?.url ? parseXStatusUrl(quote.url) : null;
      if (!quote || !ref || !quote.media.some((m) => m.kind === 'video')) return { error: `XVideoNeedsPost: ${t('error_xVideoOwnerUnknown')}` };
      return buildCapture(
        { id: ref.id, handle: quote.handle, name: quote.name, datetime: quote.datetime, url: quote.url, textMd: quote.textMd, truncated: quote.truncated, media: quote.media, quote: null, card: null },
        pageUrl,
      );
    }
    if (!post.media.some((m) => m.kind === 'video')) return { error: `XVideoNeedsPost: ${t('error_xVideoOwnerUnknown')}` };
    return buildCapture(post, pageUrl);
  }
  for (const article of doc.querySelectorAll(TWEET)) {
    const post = parsePost(article);
    if (!post || post.id !== statusId) continue;
    if (!post.media.some((m) => m.kind === 'video')) return { error: `XVideoNeedsPost: ${t('error_xPostNoVideo')}` };
    return buildCapture(post, pageUrl);
  }
  return { error: `XPostNotFound: ${t('error_xPostNotFound')}` };
}

/** src 或 currentSrc 等于 srcUrl 的 video 及其所在的帖子 article；video 不在帖子里（灯箱）article 为 null；页面上找不到这个 video 返回 null。 */
function videoOwner(doc: Document, srcUrl: string): { video: Element; article: Element | null } | null {
  for (const video of doc.querySelectorAll('video')) {
    if (video.src === srcUrl || video.currentSrc === srcUrl || video.getAttribute('src') === srcUrl) return { video, article: video.closest(TWEET) };
  }
  return null;
}

/** 按帖子（自己的 status id、作者、正文、第一个视频）拼 X 视频流媒体剪藏；调用前已确认帖子里有视频。 */
function buildCapture(post: XPost, pageUrl: string): CaptureResponse {
  const index = post.media.findIndex((m) => m.kind === 'video');
  const video = post.media[index] as XMediaVideo;
  // 页面地址里的视频序号只对页面地址指向的那条帖子有效
  const n = (pageUrl.includes(`/status/${post.id}/`) ? videoIndexOf(pageUrl) : null) ?? index + 1;
  const text = plainText(post.textMd);
  const lead = text === '' ? post.id : Array.from(text).slice(0, TITLE_CODE_POINTS).join('');
  return {
    url: `https://x.com/${post.handle}/status/${post.id}/video/${n}`,
    title: `@${post.handle} - ${lead}`,
    site: 'x.com',
    author: `${post.name} (@${post.handle})`,
    published: post.datetime,
    description: paragraphs(post.textMd),
    coverUrl: video.poster,
    markdown: null,
    textLength: 0,
    kind: 'stream',
    fetched: true,
    stream: {
      platform: 'x',
      videoId: post.id,
      embed: '',
      duration: video.durationMs !== null ? Math.floor(video.durationMs / 1000) : null,
      medium: 'video',
    },
  };
}
