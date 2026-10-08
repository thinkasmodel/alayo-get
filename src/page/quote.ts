// 页面内的摘录采集（ALAG-4 brief B §1）：取当前选区，转成 Markdown，生成文本片段链接。只在页面里运行（ADR-0004）。
import TurndownService from 'turndown';
import { generateFragmentFromRange } from 'text-fragments-polyfill/dist/fragment-generation-utils.js';
import { fragmentUrl } from '@/core/textFragment';
import { t } from '@/shared/i18n';
import type { QuoteCaptureResponse } from '@/shared/messages';

function absolute(url: string | null, base: string): string {
  const value = (url ?? '').trim();
  if (value === '') return '';
  try {
    return new URL(value, base).href;
  } catch {
    return '';
  }
}

/** 选区在 input、textarea 里（焦点在其中）时，页面上的 Range 拿不到里面的文字。 */
function selectionInTextField(doc: Document): boolean {
  const active = doc.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
}

/** 取当前选区的第一个 Range；没有选区、选区为空或在输入框里时返回 null。 */
export function currentRange(doc: Document): Range | null {
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0 || selectionInTextField(doc)) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || range.toString().trim() === '') return null;
  return range;
}

/** 选区外面要原样包上的行内格式标签。 */
const INLINE_FORMAT_TAGS = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'S', 'DEL', 'MARK', 'SUB', 'SUP']);
/** 往上找祖先时在这些块级元素处停下。 */
const BLOCK_TAGS = new Set([
  'HTML', 'BODY', 'P', 'DIV', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'SECTION', 'ARTICLE', 'ASIDE', 'NAV', 'MAIN', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION', 'FORM', 'FIELDSET', 'DETAILS', 'HR',
]);

/** 选区所在的行内格式祖先（A、STRONG 等），从最内层到最外层；遇到块级元素或 body 停止。 */
function inlineFormatAncestors(range: Range): Element[] {
  const start = range.commonAncestorContainer;
  let node: Node | null = start instanceof Element ? start : start.parentElement;
  const found: Element[] = [];
  while (node instanceof Element) {
    // 遇到 PRE：把它作为最外层包裹并停止，Turndown 才会输出保留换行和缩进的围栏代码块
    if (node.tagName === 'PRE') {
      found.push(node);
      break;
    }
    if (BLOCK_TAGS.has(node.tagName)) break;
    if (INLINE_FORMAT_TAGS.has(node.tagName)) found.push(node);
    node = node.parentElement;
  }
  return found;
}

/**
 * 选区 → Markdown：cloneContents 外面按原样（浅拷贝，保留 href 等属性）包上选区所在的行内格式祖先，放进临时容器；
 * 链接 href（含包上的 <a>）与图片 src 按选区所在文档的 baseURI 转成绝对地址；
 * 图片换成链接文字 `[图片](地址)`（不下载）；再用与 extract.ts 相同配置的 Turndown 转换，去首尾空白。
 */
export function rangeToMarkdown(range: Range, pageUrl: string): string {
  const holder = document.implementation.createHTMLDocument('');
  const container = holder.createElement('div');
  let content: Node = holder.importNode(range.cloneContents(), true);
  for (const ancestor of inlineFormatAncestors(range)) {
    const wrapper = holder.importNode(ancestor.cloneNode(false), false);
    wrapper.appendChild(content);
    content = wrapper;
  }
  container.append(content);
  // 相对地址按选区所在文档的 baseURI（含 <base href>）解析；没有 <base>（baseURI 等于文档地址）时沿用传入的页面地址
  const ownerDoc = range.startContainer.ownerDocument;
  const baseUrl = ownerDoc && ownerDoc.baseURI !== ownerDoc.URL ? ownerDoc.baseURI : pageUrl;
  for (const a of container.querySelectorAll('a[href]')) {
    const abs = absolute(a.getAttribute('href'), baseUrl);
    if (abs) a.setAttribute('href', abs);
  }
  for (const img of container.querySelectorAll('img')) {
    const src = absolute(img.getAttribute('src'), baseUrl);
    if (src) {
      const link = holder.createElement('a');
      link.setAttribute('href', src);
      link.textContent = t('file_image');
      img.replaceWith(link);
    } else {
      img.remove();
    }
  }
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  return turndown.turndown(container).trim();
}

/** 按选区生成文本片段链接；生成不了（无效选区、有歧义、超时、出错）为 null。 */
export function rangeFragmentUrl(range: Range, pageUrl: string): string | null {
  try {
    // 传副本：polyfill 会改动传入的 Range，不能动页面真实选区
    const result = generateFragmentFromRange(range.cloneRange(), Date.now());
    if (result.status !== 0 || !result.fragment) return null;
    return fragmentUrl(pageUrl, result.fragment);
  } catch (err) {
    console.info('[Alayo Get] 没能生成文本片段链接', err);
    return null;
  }
}

/**
 * 处理 'capture-quote'：回传页面地址、标题与选区的摘录信息；取不到选区时 quote 为 null（后台改用右键菜单给的选中文字）。
 * pageUrl 缺省为 location.href（相对地址按它转成绝对地址，片段链接也接在它后面）。
 */
export function captureQuote(doc: Document = document, pageUrl: string = location.href): QuoteCaptureResponse {
  const title = doc.title;
  const range = currentRange(doc);
  if (!range) return { url: pageUrl, title, quote: null };
  const selectedAt = new Date().toISOString();
  return {
    url: pageUrl,
    title,
    quote: { markdown: rangeToMarkdown(range, pageUrl), fragmentUrl: rangeFragmentUrl(range, pageUrl), selectedAt },
  };
}
