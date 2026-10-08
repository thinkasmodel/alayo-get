// 界面文案的纯函数（node 环境测试）。文案逐字取自 DESIGN.md §3 与 tasks/briefs/ALAG-2B.md；
// ALAG-7 起取自 public/_locales（英文见 designs/alag-6-7/Strings.dc.html）。
import { formatBytes, formatProgressBytes, mediaKindLabel } from '@/core/media';
import { formatSeconds, platformLabel } from '@/core/stream';
import { currentLang, t, tn } from '@/shared/i18n';
import type { ClipSummary, SavingProgress, XCaptureInfo, XPartial } from '@/shared/types';

export { formatBytes };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** ISO 时间 → 本地日期 `YYYY-MM-DD`（面板"已于 … 保存过"）。 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ISO 时间 → 本地日期（页面提示"已于 … 保存过"）：中文 `M 月 D 日`，英文 `Oct 7`。 */
export function formatMonthDay(iso: string): string {
  const d = new Date(iso);
  if (currentLang() === 'en') return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
  return t('date_monthDay', [String(d.getMonth() + 1), String(d.getDate())]);
}

/** 保存中的说明行。 */
export function savingText(progress: SavingProgress): string {
  switch (progress.phase) {
    case 'extract':
      return t('saving_extract');
    case 'images':
      return t('saving_images', [String(progress.done ?? 0), String(progress.total ?? 0)]);
    case 'write':
      return t('saving_write');
    case 'download': {
      // ALAG-4：“正在下载 PDF，12.3 / 40.1 MB”；拿不到总大小时只写已下载的量
      const label = mediaKindLabel(progress.kind ?? 'pdf', true);
      return t('saving_download', [label, formatProgressBytes(progress.done ?? 0, progress.total)]);
    }
  }
}

/** 保存中进度条宽度（百分比）：extract 20，images 20 + 60 × done / total，write 90。 */
export function savingPercent(progress: SavingProgress): number {
  switch (progress.phase) {
    case 'extract':
      return 20;
    case 'images': {
      const total = progress.total ?? 0;
      const done = Math.min(progress.done ?? 0, total);
      return total > 0 ? 20 + (60 * done) / total : 20;
    }
    case 'write':
      return 90;
    case 'download': {
      // download 按 20 + 60 × done / total，总数未知时 20
      const total = progress.total ?? 0;
      const done = Math.min(progress.done ?? 0, total);
      return total > 0 ? 20 + (60 * done) / total : 20;
    }
  }
}

/** X 剪藏按形态写的说明行开头（DESIGN.md“X 剪藏”）；service worker 重启后没有形态信息时写“X 剪藏”。 */
function xLabel(x: XCaptureInfo | undefined): string {
  switch (x?.form) {
    case 'post':
      return t('desc_xPost');
    case 'thread':
      return tn('desc_xThread', x.posts);
    case 'article':
      return t('desc_xArticle');
    default:
      return t('desc_xClip');
  }
}

/** 流媒体剪藏的平台名与时长：“YouTube · 3:33”；取不到时长时不写时长，直链写“视频直链”“音频直链”。 */
function streamLabel(stream: NonNullable<ClipSummary['stream']>): string {
  const label = platformLabel(stream.platform, stream.medium);
  return stream.duration !== null && stream.platform !== 'other' ? `${label} · ${formatSeconds(stream.duration)}` : label;
}

/** 已保存的说明行。 */
export function savedDescription(clip: Pick<ClipSummary, 'medium' | 'imageCount' | 'imageFailures' | 'x' | 'media' | 'stream'>): string {
  // ALAG-4：媒体剪藏“媒体剪藏 · 图片 · 1.2 MB”，流媒体剪藏“流媒体剪藏 · YouTube · 3:33”
  if (clip.media) return t('desc_media', [mediaKindLabel(clip.media.kind), formatBytes(clip.media.bytes)]);
  if (clip.stream) return t('desc_stream', streamLabel(clip.stream));
  let text: string;
  if (clip.medium === 'link') text = t('desc_bookmark');
  else {
    const label = clip.medium === 'x' ? xLabel(clip.x) : t('desc_article');
    text = clip.imageCount > 0 ? tn('desc_withImages', clip.imageCount, label) : label;
  }
  if (clip.imageFailures > 0) text = t('desc_imageFailures', [text, String(clip.imageFailures)]);
  return text;
}

/** 面板里超大或拿不到大小的直链小字（DESIGN.md §3.2）；不是这种情况返回 null。 */
export function oversizeNote(clip: Pick<ClipSummary, 'stream'>): string | null {
  const oversize = clip.stream?.oversize;
  if (!oversize) return null;
  return oversize.bytes === null ? t('oversize_noSize') : t('oversize_tooBig', formatBytes(oversize.bytes));
}

/** 页面提示“已存入”的说明行（DESIGN.md §3.3）：媒体“图片 · 文件名”，流媒体“B 站 · 标题”，超大直链写原因；其余为标题。 */
export function savedToastText(clip: Pick<ClipSummary, 'title' | 'file' | 'media' | 'stream'>): string {
  if (clip.media) return `${mediaKindLabel(clip.media.kind)} · ${clip.file}`;
  if (clip.stream) {
    const audio = clip.stream.medium === 'audio';
    const oversize = clip.stream.oversize;
    // 英文里名词在句首、句中大小写不同，四种情况各一个整句键
    if (oversize) {
      if (oversize.bytes === null) return t(audio ? 'toast_audioNoSize' : 'toast_videoNoSize');
      return t(audio ? 'toast_audioTooBig' : 'toast_videoTooBig');
    }
    return `${platformLabel(clip.stream.platform, clip.stream.medium)} · ${clip.title}`;
  }
  return clip.title;
}

/**
 * 页面提示“已摘录”的说明行（DESIGN.md §3.3，ALAG-4）：原摘录文件不在了 → “原来的摘录文件不在了，新建了一个”；
 * 没能生成文本片段链接 → “第 N 条 · 没能定位到原文位置，链接只到页面”；其余 → “第 N 条 · 文件名”。
 */
export function quoteToastText(clip: Pick<ClipSummary, 'file'> & { quote: NonNullable<ClipSummary['quote']> }): string {
  const { quote } = clip;
  if (quote.recreated) return t('quote_recreated');
  if (!quote.fragment) return t('quote_noFragment', String(quote.entry));
  return t('quote_entry', [String(quote.entry), clip.file]);
}

/** 面板里“只存了一部分”的原因小字：几种原因同时出现时按上限、超时、截断的顺序连写（DESIGN.md“X 剪藏”）。 */
export function partialNote(p: XPartial, posts: number): string {
  const parts: string[] = [];
  if (p.limit) parts.push(t('partial_limit'));
  if (p.timeout) parts.push(tn('partial_timeout', posts));
  if (p.truncated > 0) parts.push(tn('partial_truncated', p.truncated));
  // 中文句子之间不空格，英文用一个空格隔开
  return parts.join(currentLang() === 'en' ? ' ' : '');
}

/** 页面提示里“只存了一部分”的说明行：只写一个原因，优先级为超过上限、超时、长帖被截断（DESIGN.md §3.3）。 */
export function partialToastText(p: XPartial, posts: number): string {
  if (p.limit) return t('toastPartial_limit');
  if (p.timeout) return tn('toastPartial_timeout', posts);
  if (p.truncated > 0) return tn('toastPartial_truncated', p.truncated);
  return '';
}

export interface ErrorInfo {
  name: string;
  message: string;
}

/** 面板失败状态的原因句。 */
export function failureReason(error: ErrorInfo, folderName: string): string {
  if (error.name === 'NotFoundError') return t('fail_notFound', folderName);
  return t('fail_writeError', error.message);
}

/** 面板失败状态原因句下面那行等宽字。 */
export function failureDetail(error: ErrorInfo, folderName: string): string {
  return folderName ? `${error.name} · ${folderName}` : error.name;
}

/** 页面提示失败时的说明行。页面一侧读不到剪藏库句柄，没有文件夹名。 */
export function toastFailureText(error: ErrorInfo): string {
  if (error.name === 'NotFoundError') return t('toastFail_notFound');
  if (error.name === 'ExpiredRequest') return t('toastFail_expired');
  // ALAG-4：时间线上右键 X 视频，认不出是哪条帖子（面板不会遇到）
  if (error.name === 'XVideoNeedsPost') return t('error_xVideoTimeline');
  // ALAG-4：右键图片没有可下载的地址；内嵌数据太大没法暂存
  if (error.name === 'NoDownloadableUrl') return t('toastFail_noDownloadableUrl');
  if (error.name === 'DataUrlTooLarge') return t('error_dataUrlTooLarge');
  return t('toastFail_writeError', error.message);
}

/** 重试没有意义的直接失败（右键时就判定、不写文件）：页面提示只放“关闭”（ALAG-4，编排者裁决）。 */
export function failureRetryable(error: ErrorInfo): boolean {
  // DataUrlTooLarge 不进暂存、不记 requestId，点重试同样只会看到“已过期”
  return error.name !== 'XVideoNeedsPost' && error.name !== 'NoDownloadableUrl' && error.name !== 'DataUrlTooLarge';
}

/** 选项页待补存列表：最多显示的条数。 */
export const PENDING_SHOWN = 5;
