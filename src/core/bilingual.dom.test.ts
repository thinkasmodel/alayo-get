import { describe, expect, it } from 'vitest';
import TurndownService from 'turndown';
import bannersHtml from '../../tests/fixtures/tables/banners.html?raw';
import mergedHtml from '../../tests/fixtures/tables/merged.html?raw';
import simpleHtml from '../../tests/fixtures/tables/simple.html?raw';
import { addTableRules } from '@/page/tables';
import { applyTranslations, planBilingual, renderTranslation, type Unit } from './bilingual';

// 与 src/page/extract.ts 相同的 Turndown 配置；这里用它的实际输出验证列表/引用里的代码块。
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });

const SOURCE = 'https://example.com/x';

function withFrontmatter(body: string): string {
  return `---\nid: "01TEST"\nsource: "${SOURCE}"\nmedium: "web"\ntitle: "T"\nauthor: ""\npublished: ""\ncaptured: "2026-10-18T00:00:00.000Z"\nsite: "example.com"\ntags: []\nnote: ""\nextract: "full"\n---\n\n${body}\n`;
}

function bodyOf(md: string): string {
  return md.slice(md.indexOf('\n---\n') + 5);
}

function itemsFor(plan: ReturnType<typeof planBilingual>, table: Record<string, string>) {
  return plan.units.map((unit: Unit) => ({
    unit,
    lines: renderTranslation(
      unit,
      unit.segmentIndexes.map((index) => table[plan.segments[index] ?? ''] ?? ''),
      'zh',
    ),
  }));
}

describe('planBilingual：Turndown 实际输出里的代码块（续修 3A）', () => {
  it('引用块里跨空行的 fenced code 整块不翻，写回后逐字节不变', () => {
    const body = turndown.turndown(
      '<p>Outside paragraph.</p><blockquote><pre><code>const first = 1;\n\nconst second = 2;</code></pre></blockquote><p>After paragraph.</p>',
    );
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['Outside paragraph.', 'After paragraph.']);

    const codeBlock = '> ```\n> const first = 1;\n> \n> const second = 2;\n> ```';
    expect(md).toContain(codeBlock);
    const result = applyTranslations(
      md,
      itemsFor(plan, { 'Outside paragraph.': '外面。', 'After paragraph.': '后面。' }),
      'web',
    );
    expect(result.missing).toEqual([]);
    expect(result.md).toContain(codeBlock);
    expect(result.md).toContain('外面。');
    expect(result.md).toContain('后面。');
  });

  it('列表项里缩进到内容列、跨空行的 fenced code 整块不翻', () => {
    const body = turndown.turndown(
      '<ul><li>Item text<pre><code>const first = 1;\n\nconst second = 2;</code></pre></li></ul>',
    );
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['Item text']);

    const codeBlock = '    ```\n    const first = 1;\n    \n    const second = 2;\n    ```';
    expect(md).toContain(codeBlock);
    const result = applyTranslations(md, itemsFor(plan, { 'Item text': '项目文字' }), 'web');
    expect(result.missing).toEqual([]);
    expect(result.md).toContain(codeBlock);
    expect(result.md).toContain('项目文字');
  });

  it('列表项第一行就是围栏（<li><pre>）时也不翻', () => {
    const body = turndown.turndown('<ul><li><pre><code>const first = 1;\n\nconst second = 2;</code></pre></li></ul>');
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual([]);

    const codeBlock = '```\n    const first = 1;\n    \n    const second = 2;\n    ```';
    expect(md).toContain(codeBlock);
    expect(applyTranslations(md, [], 'web').md).toBe(md);
  });
});

describe('planBilingual：同一行开多层容器的围栏（续修 4A）', () => {
  it('嵌套列表里的 YAML 代码块不翻，外层列表项文字照常翻译', () => {
    const body = turndown.turndown(
      '<ul><li>Outer text<ul><li><pre><code class="language-yaml">name: Test\nsteps:\n  - name: Install dependencies\n\n  - name: Run tests</code></pre></li></ul></li></ul>',
    );
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['Outer text']);
    expect(plan.segments).not.toContain('- name: Install dependencies');

    const codeBlock = body.slice(body.indexOf('```yaml'), body.lastIndexOf('```') + 3);
    expect(codeBlock).toContain('- name: Install dependencies');
    expect(md).toContain(codeBlock);
    const result = applyTranslations(md, itemsFor(plan, { 'Outer text': '外部文字' }), 'web');
    expect(result.missing).toEqual([]);
    expect(result.md).toContain(codeBlock);
    expect(result.md).toContain('外部文字');
  });

  it('引用块里的列表容器后面开围栏也不翻', () => {
    const body = turndown.turndown(
      '<blockquote><ul><li><pre><code>const a = 1;\n\nconst b = 2;</code></pre></li></ul></blockquote>',
    );
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual([]);

    const codeBlock = body.slice(body.indexOf('```'), body.lastIndexOf('```') + 3);
    expect(codeBlock).toContain('const b = 2;');
    expect(applyTranslations(md, [], 'web').md).toBe(md);
  });
});

describe('planBilingual：列表项硬换行续行（续修 4B）', () => {
  it('<li>First line<br>Second line</li>：两行都送翻，译文插在第二行之后', () => {
    const body = turndown.turndown('<ul><li>First line<br>Second line</li></ul>');
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['First line', 'Second line']);
    const unit = plan.units[0] as Unit;
    expect(unit.kind).toBe('list-item');
    expect(unit.sourceLines).toEqual(['-   First line  ', '    Second line']);
    expect(unit.perLine).toBe(true);
    expect(renderTranslation(unit, ['第一行', '第二行'], 'zh')).toEqual(['    第一行\\', '    第二行']);

    const result = applyTranslations(
      md,
      [{ unit, lines: renderTranslation(unit, ['第一行', '第二行'], 'zh') }],
      'web',
    );
    expect(result.missing).toEqual([]);
    expect(bodyOf(result.md)).toBe('\n-   First line  \n    Second line\\\n    第一行\\\n    第二行\n');
  });
});

describe('planBilingual：引用块里的列表（续修 5A）', () => {
  it('引用块里的列表整体不翻，插入译文不破坏列表/围栏', () => {
    const body = turndown.turndown(
      '<blockquote><ul><li>Outer<pre><code>const a = 1;</code></pre></li></ul></blockquote>',
    );
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual([]);
    expect(applyTranslations(md, [], 'web').md).toBe(md);
  });

  it('列表之前的普通段落照常翻，列表及其后的段落全部跳过', () => {
    const body = turndown.turndown(
      '<blockquote><p>Ordinary paragraph.</p><ul><li>Outer</li></ul><p>After paragraph.</p></blockquote>',
    );
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['Ordinary paragraph.']);

    const result = applyTranslations(md, itemsFor(plan, { 'Ordinary paragraph.': '普通段落。' }), 'web');
    expect(result.missing).toEqual([]);
    expect(result.md).toContain('普通段落。');
    expect(result.md).toContain('> -   Outer');
    expect(result.md).toContain('> After paragraph.');
  });
});

describe('planBilingual：列表项首行是块结构（续修 6）', () => {
  it('<li><h2>...</h2></li> 的标题行不建单元、不加反斜杠，Plain item 照常翻', () => {
    const body = turndown.turndown('<ul><li><h2>Important heading</h2></li><li>Plain item</li></ul>');
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['Plain item']);

    const result = applyTranslations(md, itemsFor(plan, { 'Plain item': '普通项目' }), 'web');
    expect(result.missing).toEqual([]);
    expect(result.md).toContain('-   ## Important heading\n');
    expect(result.md).not.toContain('## Important heading\\');
    expect(result.md).toContain('-   Plain item\\\n    普通项目');
  });

  it('<li><blockquote>...</blockquote></li> 的引用行同理', () => {
    const body = turndown.turndown('<ul><li><blockquote>Quoted text</blockquote></li><li>Plain item</li></ul>');
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['Plain item']);

    const result = applyTranslations(md, itemsFor(plan, { 'Plain item': '普通项目' }), 'web');
    expect(result.missing).toEqual([]);
    expect(result.md).toContain('-   > Quoted text\n');
    expect(result.md).not.toContain('> Quoted text\\');
    expect(result.md).toContain('-   Plain item\\\n    普通项目');
  });

  it('嵌套列表里的普通文字不被当成块结构跳过', () => {
    const body = turndown.turndown('<ul><li><ul><li>Nested plain</li></ul></li></ul>');
    const plan = planBilingual(withFrontmatter(body), 'web');
    expect(plan.segments.some((segment) => segment.includes('Nested plain'))).toBe(true);
  });
});

describe('planBilingual：同一行多层列表标记与列表边界（续修 7）', () => {
  it('同一行两层列表标记 + 硬换行：内容列取最内层，两行都送翻、缩进 8', () => {
    const body = turndown.turndown('<ul><li><ul><li>First line<br>Second line</li></ul></li></ul>');
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['First line', 'Second line']);

    const unit = plan.units[0] as Unit;
    expect(unit.kind).toBe('list-item');
    expect(unit.indent).toBe(8);
    expect(unit.sourceLines).toEqual(['-   -   First line  ', '        Second line']);
    const lines = renderTranslation(unit, ['第一行', '第二行'], 'zh');
    expect(lines).toEqual(['        第一行\\', '        第二行']);

    const result = applyTranslations(md, [{ unit, lines }], 'web');
    expect(result.missing).toEqual([]);
    expect(bodyOf(result.md)).toBe('\n-   -   First line  \n        Second line\\\n        第一行\\\n        第二行\n');
  });

  it('列表项首段后紧跟缩进不足内容列的懒续行：不建单元，文件逐字节不变', () => {
    const md = withFrontmatter('-   Item\nlazy continuation');
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual([]);
    expect(plan.units).toEqual([]);
    expect(applyTranslations(md, [], 'web').md).toBe(md);
  });
});

describe('planBilingual / applyTranslations：NBSP 与跨行行内结构（续修 9）', () => {
  it('顶层链接跨两行：整段送翻，原文两行与链接逐字节不变', () => {
    const body = turndown.turndown('<p><a href="https://example.com">First<br>&nbsp;second</a></p>');
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['First second']);
    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]?.perLine).toBeFalsy();

    const result = applyTranslations(md, itemsFor(plan, { 'First second': '第一第二' }), 'web');
    expect(result.missing).toEqual([]);
    expect(result.md).toContain('[First  \n\u00a0second](https://example.com)');
    expect(result.md).toContain('\n\n第一第二\n');
  });

  it('跨行强调：整段送翻，原文两行逐字节不变', () => {
    const body = turndown.turndown('<p><strong>bold<br>text</strong> after</p>');
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['bold text after']);
    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]?.perLine).toBeFalsy();

    const result = applyTranslations(md, itemsFor(plan, { 'bold text after': '粗体文字之后' }), 'web');
    expect(result.missing).toEqual([]);
    expect(result.md).toContain('**bold  \ntext** after');
    expect(result.md).toContain('\n\n粗体文字之后\n');
  });

  it('行首 NBSP 的普通段落当正文、照常翻译', () => {
    const body = turndown.turndown('<p>&nbsp;leading nbsp paragraph</p>');
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['leading nbsp paragraph']);
    expect(plan.units).toHaveLength(1);

    const result = applyTranslations(md, itemsFor(plan, { 'leading nbsp paragraph': 'NBSP 开头正文' }), 'web');
    expect(result.missing).toEqual([]);
    expect(result.md).toContain('\u00a0leading nbsp paragraph\n\nNBSP 开头正文');
  });

  it('顶层段落后跟有缩进、非块开头的行：不建单元，文件逐字节不变', () => {
    const md = withFrontmatter('Top paragraph.\n indented continuation');
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual([]);
    expect(plan.units).toEqual([]);
    expect(applyTranslations(md, [], 'web').md).toBe(md);
  });
});

describe('planBilingual：段落被块开头续行截断在行内结构中间（续修 10）', () => {
  it('链接跨行且第二行以 | 开头：不建单元，文件逐字节不变', () => {
    const body = turndown.turndown('<p><a href="https://example.com">First<br>| second</a></p>');
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual([]);
    expect(plan.units).toEqual([]);
    expect(applyTranslations(md, [], 'web').md).toBe(md);
  });

  it('强调跨行且第二行以 | 开头：不建单元，文件逐字节不变', () => {
    const body = turndown.turndown('<p><strong>First<br>| second</strong></p>');
    const md = withFrontmatter(body);
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual([]);
    expect(plan.units).toEqual([]);
    expect(applyTranslations(md, [], 'web').md).toBe(md);
  });
});

describe('planBilingual / applyTranslations：网页表格（ALAG-40）', () => {
  const tableTurndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  addTableRules(tableTurndown);
  const bannersTable = tableTurndown.turndown(bannersHtml);
  const mergedTable = tableTurndown.turndown(mergedHtml);
  const simpleTable = tableTurndown.turndown(simpleHtml);
  const body = [
    '# Article',
    '',
    'Intro paragraph before the tables.',
    '',
    bannersTable,
    '',
    mergedTable,
    '',
    simpleTable,
    '',
    'Closing paragraph after the tables.',
  ].join('\n');
  const md = withFrontmatter(body);
  const plan = planBilingual(md, 'web');
  const isTableLine = (line: string): boolean => line.trimStart().startsWith('|') || line.trimStart().startsWith('<table');

  it('GFM 表格行与单行 HTML 表格都不建单元', () => {
    const tableLines = md.split('\n').filter(isTableLine);
    expect(tableLines.length).toBeGreaterThan(5);
    for (const unit of plan.units) {
      expect(unit.sourceLines.some(isTableLine)).toBe(false);
    }
  });

  it('通栏行段落（caption、首行、Source…）照常建单元', () => {
    expect(plan.segments).toContain('Climate data for Example City');
    expect(plan.segments).toContain('Climate data for Example City (1991–2020 normals)');
    expect(plan.segments).toContain('Municipalities in Example Prefecture');
    const sources = plan.units.filter((unit) => unit.sourceLines[0]?.startsWith('Source: '));
    expect(sources.map((unit) => unit.sourceLines[0])).toEqual([
      'Source: [Meteorological Agency](https://www.example.go.jp/)',
      'Source: Example Statistics Bureau',
    ]);
    expect(sources.every((unit) => unit.kind === 'paragraph')).toBe(true);
  });

  it('写回译文后表格行逐字节不变', () => {
    const tableLines = md.split('\n').filter(isTableLine);
    const translations: Record<string, string> = {};
    for (const segment of plan.segments) translations[segment] = '译文';
    const result = applyTranslations(md, itemsFor(plan, translations), 'web');
    expect(result.missing).toEqual([]);
    expect(result.md.split('\n').filter(isTableLine)).toEqual(tableLines);
    expect(result.md).toContain('译文');
  });
});

describe('planBilingual：列表项里的表格不打断列表上下文（ALAG-40 续修 2）', () => {
  const tableTurndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  addTableRules(tableTurndown);
  const gfmTable = '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Alpha</td><td>1</td></tr></tbody></table>';
  const htmlTable = '<table><tr><td rowspan="2">A</td><td>1</td></tr><tr><td>2</td></tr></table>';
  const isTableLine = (line: string): boolean => line.trimStart().startsWith('|') || line.trimStart().startsWith('<table');

  function translateAll(md: string) {
    const plan = planBilingual(md, 'web');
    const translations: Record<string, string> = {};
    for (const segment of plan.segments) translations[segment] = '译文';
    const result = applyTranslations(md, itemsFor(plan, translations), 'web');
    return { plan, result };
  }

  it('GFM 表格前后的段落都送翻，写回后表格行逐字节不变', () => {
    const body = tableTurndown.turndown(
      `<ul><li><p>Introduction paragraph here.</p>${gfmTable}<p>Concluding paragraph here.</p></li><li>Second item text.</li></ul>`,
    );
    const md = withFrontmatter(body);
    const tableLines = md.split('\n').filter(isTableLine);
    expect(tableLines).toHaveLength(3);

    const { plan, result } = translateAll(md);
    expect(plan.segments).toEqual(
      expect.arrayContaining(['Introduction paragraph here.', 'Concluding paragraph here.', 'Second item text.']),
    );
    for (const unit of plan.units) expect(unit.sourceLines.some(isTableLine)).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.md.split('\n').filter(isTableLine)).toEqual(tableLines);
  });

  it('单行 HTML 表格前后的段落同样都送翻，<table> 行不变', () => {
    const body = tableTurndown.turndown(
      `<ul><li><p>Introduction paragraph here.</p>${htmlTable}<p>Concluding paragraph here.</p></li><li>Second item text.</li></ul>`,
    );
    const md = withFrontmatter(body);
    const tableLines = md.split('\n').filter(isTableLine);
    expect(tableLines).toHaveLength(1);
    expect(tableLines[0]).toContain('<table');

    const { plan, result } = translateAll(md);
    expect(plan.segments).toEqual(
      expect.arrayContaining(['Introduction paragraph here.', 'Concluding paragraph here.', 'Second item text.']),
    );
    for (const unit of plan.units) expect(unit.sourceLines.some(isTableLine)).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.md.split('\n').filter(isTableLine)).toEqual(tableLines);
  });

  it('嵌套列表第二层里的表格，前后段落同样都送翻', () => {
    const body = tableTurndown.turndown(
      `<ul><li>Outer item.<ul><li><p>Introduction paragraph here.</p>${gfmTable}<p>Concluding paragraph here.</p></li></ul></li></ul>`,
    );
    const md = withFrontmatter(body);
    const { plan, result } = translateAll(md);
    expect(plan.segments).toEqual(expect.arrayContaining(['Introduction paragraph here.', 'Concluding paragraph here.']));
    for (const unit of plan.units) expect(unit.sourceLines.some(isTableLine)).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.md.split('\n').filter(isTableLine)).toEqual(md.split('\n').filter(isTableLine));
  });

  it('列表项首行就是 HTML 表格：不建含 <table> 的单元，后面的列表段落照常翻', () => {
    const body = tableTurndown.turndown(`<ul><li>${htmlTable}<p>Following paragraph here.</p></li></ul>`);
    const md = withFrontmatter(body);
    const { plan, result } = translateAll(md);
    expect(plan.segments).toContain('Following paragraph here.');
    for (const unit of plan.units) {
      expect(unit.sourceLines.some((line) => line.trimStart().startsWith('<table'))).toBe(false);
    }
    expect(result.missing).toEqual([]);
    expect(result.md.split('\n').filter(isTableLine)).toEqual(md.split('\n').filter(isTableLine));
  });
});
