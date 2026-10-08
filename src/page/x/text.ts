// X 正文（tweetText、引用正文）的 DOM 转 Markdown：t.co 还原、提及与话题补全地址、换行、转义（只在页面里运行）。
import TurndownService from 'turndown';
import { linkDestination } from '@/core/document';

/** t.co 地址 → 真实地址（来自 data-alayo-x.tco）。 */
export type TcoMap = Readonly<Record<string, string>>;

export const X_ORIGIN = 'https://x.com';

let turndown: TurndownService | null = null;

/**
 * 普通文本按 Turndown 的规则转义。它的行首规则只认整串开头，所以逐行转义；
 * 行首空白先拿出来再转义（排版时会去掉行首空白，`  - x` 不能因此变成列表项）。
 * 只用于普通文本，生成的链接、图片语法不经过这里。
 */
export function escapeText(text: string): string {
  turndown ??= new TurndownService();
  const td = turndown;
  return text
    .split('\n')
    .map((line) => {
      const lead = /^\s*/.exec(line)?.[0] ?? '';
      // Turndown 不管 `!`（会和后面的链接拼成图片）、`<`（HTML / 自动链接）、`&`（实体），补上反斜杠转义
      return lead + td.escape(line.slice(lead.length)).replace(/[!<&]/g, '\\$&');
    })
    .join('\n');
}

/** 放进链接文字、加粗里的短文本：转义会提前闭合或开启语法的字符；换行等空白合并成空格。 */
export function escapeInline(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/([\\`*_[\]<])/g, '\\$1');
}

/** `[文字](地址)`。 */
export function mdLink(text: string, url: string): string {
  return `[${escapeInline(text)}](${linkDestination(url)})`;
}

/** 站内相对地址补成 `https://x.com` 开头；`//host/…` 按 https 补全。 */
export function absoluteOnX(href: string): string {
  try {
    return new URL(href, `${X_ORIGIN}/`).href;
  } catch {
    return `${X_ORIGIN}${href}`;
  }
}

/** 地址去掉协议头，用作链接文字。 */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

/** 看得见的文字：文本节点加表情图片的 alt；不进 svg。 */
export function visibleText(el: Element): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    const e = node as Element;
    const tag = e.tagName.toLowerCase();
    if (tag === 'svg') return;
    if (tag === 'img') {
      out += e.getAttribute('alt') ?? '';
      return;
    }
    for (const c of e.childNodes) walk(c);
  };
  walk(el);
  return out;
}

/** 引用框里的链接是 `span[dir=ltr]`：第一个子节点是 aria-hidden 的 `http://` 或 `https://`。 */
function isSpanLink(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'span' || el.getAttribute('dir') !== 'ltr') return false;
  const first = el.firstElementChild;
  if (!first || first !== el.firstChild || first.getAttribute('aria-hidden') !== 'true') return false;
  const t = first.textContent ?? '';
  return t === 'https://' || t === 'http://';
}

/** textContent 去掉末尾的 `…`；以 http 开头才算地址。 */
function urlFromText(el: Element): string | null {
  const t = (el.textContent ?? '').trim().replace(/…$/, '');
  return /^https?:\/\/\S+$/i.test(t) ? t : null;
}

const MENTION_RE = /^\/([A-Za-z0-9_]{1,50})\/?$/;

/**
 * 正文里的一个链接元素转 Markdown；不是链接返回 null。
 * 外链还原顺序：t.co 映射 → textContent 去掉 `…` → 原 href。
 */
export function linkToMarkdown(el: Element, tco: TcoMap): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') {
    const href = el.getAttribute('href');
    if (href === null) return null;
    if (href.startsWith('/')) {
      if (href.startsWith('/hashtag/')) {
        const tag = visibleText(el).trim().replace(/^[#＃]/, '') || decodeURIComponent(href.slice(9).split('?')[0] ?? '');
        return mdLink(`#${tag}`, `${X_ORIGIN}/hashtag/${encodeURIComponent(tag)}`);
      }
      const mention = MENTION_RE.exec(href);
      if (mention?.[1]) return mdLink(`@${mention[1]}`, `${X_ORIGIN}/${mention[1]}`);
      const text = visibleText(el).trim();
      return mdLink(text || href, absoluteOnX(href));
    }
    const url = tco[href] ?? urlFromText(el) ?? href;
    return mdLink(displayUrl(url), url);
  }
  if (isSpanLink(el)) {
    const url = urlFromText(el);
    if (url) return mdLink(displayUrl(url), url);
  }
  return null;
}

/**
 * tweetText（或引用正文）转 Markdown：链接还原、文本转义。换行保持原样的 `\n`，
 * 排版时由 markdown.ts 的 paragraphs 统一处理（两个以上是分段，单个是硬换行）。
 */
export function tweetTextToMarkdown(el: Element, tco: TcoMap): string {
  let raw = '';
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      raw += escapeText(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== 1) return;
    const e = node as Element;
    const tag = e.tagName.toLowerCase();
    if (tag === 'svg') return;
    if (tag === 'br') {
      raw += '\n';
      return;
    }
    if (tag === 'img') {
      raw += escapeText(e.getAttribute('alt') ?? '');
      return;
    }
    const link = linkToMarkdown(e, tco);
    if (link !== null) {
      raw += link;
      return;
    }
    for (const c of e.childNodes) walk(c);
  };
  for (const c of el.childNodes) walk(c);
  return raw.trim();
}
