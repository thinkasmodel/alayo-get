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

/** 表格列数：各行格子 `colspan` 之和的最大值。 */
function columnCount(rows: HTMLElement[]): number {
  let columns = 0;
  for (const row of rows) {
    let count = 0;
    for (const cell of rowCells(row)) count += spanOf(cell, 'colspan');
    columns = Math.max(columns, count);
  }
  return columns;
}

/** 通栏行：只有一个格子，且该格 `colspan` 覆盖整张表。 */
function isBannerRow(row: Element, columns: number): boolean {
  const cells = rowCells(row);
  return cells.length === 1 && spanOf(cells[0] as Element, 'colspan') >= columns;
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

/** 去掉除 `href`/`src`/`alt`/`colspan`/`rowspan` 外的所有属性（含表格自身）。 */
function stripAttributes(root: Element): void {
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (!KEEP_ATTRIBUTES.has(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    }
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

/** `rowspan="0"` 换算成明确行数：从本行到原行组最后一个主体行（没有行组时整张表）的行数。 */
function zeroRowspanLength(rowIndex: number, bodyRows: HTMLElement[]): number {
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
    const length = zeroRowspanLength(rowIndex, bodyRows);
    cells.forEach((cell, cellIndex) => {
      const cloned = clonedCells[cellIndex];
      if (cloned && rowspanOf(cell) === 0) cloned.setAttribute('rowspan', String(length));
    });
    shell.appendChild(clone);
  });
  stripAttributes(shell);
  cleanWhitespace(shell);
  return singleLineHtml(shell.outerHTML);
}

/** `table` 元素的转换规则。 */
function convertTable(turndown: TurndownService, content: string, table: HTMLElement): string {
  const rows = tableRows(table);
  const columns = columnCount(rows);

  // 首尾通栏行：只有多列表格才有「通栏」可言。
  let start = 0;
  let end = rows.length;
  if (columns > 1) {
    while (start < rows.length && isBannerRow(rows[start] as Element, columns)) start += 1;
    while (end > start && isBannerRow(rows[end - 1] as Element, columns)) end -= 1;
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
