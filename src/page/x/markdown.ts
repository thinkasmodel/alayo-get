// XPost[] 转剪藏正文 Markdown：帖子、媒体、卡片、引用帖的排版（纯数据，node 环境可测）。
// 正文前面的 frontmatter、`# 标题`、`[原文](出处)` 由 buildArticleMarkdown 加。
import { linkDestination } from '@/core/document';
import { t } from '@/shared/i18n';
import type { XMedia, XPost, XQuote } from './cells';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 链接、加粗里的短文本转义（同 text.ts 的 escapeInline；本文件不碰 DOM，不引 Turndown）。 */
function esc(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/([\\`*_[\]<])/g, '\\$1');
}

/** ISO 时间 → 运行环境本地时区的 `YYYY-MM-DD`；解析不了返回空串。 */
export function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 视频时长：按 Math.floor(ms / 1000) 秒计（与 X 页面角标一致），不到 1 小时写 m:ss，否则 h:mm:ss。 */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

function mediaBlocks(media: XMedia[]): string[] {
  const blocks: string[] = [];
  for (const m of media) {
    if (m.kind === 'photo') {
      blocks.push(`![](${linkDestination(m.url)})`);
      continue;
    }
    if (m.poster) blocks.push(`![](${linkDestination(m.poster)})`);
    const video = t('file_xVideo');
    const label = m.kind === 'gif' ? '▶ GIF' : m.durationMs !== null ? `▶ ${video} (${formatDuration(m.durationMs)})` : `▶ ${video}`;
    blocks.push(`[${label}](${linkDestination(m.href)})`);
  }
  return blocks;
}

/**
 * 段落化：连续两个以上换行是分段（空一行），单个换行写成 CommonMark 硬换行（`\` 加换行）。
 * 每行去掉首尾空白（行首四个空格会被当成代码块）。
 */
export function paragraphs(raw: string): string {
  return raw
    .split(/\n[ \t]*\n\s*/)
    .map((p) =>
      p
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .join('\\\n'),
    )
    .filter((p) => p !== '')
    .join('\n\n');
}

/** 正文；截断的在末尾接 ` … [全文](url)`。 */
function textBlock(textMd: string, truncated: boolean, fullUrl: string): string | null {
  const text = paragraphs(textMd);
  if (!truncated) return text === '' ? null : text;
  const more = `… [${t('file_fullPost')}](${linkDestination(fullUrl)})`;
  return text === '' ? more : `${text} ${more}`;
}

/** 整段加 `> ` 前缀，空行写成 `>`。 */
export function blockquote(md: string): string {
  return md
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/** 引用头：`**Name (@handle)** · YYYY-MM-DD · [原帖](url)`；没有日期、没有原帖地址时去掉对应的一段。 */
function quoteHead(name: string, handle: string, datetime: string, url: string): string {
  const who = handle ? `${name || handle} (@${handle})` : name;
  const parts = [`**${esc(who)}**`];
  const date = localDate(datetime);
  if (date) parts.push(date);
  if (url) parts.push(`[${t('file_post')}](${linkDestination(url)})`);
  return parts.join(' · ');
}

/** 引用帖：整个是一个 blockquote。截断时 [全文] 取原帖地址，没有就取外层帖子地址。 */
export function quoteToMarkdown(q: XQuote, outerUrl: string): string {
  const blocks = [quoteHead(q.name, q.handle, q.datetime, q.url)];
  const text = textBlock(q.textMd, q.truncated, q.url || outerUrl);
  if (text !== null) blocks.push(text);
  blocks.push(...mediaBlocks(q.media));
  return blockquote(blocks.join('\n\n'));
}

/** 一条帖子：正文、媒体、卡片、引用帖，块与块之间空一行。 */
export function postToMarkdown(p: XPost): string {
  const blocks: string[] = [];
  const text = textBlock(p.textMd, p.truncated, p.url);
  if (text !== null) blocks.push(text);
  blocks.push(...mediaBlocks(p.media));
  if (p.card) blocks.push(`[${esc(p.card.label)}](${linkDestination(p.card.url)})`);
  if (p.quote) blocks.push(quoteToMarkdown(p.quote, p.url));
  return blocks.join('\n\n');
}

/** 长文里嵌入的帖子：按引用帖的 blockquote 格式输出，原帖链接是它自己的地址。 */
export function embeddedPostToMarkdown(p: XPost): string {
  return blockquote([quoteHead(p.name, p.handle, p.datetime, p.url), postToMarkdown(p)].filter((b) => b !== '').join('\n\n'));
}

/** 单帖或作者串的正文：各帖之间空一行，不加分隔线。 */
export function postsToMarkdown(posts: XPost[]): string {
  return posts
    .map(postToMarkdown)
    .filter((b) => b !== '')
    .join('\n\n');
}

/** Markdown 的纯文本（标题取前 30 个码点、textLength 用）：去掉图片、链接只留文字、去掉转义和行首标记，空白合并。 */
export function plainText(md: string): string {
  return md
    .replace(/^\s*(```|~~~).*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:>\s?)+/gm, '')
    .replace(/^\s*(?:#{1,6}\s|[-+]\s|\d+\.\s)/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/\\\n/g, '\n')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
