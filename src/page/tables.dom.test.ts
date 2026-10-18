// ALAG-40 金样例：网页表格的 Markdown 输出。tests/fixtures/tables/ 是权威，逐个逐字节比对。
import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import bannersExpected from '../../tests/fixtures/tables/banners.expected.md?raw';
import bannersHtml from '../../tests/fixtures/tables/banners.html?raw';
import codeInCellExpected from '../../tests/fixtures/tables/code-in-cell.expected.md?raw';
import codeInCellHtml from '../../tests/fixtures/tables/code-in-cell.html?raw';
import layoutExpected from '../../tests/fixtures/tables/layout.expected.md?raw';
import layoutHtml from '../../tests/fixtures/tables/layout.html?raw';
import linebreaksExpected from '../../tests/fixtures/tables/linebreaks.expected.md?raw';
import linebreaksHtml from '../../tests/fixtures/tables/linebreaks.html?raw';
import mergedExpected from '../../tests/fixtures/tables/merged.expected.md?raw';
import mergedHtml from '../../tests/fixtures/tables/merged.html?raw';
import noHeaderExpected from '../../tests/fixtures/tables/no-header.expected.md?raw';
import noHeaderHtml from '../../tests/fixtures/tables/no-header.html?raw';
import raggedExpected from '../../tests/fixtures/tables/ragged.expected.md?raw';
import raggedHtml from '../../tests/fixtures/tables/ragged.html?raw';
import simpleExpected from '../../tests/fixtures/tables/simple.expected.md?raw';
import simpleHtml from '../../tests/fixtures/tables/simple.html?raw';
import singleColumnExpected from '../../tests/fixtures/tables/single-column.expected.md?raw';
import singleColumnHtml from '../../tests/fixtures/tables/single-column.html?raw';
import { addTableRules } from './tables';

/** 与 extract.ts / quote.ts 相同的 Turndown 配置。 */
function turndown(): TurndownService {
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  addTableRules(service);
  return service;
}

const CASES = [
  { name: 'banners', html: bannersHtml, expected: bannersExpected },
  { name: 'code-in-cell', html: codeInCellHtml, expected: codeInCellExpected },
  { name: 'layout', html: layoutHtml, expected: layoutExpected },
  { name: 'linebreaks', html: linebreaksHtml, expected: linebreaksExpected },
  { name: 'merged', html: mergedHtml, expected: mergedExpected },
  { name: 'no-header', html: noHeaderHtml, expected: noHeaderExpected },
  { name: 'ragged', html: raggedHtml, expected: raggedExpected },
  { name: 'simple', html: simpleHtml, expected: simpleExpected },
  { name: 'single-column', html: singleColumnHtml, expected: singleColumnExpected },
];

describe('addTableRules：金样例', () => {
  it.each(CASES)('$name：turndown(html) + 换行与 expected.md 逐字节相同', ({ html, expected }) => {
    expect(`${turndown().turndown(html)}\n`).toBe(expected);
  });
});

describe('addTableRules：rowspan="0"', () => {
  it('算合并单元格写成单行 HTML，并把 0 换算成本行组内到最后一个主体行的明确行数', () => {
    const html = [
      '<table><thead><tr><th>K</th><th>V</th></tr></thead>',
      '<tbody><tr><td rowspan="0">A</td><td>1</td></tr><tr><td>2</td></tr></tbody>',
      '<tfoot><tr><td>T</td><td>9</td></tr></tfoot></table>',
    ].join('');
    const md = turndown().turndown(html);
    expect(md).toBe(
      '<table><tr><th>K</th><th>V</th></tr><tr><td rowspan="2">A</td><td>1</td></tr><tr><td>2</td></tr><tr><td>T</td><td>9</td></tr></table>',
    );
    expect(md).not.toContain('rowspan="0"');
  });
});
