// 剪藏的 Markdown 文件内容：文章剪藏、书签剪藏、流媒体剪藏（ALAG-4）三种版式。
import { emitFrontmatter, type FrontmatterFields, type StreamFrontmatter } from './frontmatter';
import { formatBytes } from './media';
import { formatSeconds, platformLabel } from './stream';
import { t } from '@/shared/i18n';
import type { StreamCaptureInfo } from '@/shared/types';

/** 标题放进一行：换行等空白合并成一个空格。 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 链接文字里的方括号和反斜杠转义，避免提前闭合。 */
function linkText(text: string): string {
  return oneLine(text).replace(/([\\[\]])/g, '\\$1');
}

/** 链接地址里的空白和圆括号百分号编码，避免 Markdown 链接被截断。 */
export function linkDestination(url: string): string {
  return url.replace(/[\s()]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

function withTrailingNewline(text: string): string {
  return text.replace(/\s+$/, '') + '\n';
}

export interface ArticleInput {
  frontmatter: Omit<FrontmatterFields, 'medium' | 'extract'>;
  /** 已经把图片地址重写过的正文 Markdown。 */
  body: string;
  /** 缺省 web；X 专门适配为 x（ALAG-3）。 */
  medium?: 'web' | 'x';
  /** 缺省 full；X 作者串只存了一部分时为 partial。 */
  extract?: 'full' | 'partial';
  /** 正文一级标题，缺省取 frontmatter.title；X 长文传长文标题本身（不带 `@handle - ` 前缀）。 */
  heading?: string;
}

/** 文章剪藏：frontmatter、`# 标题`、`[原文](source)`、正文。medium 缺省 web，extract 缺省 full。 */
export function buildArticleMarkdown({ frontmatter, body, medium = 'web', extract = 'full', heading }: ArticleInput): string {
  const fm = emitFrontmatter({ ...frontmatter, medium, extract });
  const parts = [`# ${oneLine(heading ?? frontmatter.title)}`, `[${t('file_source')}](${linkDestination(frontmatter.source)})`];
  const trimmedBody = body.trim();
  if (trimmedBody !== '') parts.push(trimmedBody);
  return withTrailingNewline(`${fm}\n${parts.join('\n\n')}`);
}

export interface BookmarkInput {
  frontmatter: Omit<FrontmatterFields, 'medium'>;
  description: string;
  /** 封面的相对路径，如 `.assets/<id>/cover.jpg`；没有封面为空。 */
  coverPath: string;
}

/** 书签剪藏：frontmatter、`[标题](source)`、描述（可无）、封面（可无）。medium: link。 */
export function buildBookmarkMarkdown({ frontmatter, description, coverPath }: BookmarkInput): string {
  const fm = emitFrontmatter({ ...frontmatter, medium: 'link' });
  const parts = [`[${linkText(frontmatter.title)}](${linkDestination(frontmatter.source)})`];
  const desc = description.trim();
  if (desc !== '') parts.push(desc);
  if (coverPath !== '') parts.push(`![](${linkDestination(coverPath)})`);
  return withTrailingNewline(`${fm}\n${parts.join('\n\n')}`);
}

export interface StreamInput {
  frontmatter: Omit<FrontmatterFields, 'medium'> & { medium: 'video' | 'audio' };
  /** frontmatter 末尾的五个流媒体字段。 */
  stream: StreamFrontmatter;
  /** 正文里的封面：本地相对路径；下载失败时为远程地址；没有封面为空串（不写这一段）。 */
  coverRef: string;
  /** 平台、时长、视频或音频；直链还有所在网页与大小。 */
  info: Pick<StreamCaptureInfo, 'platform' | 'medium' | 'duration' | 'page' | 'bytes'>;
  /** 简介全文；为空或只是 `-` 时不写。 */
  description: string;
}

/** `▶ {平台显示名} {视频|音频}{ (时长)}{ · 作者}`；直链为 `▶ 视频直链 · 1.8 GB`（大小未知时省略大小）。 */
export function streamPlayLine(info: StreamInput['info'], author: string): string {
  const label = platformLabel(info.platform, info.medium);
  if (info.platform === 'other') {
    return typeof info.bytes === 'number' ? `▶ ${label} · ${formatBytes(info.bytes)}` : `▶ ${label}`;
  }
  // 句中小写：`▶ YouTube video (3:33)`
  const what = t(info.medium === 'audio' ? 'kindInline_audio' : 'kindInline_video');
  // 平台显示名本身以“视频”结尾（X 视频）时不再重复
  let line = label.endsWith(what) ? `▶ ${label}` : `▶ ${label} ${what}`;
  if (info.duration !== null) line += ` (${formatSeconds(info.duration)})`;
  const by = oneLine(author);
  if (by !== '') line += ` · ${by}`;
  return line;
}

/**
 * 流媒体剪藏：frontmatter（末尾追加 platform、video_id、embed、duration、cover）、`# 标题`、`[原文](出处)`、
 * 封面（可无）、`▶` 一行、直链的“来自 [页面标题](页面地址)”、简介（可无）。取不到的项不写。
 */
export function buildStreamMarkdown({ frontmatter, stream, coverRef, info, description }: StreamInput): string {
  const fm = emitFrontmatter(frontmatter, stream);
  const parts = [`# ${oneLine(frontmatter.title)}`, `[${t('file_source')}](${linkDestination(frontmatter.source)})`];
  if (coverRef !== '') parts.push(`![](${linkDestination(coverRef)})`);
  parts.push(streamPlayLine(info, frontmatter.author));
  if (info.platform === 'other' && info.page && info.page.url !== '') {
    parts.push(t('file_from', `[${linkText(info.page.title || info.page.url)}](${linkDestination(info.page.url)})`));
  }
  const desc = description.trim();
  if (desc !== '' && desc !== '-') parts.push(desc);
  return withTrailingNewline(`${fm}\n${parts.join('\n\n')}`);
}

/** 去掉 X 剪藏标题开头的 `@handle - `；没有这个前缀就原样返回。 */
function withoutXPrefix(title: string): string {
  return title.replace(/^@[A-Za-z0-9_]{1,15} - /, '');
}

/**
 * 改标题时同步正文里显示标题的那一行：frontmatter 之后第一个非空行。
 * 文章剪藏是 `# 标题`（X 长文是 `# 去掉 @handle 前缀的标题`），书签剪藏是 `[标题](出处)`（只换链接文字）。
 * 只有这一行与当初生成的样子完全一致时才改；用户改过的保持原样，原文返回。
 */
export function updateDisplayedTitle(md: string, oldTitle: string, newTitle: string, source: string): string {
  if (!md.startsWith('---\n')) return md;
  const fmEnd = md.indexOf('\n---\n', 3);
  if (fmEnd === -1) return md;
  let start = fmEnd + 5;
  // 跳过空行，找第一个非空行
  while (start < md.length) {
    const lineEnd = md.indexOf('\n', start);
    const line = md.slice(start, lineEnd === -1 ? md.length : lineEnd);
    if (line.trim() !== '') break;
    if (lineEnd === -1) return md;
    start = lineEnd + 1;
  }
  const lineEnd = md.indexOf('\n', start);
  const end = lineEnd === -1 ? md.length : lineEnd;
  const line = md.slice(start, end);

  const destination = `(${linkDestination(source)})`;
  let replacement: string | null = null;
  if (line === `# ${oneLine(oldTitle)}`) {
    replacement = `# ${oneLine(newTitle)}`;
  } else if (line === `# ${oneLine(withoutXPrefix(oldTitle))}`) {
    // X 长文：正文一级标题是去掉 `@handle - ` 前缀的标题（ALAG-3）
    replacement = `# ${oneLine(withoutXPrefix(newTitle))}`;
  } else if (line === `[${linkText(oldTitle)}]${destination}`) {
    replacement = `[${linkText(newTitle)}]${destination}`;
  }
  return replacement === null ? md : md.slice(0, start) + replacement + md.slice(end);
}
