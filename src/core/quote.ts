// 摘录剪藏的文件版式（ALAG-4，设计稿 Files.dc.html 摘录样张）。纯函数，node 环境测试。
// 一个页面一个 `摘录 - 页面标题.md`；每条摘录是一个 blockquote，下一行写保存时间与“跳回原文”链接（anchor），
// 批注作为普通段落写在 anchor 行之后、下一条摘录之前。
import { linkDestination } from './document';
import { emitFrontmatter } from './frontmatter';
import { t } from '@/shared/i18n';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** ISO 时间 → 本地时间 `YYYY-MM-DD HH:mm`（anchor 行开头）。 */
export function quoteTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * anchor 行：`YYYY-MM-DD HH:mm[ (n)] · [链接文字](`… 开头。数条数、判断批注区边界都用它。
 * 只看形状、不看链接文字（ALAG-7）：中文写的 `[跳回原文](` 与英文写的 `[Jump to source](` 都算。
 */
export const ANCHOR_LINE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: \(\d+\))? · \[[^\]\n]+\]\(/;

/** 文件里 anchor 行的条数，即摘录条数。 */
export function countQuoteEntries(md: string): number {
  return md.split('\n').filter((line) => ANCHOR_LINE.test(line)).length;
}

/**
 * 这一条的 anchor 行：`时间 · [跳回原文](链接)`。链接为片段链接，没有片段时为页面地址（都经 linkDestination）。
 * 文件里已有完全相同的一行时，在时间后加 ` (2)`、` (3)`……保证唯一。
 */
export function quoteAnchor(selectedAt: string, link: string, existing: string): string {
  const time = quoteTimestamp(selectedAt);
  // 链接文字取保存时的当前语言（ALAG-7）
  const tail = ` · [${t('file_jumpToSource')}](${linkDestination(link)})`;
  const lines = new Set(existing.split('\n'));
  let anchor = `${time}${tail}`;
  for (let n = 2; lines.has(anchor); n++) anchor = `${time} (${n})${tail}`;
  return anchor;
}

/** 一条摘录：Markdown 每行加 `> `（空行写 `>`），空一行，再接 anchor 行。不带结尾换行。 */
export function quoteEntryText(markdown: string, anchor: string): string {
  const quoted = markdown
    .trim()
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n');
  return `${quoted}\n\n${anchor}`;
}

export interface QuoteFileInput {
  /** 摘录文件的 id（frontmatter）。 */
  id: string;
  /** 规范化的页面地址。 */
  source: string;
  /** 页面标题。 */
  title: string;
  /** 第一条摘录的时间。 */
  captured: Date;
  /** 第一条摘录（quoteEntryText 的结果）。 */
  firstEntry: string;
}

/**
 * 新建摘录文件：frontmatter（medium quote，author、published 为空，extract full，与其他剪藏键集一致）、
 * `# 摘录 - 页面标题`、`[原文](出处)`、第一条摘录。以 `\n` 结尾。
 */
export function buildQuoteFile({ id, source, title, captured, firstEntry }: QuoteFileInput): string {
  const fm = emitFrontmatter({ id, source, medium: 'quote', title, author: '', published: '', captured, tags: [], note: '', extract: 'full' });
  const heading = `# ${t('file_quotesTitle', title.replace(/\s+/g, ' ').trim())}`;
  return `${fm}\n${heading}\n\n[${t('file_source')}](${linkDestination(source)})\n\n${firstEntry}\n`;
}

/** 追加一条：去掉原文末尾空白，接 `\n\n` 加这一条，以 `\n` 结尾。 */
export function appendQuoteEntry(md: string, entry: string): string {
  return `${md.replace(/\s+$/, '')}\n\n${entry}\n`;
}

/**
 * 改写一条摘录的批注：anchor 行（必须恰好一处，否则抛错）之后、到下一条摘录（下一个以 `> ` 开头的段落）或文件末尾之间是批注区。
 * 新批注非空（去掉空白后）→ 批注区换成 `\n\n` + 批注（去掉首尾空白，中间多行原样）；为空 → 去掉批注区。
 */
export function replaceQuoteNote(md: string, anchor: string, note: string): string {
  const lines = md.split('\n');
  const area = locateNoteArea(lines, anchor);
  // 摘录文件里找不到（或不止一处）这一条的 anchor 行
  if (!area) {
    const err = new Error(t('error_quoteEntryNotFound'));
    err.name = 'QuoteEntryNotFound';
    throw err;
  }
  const { at, next } = area;

  const head = lines.slice(0, at + 1).join('\n');
  // 首尾空白去掉（避免多出空行破坏版式），中间各行原样
  const noteBlock = note.trim() === '' ? '' : `\n\n${note.trim()}`;
  if (next === -1) return `${head}${noteBlock}\n`;
  return `${head}${noteBlock}\n\n${lines.slice(next).join('\n')}`;
}

/**
 * anchor 行（恰好一处）的位置，以及批注区之后下一条摘录的行号（没有为 -1）：
 * 下一条摘录是 anchor 之后第一个“前一行是空行、本行以 `> ` 开头（或就是 `>`）”的行。找不到或不唯一返回 null。
 */
function locateNoteArea(lines: string[], anchor: string): { at: number; next: number } | null {
  const hits = lines.flatMap((line, i) => (line === anchor ? [i] : []));
  const at = hits[0];
  if (hits.length !== 1 || at === undefined) return null;
  let next = -1;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if ((line.startsWith('> ') || line === '>') && (lines[i - 1] ?? '').trim() === '') {
      next = i;
      break;
    }
  }
  return { at, next };
}

/** 读一条摘录的批注：批注区内容（去首尾空白，没有批注区为空串）；anchor 找不到或不唯一返回 null。 */
export function readQuoteNote(md: string, anchor: string): string | null {
  const lines = md.split('\n');
  const area = locateNoteArea(lines, anchor);
  if (!area) return null;
  return lines.slice(area.at + 1, area.next === -1 ? lines.length : area.next).join('\n').trim();
}

/**
 * 纯文本转成不会被当作 Markdown 语法的文本（右键选中文字回退用）：
 * `\ ` * _ [ ] < > ~ |` 前加反斜杠；每行行首的 `#`、`-`、`+`、`数字串加 . 或 )` 也转义（行首的 `>` 已由上一条处理）；换行保留。
 */
export function escapeMarkdownText(text: string): string {
  return text
    .replace(/[\\`*_[\]<>~|]/g, '\\$&')
    .split('\n')
    .map((line) => line.replace(/^(\s*)(?:([#\-+])|(\d+)([.)]))/, (_m, space: string, mark: string | undefined, digits: string | undefined, dot: string | undefined) =>
      mark ? `${space}\\${mark}` : `${space}${digits}\\${dot}`,
    ))
    .join('\n');
}
