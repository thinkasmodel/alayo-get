// 页面内的摘录采集（ALAG-4 brief B §1）：取当前选区，转成 Markdown，生成文本片段链接。只在页面里运行（ADR-0004）。
import TurndownService from 'turndown';
import { generateFragmentFromRange } from 'text-fragments-polyfill/dist/fragment-generation-utils.js';
import { fragmentUrl } from '@/core/textFragment';
import { addTableRules } from './tables';
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

/** 选区公共祖先落在这些表格结构标签里时，cloneContents 不会带上 table 祖先。 */
const TABLE_STRUCTURE_TAGS = new Set(['TR', 'THEAD', 'TBODY', 'TFOOT', 'TABLE']);

/** 从节点往上收集全部 TABLE 祖先；文本节点从父元素开始。 */
function ancestorTables(node: Node): Element[] {
  const tables: Element[] = [];
  let element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  while (element) {
    if (element.tagName === 'TABLE') tables.push(element);
    element = element.parentElement;
  }
  return tables;
}

/** 表格自己的行：直接子 tr，或 thead/tbody/tfoot 的直接子 tr；不进嵌套表。 */
function ownRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    if (child.tagName === 'TR') {
      rows.push(child);
    } else if (child.tagName === 'THEAD' || child.tagName === 'TBODY' || child.tagName === 'TFOOT') {
      for (const row of Array.from(child.children)) {
        if (row.tagName === 'TR') rows.push(row);
      }
    }
  }
  return rows;
}

/** 表里没有内嵌表，且行内格子的 colspan/rowspan 属性只要存在就必须 parseInt 为 1。 */
function isSimpleTable(table: Element): boolean {
  if (table.querySelector('table')) return false;
  for (const row of ownRows(table)) {
    for (const cell of Array.from(row.children)) {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue;
      for (const name of ['colspan', 'rowspan']) {
        const raw = cell.getAttribute(name);
        if (raw !== null && Number.parseInt(raw, 10) !== 1) return false;
      }
    }
  }
  return true;
}

/**
 * 只有两端涉及的表格都简单、且都不在内嵌表里时才使用表格规则；A 为空时照旧使用。
 * 这里看原页面 DOM 的属性字符串，不用 cell.colSpan/rowSpan（浏览器会把非法值规范成 1）。
 */
function useTableRules(range: Range): boolean {
  const startTables = ancestorTables(range.startContainer);
  const endTables = ancestorTables(range.endContainer);
  if (startTables.length > 1 || endTables.length > 1) return false;
  const tables = new Set<Element>([...startTables, ...endTables]);
  for (const table of tables) {
    if (!isSimpleTable(table)) return false;
  }
  return true;
}

/**
 * 选区起止都在同一张表里时，逐层浅拷贝公共祖先到最近的 TABLE，把 cloneContents 丢掉的表格结构补回来。
 * 公共祖先是 TD/TH（选区在一格之内）或不在表里时原样返回。
 */
function wrapTableStructure(range: Range, content: Node, holder: Document): Node {
  const common = range.commonAncestorContainer;
  let ancestor = common.nodeType === 1 ? (common as Element) : common.parentElement;
  if (!ancestor || !TABLE_STRUCTURE_TAGS.has(ancestor.tagName)) return content;
  const chain: Element[] = [];
  while (ancestor) {
    chain.push(ancestor);
    if (ancestor.tagName === 'TABLE') break;
    ancestor = ancestor.parentElement;
  }
  // 表格结构标签理论上一定有 TABLE 祖先；没有就什么都不补。
  const outer = chain[chain.length - 1];
  if (!outer || outer.tagName !== 'TABLE') return content;
  let wrapped = content;
  for (const element of chain) {
    const wrapper = holder.importNode(element.cloneNode(false), false);
    wrapper.appendChild(wrapped);
    wrapped = wrapper;
  }
  return wrapped;
}

/**
 * 选区从一行中间开始时，cloneContents 会省略起点格子之前的格子；在最终内容里按文档顺序找第一个 TR，
 * 在它开头补同样标签的空格子。开头补格子的前提是表格规则已判定可用，此时 colspan 全为 1，只需数兄弟格子。
 * 起点不在格子里、或内容里没有 TR（例如选区在一格之内）时原样返回。
 */
function prependOmittedCells(range: Range, content: Node, holder: Document): Node {
  const start = range.startContainer;
  let cell = start.nodeType === 1 ? (start as Element) : start.parentElement;
  while (cell && cell.tagName !== 'TD' && cell.tagName !== 'TH') cell = cell.parentElement;
  if (!cell) return content;
  let missing = 0;
  for (let previous = cell.previousElementSibling; previous; previous = previous.previousElementSibling) {
    if (previous.tagName === 'TD' || previous.tagName === 'TH') missing += 1;
  }
  if (missing === 0 || (content.nodeType !== 1 && content.nodeType !== 11)) return content;
  const row = (content as ParentNode).querySelector('tr');
  if (!row) return content;
  const tag = cell.tagName.toLowerCase();
  for (let i = 0; i < missing; i += 1) {
    row.insertBefore(holder.createElement(tag), row.firstChild);
  }
  return content;
}

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
  const withTableRules = useTableRules(range);
  const holder = document.implementation.createHTMLDocument('');
  const container = holder.createElement('div');
  let content: Node = holder.importNode(range.cloneContents(), true);
  for (const ancestor of inlineFormatAncestors(range)) {
    const wrapper = holder.importNode(ancestor.cloneNode(false), false);
    wrapper.appendChild(content);
    content = wrapper;
  }
  content = wrapTableStructure(range, content, holder);
  if (withTableRules) content = prependOmittedCells(range, content, holder);
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
  if (withTableRules) addTableRules(turndown);
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
