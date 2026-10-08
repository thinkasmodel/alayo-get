// X 长文（Articles）正文转 Markdown：只转 longformRichTextComponent（Draft.js 结构），前面加封面。
// 一级标题由 buildArticleMarkdown 写（长文标题），正文里的标题一律从 ## 起。
import { linkDestination } from '@/core/document';
import { largeImage, parsePost, TWEET } from './cells';
import { embeddedPostToMarkdown, paragraphs } from './markdown';
import { absoluteOnX, escapeText, linkToMarkdown, type TcoMap } from './text';

export const READ_VIEW = '[data-testid="twitterArticleReadView"]';
const TITLE = '[data-testid="twitter-article-title"]';
const BODY = '[data-testid="longformRichTextComponent"]';
const PHOTO_IMG = '[data-testid="tweetPhoto"] img';

/** 长文 read view 里的标题、封面和正文元素。 */
export interface LongformParts {
  title: string;
  /** 标题之前那张 tweetPhoto 图片（name=large）；没有为空串 */
  cover: string;
  body: Element | null;
}

export function longformParts(readView: Element): LongformParts {
  const titleEl = readView.querySelector(TITLE);
  const body = readView.querySelector(BODY);
  let cover = '';
  for (const img of readView.querySelectorAll(PHOTO_IMG)) {
    if (body?.contains(img)) continue;
    // 只认标题之前的那张
    if (titleEl && !(titleEl.compareDocumentPosition(img) & 2) /* DOCUMENT_POSITION_PRECEDING */) continue;
    cover = largeImage(img.getAttribute('src') ?? '');
    break;
  }
  return { title: (titleEl?.textContent ?? '').replace(/\s+/g, ' ').trim(), cover, body };
}

/** 行内样式：加粗、斜体（Draft.js 用带 style 的 span，也兼容 b / strong / i / em）。 */
function inlineStyle(el: Element): { bold: boolean; italic: boolean } {
  const tag = el.tagName.toLowerCase();
  const style = (el.getAttribute('style') ?? '').toLowerCase();
  return {
    bold: tag === 'b' || tag === 'strong' || /font-weight:\s*(bold|[6-9]00)/.test(style),
    italic: tag === 'i' || tag === 'em' || /font-style:\s*italic/.test(style),
  };
}

/** 包上强调标记；首尾空白挪到标记外面（`** a**` 不成立）。 */
function wrap(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  const [, lead = '', core = '', trail = ''] = m ?? [];
  return core === '' ? inner : `${lead}${mark}${core}${mark}${trail}`;
}

/** 块内行内内容转 Markdown（换行还是原样的 `\n`，由 paragraphs 处理）。 */
function inline(node: Node, tco: TcoMap): string {
  if (node.nodeType === 3) return escapeText(node.textContent ?? '');
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'svg') return '';
  if (tag === 'br') return '\n';
  if (tag === 'img') return escapeText(el.getAttribute('alt') ?? '');
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    const text = [...el.childNodes].map((c) => inline(c, tco)).join('').replace(/\s+/g, ' ').trim();
    // 站内相对链接补成 https://x.com 开头（`//host` 这种协议相对地址按页面协议补全）
    if (href.startsWith('/')) return text ? `[${text}](${linkDestination(absoluteOnX(href))})` : '';
    if (/^https:\/\/t\.co\//.test(href)) {
      const url = tco[href];
      if (url) return `[${text || url}](${linkDestination(url)})`;
      return linkToMarkdown(el, tco) ?? text;
    }
    if (/^https?:\/\//i.test(href)) return `[${text || href}](${linkDestination(href)})`;
    return text;
  }
  const inner = [...el.childNodes].map((c) => inline(c, tco)).join('');
  const { bold, italic } = inlineStyle(el);
  if (bold && italic) return wrap(inner, '***');
  if (bold) return wrap(inner, '**');
  if (italic) return wrap(inner, '*');
  return inner;
}

function blockText(el: Element, tco: TcoMap): string {
  return paragraphs([...el.childNodes].map((c) => inline(c, tco)).join(''));
}

/** 围栏代码块；围栏比代码里最长的反引号串长一截。 */
function fenced(code: string, lang: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${code.replace(/\n$/, '')}\n${fence}`;
}

function codeLanguage(code: Element | null): string {
  const m = /(?:^|\s)language-([\w+#.-]+)/.exec(code?.getAttribute('class') ?? '');
  return m?.[1] ?? '';
}

/** section 块：嵌入帖子、代码、图片、分隔线。 */
/** 长文转换时顺带统计的数据。 */
export interface LongformStats {
  /** 被截断的嵌入帖条数：嵌入帖本身或它的引用被截断就算 1 条（口径同作者串） */
  truncated: number;
}

function sectionToMarkdown(section: Element, stats: LongformStats): string {
  const article = section.querySelector(TWEET);
  if (article) {
    const post = parsePost(article);
    if (!post) return '';
    if (post.truncated || post.quote?.truncated) stats.truncated++;
    return embeddedPostToMarkdown(post);
  }
  const pre = section.querySelector('pre');
  if (pre) {
    const code = pre.querySelector('code');
    return fenced((code ?? pre).textContent ?? '', codeLanguage(code));
  }
  const images = [...section.querySelectorAll(PHOTO_IMG)]
    .map((img) => img.getAttribute('src') ?? '')
    .filter((src) => /^https?:\/\//i.test(src))
    .map((src) => `![](${linkDestination(largeImage(src))})`);
  if (images.length > 0) return images.join('\n\n');
  if (section.querySelector('[role="separator"]')) return '---';
  return '';
}

function headingLevel(el: Element): number {
  const tag = el.tagName.toLowerCase();
  const cls = el.getAttribute('class') ?? '';
  if (tag === 'h1' || tag === 'h2' || /\blongform-header-(one|two)\b/.test(cls)) return 2;
  if (tag === 'h3' || /\blongform-header-three\b/.test(cls)) return 3;
  return 0;
}

/** Draft.js 的列表缩进：`public-DraftStyleDefault-depthN`。 */
function listDepth(li: Element): number {
  const m = /public-DraftStyleDefault-depth(\d)/.exec(li.getAttribute('class') ?? '');
  return m?.[1] ? Number(m[1]) : 0;
}

/** 长文正文（longformRichTextComponent）转 Markdown；封面不在这里加。 */
export function longformToMarkdown(body: Element, tco: TcoMap, stats: LongformStats = { truncated: 0 }): string {
  const blocks = [...body.querySelectorAll('[data-block="true"]')].filter((b) => !b.parentElement?.closest('[data-block="true"]'));
  const out: string[] = [];
  /**
   * 连续的列表项（不论属于哪个 ul / ol）写成一组。levels[d] 是第 d 层最近一项：
   * 缩进、标记宽度、序号、是否有序。第 d 层的缩进等于第 d-1 层的缩进加它的标记宽度（父项内容起始列）。
   */
  let list: { lines: string[]; levels: { indent: number; width: number; n: number; ordered: boolean }[] } | null = null;
  const flushList = () => {
    if (list && list.lines.length > 0) out.push(list.lines.join('\n'));
    list = null;
  };

  for (const block of blocks) {
    const tag = block.tagName.toLowerCase();
    if (tag === 'li') {
      list ??= { lines: [], levels: [] };
      const current: NonNullable<typeof list> = list;
      const ordered = block.parentElement?.tagName.toLowerCase() === 'ol';
      // 缺了中间层（depth 跳级）时，挂到现有最深一层下面
      const depth = Math.min(listDepth(block), current.levels.length);
      const up = current.levels[depth - 1];
      const indent = up ? up.indent + up.width : 0;
      const prev = current.levels[depth];
      // 同一层上一项也是有序时接着编号（Draft.js 的子列表把父列表拆成多个 ol 元素，编号仍连续）；
      // 带 public-DraftStyleDefault-reset 的项是新列表的开头，从 1 开始
      const reset = /\bpublic-DraftStyleDefault-reset\b/.test(block.getAttribute('class') ?? '');
      const n = prev && prev.ordered && ordered && !reset ? prev.n + 1 : 1;
      const marker = ordered ? `${n}. ` : '- ';
      current.levels.length = depth;
      current.levels.push({ indent, width: marker.length, n, ordered });
      const pad = ' '.repeat(indent);
      const text = blockText(block, tco).replace(/\n/g, `\n${pad}${' '.repeat(marker.length)}`);
      if (text !== '') current.lines.push(`${pad}${marker}${text}`);
      continue;
    }
    flushList();

    if (tag === 'section') {
      const md = sectionToMarkdown(block, stats);
      if (md !== '') out.push(md);
      continue;
    }
    const text = blockText(block, tco);
    if (text === '') continue;
    const level = headingLevel(block);
    if (level > 0) {
      out.push(`${'#'.repeat(level)} ${text.replace(/\\?\n/g, ' ')}`);
    } else if (tag === 'blockquote' || /\blongform-blockquote\b/.test(block.getAttribute('class') ?? '')) {
      out.push(
        text
          .split('\n')
          .map((line) => (line === '' ? '>' : `> ${line}`))
          .join('\n'),
      );
    } else {
      out.push(text);
    }
  }
  flushList();
  return out.join('\n\n');
}

/** 长文的正文：封面 + 正文，以及被截断的嵌入帖条数。 */
export function articleToMarkdown(readView: Element, tco: TcoMap): { title: string; markdown: string; truncated: number } {
  const { title, cover, body } = longformParts(readView);
  const parts: string[] = [];
  const stats: LongformStats = { truncated: 0 };
  if (cover) parts.push(`![](${linkDestination(cover)})`);
  if (body) {
    const md = longformToMarkdown(body, tco, stats);
    if (md !== '') parts.push(md);
  }
  return { title, markdown: parts.join('\n\n'), truncated: stats.truncated };
}
