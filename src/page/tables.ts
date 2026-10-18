// 网页表格 → Markdown（ALAG-40）：普通数据表写 GFM；合并单元格、格内有块结构等 GFM 表达不了的
// 写清理过的单行 HTML；排版用的表照旧拆成段落。extract.ts 与 quote.ts 共用这一条规则。
import type TurndownService from 'turndown';

const CELL_TAGS = new Set(['TD', 'TH']);
const SECTION_TAGS = new Set(['THEAD', 'TBODY', 'TFOOT']);
const CAPTION_TAGS = new Set(['CAPTION']);
/**
 * 表格结构标签。它们两侧的空白在单行 HTML 里没有意义：源码换行缩进会变成多余空格，
 * 还可能撑出空行（Markdown 的 HTML 块遇空行结束）。
 */
const STRUCTURAL_TAGS = new Set([
  'TABLE', 'CAPTION', 'COLGROUP', 'COL', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
]);
/** HTML 表里每个元素只保留的属性。 */
const KEEP_ATTRIBUTES = new Set(['href', 'src', 'alt', 'colspan', 'rowspan']);
/** HTML 表里允许出现的元素；其余元素去标签留子节点。 */
const HTML_TABLE_KEEP_TAGS = new Set([
  'TABLE', 'TR', 'TD', 'TH', 'A', 'IMG', 'BR', 'P', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'INS',
  'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'SUB', 'SUP', 'SMALL', 'MARK', 'ABBR', 'CITE', 'Q', 'TIME',
  'SPAN', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR',
]);
/** 这些元素连内容一起删除，避免把脚本、表单、嵌入内容写进摘录。 */
const HTML_TABLE_DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'APPLET', 'SVG',
  'MATH', 'CANVAS', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'FORM', 'INPUT', 'BUTTON', 'SELECT',
  'TEXTAREA', 'OPTION', 'LINK', 'META', 'BASE',
]);
/** `href` 只留这几种协议（或页内锚点）；`src` 只留 http(s)。 */
const SAFE_HREF = /^(?:https?:|mailto:|#)/i;
const SAFE_SRC = /^https?:/i;
/** 白名单外的块级包装：没有块级子元素时换成 `<p>`，否则去标签留子节点。 */
const BLOCK_WRAPPER_TAGS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION',
  'ADDRESS', 'CENTER', 'DETAILS', 'SUMMARY', 'FIELDSET', 'LEGEND',
]);
/** 块级内容：出现这些直接子元素时，块级包装去标签而不是换成 `<p>`。 */
const BLOCK_CONTENT_TAGS = new Set([
  'P', 'UL', 'OL', 'DL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR',
]);
/** 格子里出现这些元素时，GFM 表格表达不了，改写成 HTML 表。 */
const BLOCK_IN_CELL = 'pre, blockquote, table, hr, h1, h2, h3, h4, h5, h6';
/** Turndown 的列表标记：`-   ` 与 `1.  ` 后面补齐到内容列的空格。 */
const LIST_MARKER = /^([ \t]*(?:-|\d+\.))[ \t]+/gm;
/** 含换行的连续空白；压成 `<br>`。 */
const NEWLINE_WHITESPACE = /[ \t\r\n]*\n[ \t\r\n]*/g;

/** 直接子元素里指定标签的那些。 */
function childrenWith(parent: Element, tags: Set<string>): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const child of Array.from(parent.children)) {
    if (tags.has(child.tagName)) found.push(child as HTMLElement);
  }
  return found;
}

/** 表格的行：直接子 `tr`，或 `thead`/`tbody`/`tfoot` 的直接子 `tr`；不进嵌套表。 */
function tableRows(table: Element): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const child of Array.from(table.children)) {
    if (child.tagName === 'TR') {
      rows.push(child as HTMLElement);
    } else if (SECTION_TAGS.has(child.tagName)) {
      for (const row of Array.from(child.children)) {
        if (row.tagName === 'TR') rows.push(row as HTMLElement);
      }
    }
  }
  return rows;
}

/** 行里的格子：直接子 `td`/`th`。 */
function rowCells(row: Element): HTMLElement[] {
  return childrenWith(row, CELL_TAGS);
}

/** `colspan` 的数值；缺省、非法或 ≤1 都按 1（HTML 规范里 colspan="0" 也是 1）。 */
function spanOf(cell: Element, name: string): number {
  const value = Number.parseInt(cell.getAttribute(name) ?? '', 10);
  return Number.isFinite(value) && value > 1 ? value : 1;
}

/** `rowspan` 的数值；0 合法（跨到所在行组末尾），缺省、非法或负数按 1。 */
function rowspanOf(cell: Element): number {
  const value = Number.parseInt(cell.getAttribute('rowspan') ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

/** 占位网格：整表列数，以及每行放格子前是否已有上面行的跨行占位延伸进来。 */
interface TableGrid {
  columns: number;
  incoming: boolean[];
}

/** 网格里的 colspan：非法或 ≤1 按 1，最大 1000（HTML 规范同值）。 */
function gridColspan(cell: Element): number {
  const value = Number.parseInt(cell.getAttribute('colspan') ?? '', 10);
  if (!Number.isFinite(value) || value <= 1) return 1;
  return Math.min(value, 1000);
}

/** 网格里的 rowspan：0 跨到行组末尾，>1 压到行组剩余行数，非法或负数按 1。 */
function gridRowspan(cell: Element, rowIndex: number, rows: HTMLElement[]): number {
  const raw = cell.getAttribute('rowspan');
  if (raw === null) return 1;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) return 1;
  const remaining = rowspanLimit(rowIndex, rows);
  if (value === 0) return remaining;
  if (value === 1) return 1;
  return Math.min(value, remaining);
}

/** 按 HTML 表格模型逐行放格子：跳过上面行跨行占住的列位，再占 colspan 列、rowspan 行。 */
function buildTableGrid(rows: HTMLElement[]): TableGrid {
  const occupied: boolean[][] = Array.from({ length: rows.length }, () => []);
  const incoming = new Array<boolean>(rows.length).fill(false);
  let columns = 0;
  rows.forEach((row, rowIndex) => {
    const slots = occupied[rowIndex];
    if (!slots) return;
    incoming[rowIndex] = slots.some(Boolean);
    let col = 0;
    for (const cell of rowCells(row)) {
      while (slots[col]) col += 1;
      const colspan = gridColspan(cell);
      const rowspan = gridRowspan(cell, rowIndex, rows);
      for (let dr = 0; dr < rowspan && rowIndex + dr < rows.length; dr += 1) {
        const target = occupied[rowIndex + dr];
        if (!target) continue;
        for (let dc = 0; dc < colspan; dc += 1) target[col + dc] = true;
      }
      col += colspan;
      columns = Math.max(columns, col);
    }
  });
  return { columns, incoming };
}

/** 通栏行：只有一个格子、本行没有上面行的跨行占位，且该格 colspan（封顶后）覆盖整表列数。 */
function isBannerRow(row: Element, rowIndex: number, grid: TableGrid): boolean {
  if (grid.columns <= 1 || grid.incoming[rowIndex]) return false;
  const cells = rowCells(row);
  return cells.length === 1 && gridColspan(cells[0] as Element) >= grid.columns;
}

/** 排版表：里面套着表格、主体行只有一格、或主体行不超过一行。 */
function isLayoutTable(table: Element, bodyRows: HTMLElement[]): boolean {
  if (table.querySelector('table')) return true;
  if (bodyRows.length <= 1) return true;
  let cells = 0;
  for (const row of bodyRows) cells += rowCells(row).length;
  return cells <= 1;
}

/** 主体行要不要写成 HTML：有合并单元格，或格子里有 GFM 表达不了的块结构。 */
function needsHtmlTable(bodyRows: HTMLElement[]): boolean {
  for (const row of bodyRows) {
    for (const cell of rowCells(row)) {
      const rowspan = rowspanOf(cell);
      if (spanOf(cell, 'colspan') > 1 || rowspan === 0 || rowspan > 1) return true;
      if (cell.querySelector(BLOCK_IN_CELL)) return true;
    }
  }
  return false;
}

/** 通栏行 / caption 转成一个普通段落；空的不写。 */
function paragraphOf(turndown: TurndownService, html: string, collapseLines: boolean): string {
  let text = turndown.turndown(html);
  if (collapseLines) text = text.replace(/\s*\n\s*/g, ' ');
  return text.trim();
}

/** GFM 表格的一个格子：列表标记收紧、换行压成 `<br>`、`|` 转义。 */
function gfmCell(turndown: TurndownService, cell: HTMLElement): string {
  let text = turndown.turndown(cell.innerHTML);
  text = text.replace(LIST_MARKER, '$1 ');
  text = text.replace(NEWLINE_WHITESPACE, '<br>');
  text = text.replace(/\|/g, '\\|');
  text = text.trim();
  return text === '' ? ' ' : text;
}

/** 补齐到列数：短行多出来的格子写一个空格。 */
function padCells(cells: string[], width: number): string[] {
  const padded: string[] = [];
  for (let i = 0; i < width; i += 1) padded.push(cells[i] ?? ' ');
  return padded;
}

function formatRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

/** 主体行 → GFM 表格。第一行在 `thead` 里或全是 `th` 就作表头，否则补一行空表头。 */
function gfmTable(turndown: TurndownService, bodyRows: HTMLElement[]): string {
  const converted = bodyRows.map((row) => rowCells(row).map((cell) => gfmCell(turndown, cell)));
  let width = 0;
  for (const cells of converted) width = Math.max(width, cells.length);

  const first = bodyRows[0];
  const firstCells = first ? rowCells(first) : [];
  const hasHeader = !!first && firstCells.length > 0
    && (first.parentElement?.tagName === 'THEAD' || firstCells.every((cell) => cell.tagName === 'TH'));

  const lines: string[] = [];
  lines.push(formatRow(padCells(hasHeader ? (converted[0] ?? []) : [], width)));
  lines.push(formatRow(new Array<string>(width).fill('---')));
  for (const cells of converted.slice(hasHeader ? 1 : 0)) lines.push(formatRow(padCells(cells, width)));
  return lines.join('\n');
}

/** 去掉元素标签，把子节点挪到原位置。 */
function unwrapElement(element: Element): void {
  element.replaceWith(...Array.from(element.childNodes));
}

/** 把元素换成 `<p>`，子节点原样保留。 */
function replaceWithParagraph(element: Element): void {
  const paragraph = element.ownerDocument.createElement('p');
  while (element.firstChild) paragraph.appendChild(element.firstChild);
  element.replaceWith(paragraph);
}

/** 节点是不是块级内容（标签在 `BLOCK_CONTENT_TAGS` 里的元素）。 */
function isBlockNode(node: Node): boolean {
  return node.nodeType === 1 && BLOCK_CONTENT_TAGS.has((node as Element).tagName);
}

/** 只由空白文本组成的段：不包 `<p>`，原样留着。 */
function isWhitespaceRun(nodes: Node[]): boolean {
  return nodes.every((node) => node.nodeType === 3 && /^\s*$/.test((node as Text).data));
}

/** 把块级包装里连续的非块级节点各自包进 `<p>`，保留裸文字与行内元素自己的段落边界。 */
function wrapNonBlockRuns(element: Element): void {
  let run: Node[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    if (!isWhitespaceRun(run)) {
      const paragraph = element.ownerDocument.createElement('p');
      run[0]?.parentNode?.insertBefore(paragraph, run[0]);
      for (const node of run) paragraph.appendChild(node);
    }
    run = [];
  };
  for (const child of Array.from(element.childNodes)) {
    if (isBlockNode(child)) flush();
    else run.push(child);
  }
  flush();
}

/** 先删危险元素，再处理白名单外元素；只用于写成 HTML 的表格。 */
function stripUnsafeElements(root: Element): void {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (HTML_TABLE_DROP_TAGS.has(element.tagName)) element.remove();
  }
  // 从内到外处理：块级包装里的块级子元素先变成最终的 P / 或被展开。
  for (const element of Array.from(root.querySelectorAll('*')).reverse()) {
    if (HTML_TABLE_KEEP_TAGS.has(element.tagName)) continue;
    if (!BLOCK_WRAPPER_TAGS.has(element.tagName)) {
      unwrapElement(element);
      continue;
    }
    const hasBlockChild = Array.from(element.children).some((child) => BLOCK_CONTENT_TAGS.has(child.tagName));
    if (hasBlockChild) {
      wrapNonBlockRuns(element);
      unwrapElement(element);
    } else {
      replaceWithParagraph(element);
    }
  }
}

/** 属性只留白名单；`href`/`src` 只留安全协议，删掉 `src` 的 `img` 整个移除。 */
function sanitizeAttributes(root: Element): void {
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (!KEEP_ATTRIBUTES.has(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    }
    const href = element.getAttribute('href');
    if (href !== null && !SAFE_HREF.test(href.trim())) element.removeAttribute('href');
    const src = element.getAttribute('src');
    if (src !== null && !SAFE_SRC.test(src.trim())) element.removeAttribute('src');
  }
  for (const img of Array.from(root.querySelectorAll('img'))) {
    if (!img.hasAttribute('src')) img.remove();
  }
}

/**
 * 单行 HTML 的空白清理：`pre` 原样保留（换行稍后写成 `&#10;`）；其他含换行的空白压成一个空格；
 * 结构标签两侧的空白去掉；其他标签之间的空格保留（`<a>A</a> <a>B</a>` 的空格不能丢）。
 */
function cleanWhitespace(element: Element): void {
  if (element.tagName === 'PRE') return;
  const structuralParent = STRUCTURAL_TAGS.has(element.tagName);
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      const text = child as Text;
      let data = text.data.replace(NEWLINE_WHITESPACE, ' ');
      const prev = text.previousSibling;
      const next = text.nextSibling;
      const prevStructural = prev !== null && prev.nodeType === 1 && STRUCTURAL_TAGS.has((prev as Element).tagName);
      const nextStructural = next !== null && next.nodeType === 1 && STRUCTURAL_TAGS.has((next as Element).tagName);
      if ((prev === null && structuralParent) || prevStructural) data = data.replace(/^[ \t]+/, '');
      if ((next === null && structuralParent) || nextStructural) data = data.replace(/[ \t]+$/, '');
      if (data === '') element.removeChild(text);
      else if (data !== text.data) text.data = data;
    } else if (child.nodeType === 1) {
      cleanWhitespace(child as Element);
    }
  }
}

/** 整张表写成一行：`pre` 内的换行写成 `&#10;`，其余换行不应存在，保险起见压成空格。 */
function singleLineHtml(html: string): string {
  const withPre = html.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (pre) => pre.replace(/\r?\n/g, '&#10;'));
  return withPre.replace(/[\r\n]+/g, ' ');
}

/** 跨行上限：从本行到原行组最后一个主体行（没有行组时整张表）的行数。 */
function rowspanLimit(rowIndex: number, bodyRows: HTMLElement[]): number {
  const group = bodyRows[rowIndex]?.parentElement;
  const inSection = !!group && SECTION_TAGS.has(group.tagName);
  let last = rowIndex;
  for (let i = rowIndex; i < bodyRows.length; i += 1) {
    if (!inSection || bodyRows[i]?.parentElement === group) last = i;
  }
  return last - rowIndex + 1;
}

/** 主体行 → 清理过的单行 HTML：新建 table，只放主体行，不保留原来的 thead/tbody/tfoot。 */
function htmlTable(table: HTMLElement, bodyRows: HTMLElement[]): string {
  const shell = table.ownerDocument.createElement('table');
  bodyRows.forEach((row, rowIndex) => {
    const clone = row.cloneNode(true) as HTMLElement;
    const cells = rowCells(row);
    const clonedCells = rowCells(clone);
    const limit = rowspanLimit(rowIndex, bodyRows);
    cells.forEach((cell, cellIndex) => {
      const cloned = clonedCells[cellIndex];
      if (!cloned) return;
      const declared = rowspanOf(cell);
      if (declared === 1) return;
      // 0 表示跨到行组末尾，按上限算；超过上限的显式值也压到本行组末尾。
      const resolved = Math.min(declared === 0 ? Number.POSITIVE_INFINITY : declared, limit);
      if (resolved <= 1) cloned.removeAttribute('rowspan');
      else cloned.setAttribute('rowspan', String(resolved));
    });
    shell.appendChild(clone);
  });
  stripUnsafeElements(shell);
  sanitizeAttributes(shell);
  cleanWhitespace(shell);
  return singleLineHtml(shell.outerHTML);
}

/** `table` 元素的转换规则。 */
function convertTable(turndown: TurndownService, content: string, table: HTMLElement): string {
  const rows = tableRows(table);
  const grid = buildTableGrid(rows);

  // 首尾通栏行：只有多列表格才有「通栏」可言。
  let start = 0;
  let end = rows.length;
  if (grid.columns > 1) {
    while (start < rows.length && isBannerRow(rows[start] as Element, start, grid)) start += 1;
    while (end > start && isBannerRow(rows[end - 1] as Element, end - 1, grid)) end -= 1;
  }
  const leading = rows.slice(0, start);
  const body = rows.slice(start, end);
  const trailing = rows.slice(end);

  // 排版表保持原行为（一格一段）。
  if (isLayoutTable(table, body)) return `\n\n${content}\n\n`;

  const blocks: string[] = [];
  const caption = childrenWith(table, CAPTION_TAGS)[0];
  if (caption) {
    const text = paragraphOf(turndown, caption.innerHTML, true);
    if (text !== '') blocks.push(text);
  }
  for (const row of leading) {
    const text = paragraphOf(turndown, row.innerHTML, false);
    if (text !== '') blocks.push(text);
  }

  blocks.push(needsHtmlTable(body) ? htmlTable(table, body) : gfmTable(turndown, body));

  for (const row of trailing) {
    const text = paragraphOf(turndown, row.innerHTML, false);
    if (text !== '') blocks.push(text);
  }

  if (blocks.length === 0) return '';
  return `\n\n${blocks.join('\n\n')}\n\n`;
}

/** 给 Turndown 加上网页表格规则；网页剪藏与摘录共用。 */
export function addTableRules(turndown: TurndownService): void {
  turndown.addRule('table', {
    filter: 'table',
    replacement: (content, node) => convertTable(turndown, content, node),
  });
}
