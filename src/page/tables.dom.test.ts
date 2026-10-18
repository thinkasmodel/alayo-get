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

  it('超过原行组末尾的显式 rowspan 压到组内，结果为 1 时删掉属性', () => {
    const html = [
      '<table><thead><tr><th rowspan="2">K</th><th colspan="2">V</th></tr></thead>',
      '<tbody><tr><td>a</td><td>1</td><td>2</td></tr><tr><td>b</td><td>3</td><td>4</td></tr></tbody></table>',
    ].join('');
    expect(turndown().turndown(html)).toBe(
      '<table><tr><th>K</th><th colspan="2">V</th></tr><tr><td>a</td><td>1</td><td>2</td></tr><tr><td>b</td><td>3</td><td>4</td></tr></table>',
    );
  });
});

describe('addTableRules：HTML 表元素与地址白名单', () => {
  it('脚本、样式、嵌入与表单元素连内容一起删除', () => {
    const md = turndown().turndown(
      [
        '<table><tr><td rowspan="2">A</td><td>',
        '<script>alert(1)</script><style>td{}</style>',
        '<iframe src="https://a.example/"></iframe><button>x</button>T',
        '</td></tr><tr><td>B</td></tr></table>',
      ].join(''),
    );
    expect(md).not.toContain('script');
    expect(md).not.toContain('alert');
    expect(md).not.toContain('style');
    expect(md).not.toContain('iframe');
    expect(md).not.toContain('button');
    expect(md).toContain('>T<');
  });

  it('白名单外的元素去标签留文字', () => {
    const md = turndown().turndown(
      '<table><tr><td rowspan="2"><span><font>Text</font></span><div>D</div></td><td>1</td></tr><tr><td>2</td></tr></table>',
    );
    expect(md).toContain('<span>Text</span><p>D</p>');
    expect(md).not.toContain('<font');
    expect(md).not.toContain('<div');
  });

  it('链接只留 http(s)/mailto/#，图片只留 http(s)，删掉 src 的 img 整个移除', () => {
    const md = turndown().turndown(
      [
        '<table><tr><td rowspan="2">',
        '<a href="javascript:alert(1)">J</a><a href="https://a.example/">H</a>',
        '<img src="data:image/png;base64,AAAA" alt="d"><img src="https://a.example/i.png" alt="i">',
        '</td><td>1</td></tr><tr><td>2</td></tr></table>',
      ].join(''),
    );
    expect(md).toContain('<a>J</a>');
    expect(md).toContain('<a href="https://a.example/">H</a>');
    expect(md).not.toContain('data:image');
    expect(md).not.toContain('alt="d"');
    expect(md).toContain('<img src="https://a.example/i.png" alt="i">');
  });
});

describe('addTableRules：块级包装保留段落边界', () => {
  it('没有块级子元素的 div 换成 p，两个 div 不会粘成一段', () => {
    const md = turndown().turndown(
      '<table><tr><td rowspan="2"><div>First</div><div>Second</div></td><td>1</td></tr><tr><td>2</td></tr></table>',
    );
    expect(md).toContain('<p>First</p><p>Second</p>');
  });

  it('已经有块级子元素的 div 只去标签，内部段落原样保留', () => {
    const md = turndown().turndown(
      '<table><tr><td rowspan="2"><div><p>A</p><p>B</p></div></td><td>1</td></tr><tr><td>2</td></tr></table>',
    );
    expect(md).toContain('<p>A</p><p>B</p>');
  });

  it('有块级子元素且混有裸文字：每段连续非块级节点各包一个 p', () => {
    const md = turndown().turndown(
      '<table><tr><td rowspan="2"><div><p>First</p>tail one</div><div>head two<p>Last</p></div></td><td>1</td></tr><tr><td>2</td></tr></table>',
    );
    expect(md).toContain('<p>First</p><p>tail one</p><p>head two</p><p>Last</p>');
  });
});

describe('addTableRules：跨行占位计入列数与通栏判定', () => {
  it('上面行的 rowspan 决定列数，末尾 colspan=2 不再误判为通栏行', () => {
    const md = turndown().turndown(
      '<table><tr><td rowspan="3">A</td><td>B</td></tr><tr><td>D</td></tr><tr><td colspan="2">C</td></tr></table>',
    );
    expect(md).toBe(
      '<table><tr><td rowspan="3">A</td><td>B</td></tr><tr><td>D</td></tr><tr><td colspan="2">C</td></tr></table>',
    );
    // C 仍在表格里，没有被移到表外写成单独段落
    expect(md.split('\n').filter((line) => line.trim() === 'C')).toEqual([]);
  });

  it('超大 colspan 封顶后仍识别为通栏首行并移到表外', () => {
    const md = turndown().turndown(
      '<table><tr><td colspan="100000">Header</td></tr><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>',
    );
    expect(md).toContain('Header\n\n|   |   |');
    expect(md).toContain('| A | B |');
    expect(md).toContain('| C | D |');
  });
});
