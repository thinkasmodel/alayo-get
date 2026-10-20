import { describe, expect, it } from 'vitest';
import TurndownService from 'turndown';
import bannersHtml from '../../tests/fixtures/tables/banners.html?raw';
import mergedHtml from '../../tests/fixtures/tables/merged.html?raw';
import simpleHtml from '../../tests/fixtures/tables/simple.html?raw';
import { addTableRules } from '@/page/tables';
import { applyTranslations, plainTextOf, planBilingual, renderTranslation, type Unit } from './bilingual';

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

describe('planBilingual：Turndown 输出的带标题链接与图片（ALAG-42）', () => {
  const body = turndown.turndown(
    [
      '<p>Inspired by pre-existing <a href="https://en.wikipedia.org/wiki/Convention_(norm)" title="Convention (norm)">conventions</a> for marking up plain text.</p>',
      '<p>Call <a href="https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch" title="fetch()"><code>fetch()</code></a> to start a request.</p>',
      '<p>See <a href="https://example.com/a b" title="Notes (draft)">the notes</a> and <img src="https://example.com/p.png" alt="Figure" title="Figure (1)"> here.</p>',
      '<p><a href="https://en.wikipedia.org/wiki/Unix_(OS)" title="Unix (OS)">Unix</a></p>',
    ].join(''),
  );
  const md = withFrontmatter(body);
  const plan = planBilingual(md, 'web');

  it('样例确实是带标题的 Turndown 输出', () => {
    expect(body).toContain('[conventions](https://en.wikipedia.org/wiki/Convention_\\(norm\\) "Convention (norm)")');
    expect(body).toContain('[`fetch()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch "fetch()")');
    expect(body).toContain('[the notes](<https://example.com/a b> "Notes (draft)")');
    expect(body).toContain('![Figure](https://example.com/p.png "Figure (1)")');
  });

  it('送翻文字里没有标题残片，只有链接的段落不送翻', () => {
    expect(plan.segments).toEqual([
      'Inspired by pre-existing conventions for marking up plain text.',
      'Call ⟦c1⟧ to start a request.',
      'See the notes and here.',
    ]);
  });

  it('写回译文后原文各行逐字节不变', () => {
    const translations: Record<string, string> = {};
    for (const segment of plan.segments) translations[segment] = '译文';
    const result = applyTranslations(md, itemsFor(plan, translations), 'web');
    expect(result.missing).toEqual([]);
    const originalLines = bodyOf(md).split('\n').filter((line) => line.trim() !== '');
    const resultLines = bodyOf(result.md).split('\n');
    for (const line of originalLines) expect(resultLines).toContain(line);
  });
});

describe('planBilingual：Turndown 地址里原有的反斜杠（ALAG-42 codex R1）', () => {
  // Turndown 只转义括号、不转义原有反斜杠：`docs\(v1).pdf` 写成 `docs\\(v1\).pdf`，`(` 变成未转义。
  const body = turndown.turndown(
    '<p>(<a href="https://example.com/docs&#92;(v1).pdf">Manual</a> (PDF))</p><p><a href="https://example.com/docs&#92;(v1).pdf">Manual</a> (PDF) notes</p>',
  );
  const plan = planBilingual(withFrontmatter(body), 'web');

  it('样例确实含 \\\\( ', () => {
    expect(body).toContain('[Manual](https://example.com/docs\\\\(v1\\).pdf) (PDF))');
  });

  it('链接后的正文不被吞，段落不被当成纯链接跳过', () => {
    expect(plan.segments).toEqual(['(Manual (PDF))', 'Manual (PDF) notes']);
  });
});

describe('planBilingual：Turndown 标题与地址末尾的原有反斜杠（ALAG-42 codex R2）', () => {
  // Turndown 只转义标题里的双引号、地址里的括号，不转义原有反斜杠：title="C:\" 写成 "C:\"，href 末尾的 \ 写成 \)。
  const body = turndown.turndown(
    [
      '<p><a href="https://example.com/manual" title="C:&#92;">Open (&quot;Windows</a> directory&quot;)</p>',
      '<p>See <img src="https://example.com/p.png" alt="Fig" title="C:&#92;"> the (&quot;quoted&quot;) part.</p>',
      '<p>Get <a href="https://example.com/dir&#92;">files</a> now.</p>',
    ].join(''),
  );
  const plan = planBilingual(withFrontmatter(body), 'web');

  it('样例确实是标题以 \\" 结尾、地址以 \\) 结尾', () => {
    expect(body).toContain('[Open ("Windows](https://example.com/manual "C:\\") directory")');
    expect(body).toContain('![Fig](https://example.com/p.png "C:\\")');
    expect(body).toContain('[files](https://example.com/dir\\) now.');
  });

  it('标题在第一个可能的结束处结束，正文不被吞；地址末尾的反斜杠也认得出', () => {
    expect(plan.segments).toEqual(['Open ("Windows directory")', 'See the ("quoted") part.', 'Get files now.']);
  });
});

describe('planBilingual：Turndown <…> 地址末尾的原有反斜杠（ALAG-42 codex R3）', () => {
  // 地址含空格时 Turndown 用 <…> 包起、把 > 转义成 \>，但不转义原有反斜杠：`C:\` 结尾写成 `C:\>`。
  const body = turndown.turndown(
    [
      '<p><a href="data:text/plain,Directory C:&#92;">Directory</a> (threshold &gt;)</p>',
      '<p><a href="data:text/plain,Directory C:&#92;" title="T">Folder</a> (limit &gt;) here</p>',
      '<p>Pic <img src="data:text/plain,Directory C:&#92;" alt="x"> (size &gt;) end</p>',
      '<p><a href="https://x/a&gt;b c">Mid</a> keeps</p>',
    ].join(''),
  );
  const plan = planBilingual(withFrontmatter(body), 'web');

  it('样例确实是 <…> 地址以 \\> 结尾、地址中间有 \\>', () => {
    expect(body).toContain('[Directory](<data:text/plain,Directory C:\\>) (threshold >)');
    expect(body).toContain('[Folder](<data:text/plain,Directory C:\\> "T") (limit >) here');
    expect(body).toContain('![x](<data:text/plain,Directory C:\\>) (size >) end');
    expect(body).toContain('[Mid](<https://x/a\\>b c>) keeps');
  });

  it('地址在第一个可能的结束处结束，正文不被吞、段落不被跳过', () => {
    expect(plan.segments).toEqual([
      'Directory (threshold >)',
      'Folder (limit >) here',
      'Pic (size >) end',
      'Mid keeps',
    ]);
  });
});

describe('planBilingual：Turndown 裸地址末尾的原有反斜杠（ALAG-42 自查）', () => {
  // href 末尾的 \ 写成 \)，后面的括号正文不能被当成标题或地址吞掉。
  const body = turndown.turndown(
    '<p>Open <a href="C:&#92;">drive</a> (see notes) first.</p><p>Root <a href="C:&#92;">dir</a> (y)) end.</p>',
  );
  const plan = planBilingual(withFrontmatter(body), 'web');

  it('样例确实是裸地址以 \\) 结尾', () => {
    expect(body).toContain('[drive](C:\\) (see notes) first.');
    expect(body).toContain('[dir](C:\\) (y)) end.');
  });

  it('括号正文保留', () => {
    expect(plan.segments).toEqual(['Open drive (see notes) first.', 'Root dir (y)) end.']);
  });
});

describe('planBilingual：Turndown 标题与 <…> 地址内部的「原有反斜杠＋转义」（ALAG-42 codex R4）', () => {
  // Turndown 原有反斜杠原样保留，只在 " 前（标题）与 <>() 前（地址）各加一个 \：原文 \" 写成 \\"，\> 写成 \\>。
  const body = turndown.turndown(
    [
      '<p>Read <a href="https://x/regex" title="Use &#92;&quot;(.*)&#92;&quot; to match a quoted value">the pattern</a> now.</p>',
      '<p><a href="https://x/regex" title="Use &#92;&quot;(.*)&#92;&quot; here">Only link</a></p>',
      '<p>See <img src="https://x/p.png" alt="P" title="a &#92;&quot;(b)&#92;&quot; c"> text.</p>',
      '<p>Go <a href="https://x/a b&#92;&gt;c">mid</a> on (x).</p>',
    ].join(''),
  );
  const plan = planBilingual(withFrontmatter(body), 'web');

  it('样例确实含 \\\\" 与 \\\\>', () => {
    expect(body).toContain('[the pattern](https://x/regex "Use \\\\"(.*)\\\\" to match a quoted value") now.');
    expect(body).toContain('[Only link](https://x/regex "Use \\\\"(.*)\\\\" here")');
    expect(body).toContain('![P](https://x/p.png "a \\\\"(b)\\\\" c") text.');
    expect(body).toContain('[mid](<https://x/a b\\\\>c>) on (x).');
  });

  it('标题与地址整个去掉，纯链接段不送翻', () => {
    expect(plan.segments).toEqual(['Read the pattern now.', 'See text.', 'Go mid on (x).']);
  });
});

describe('plainTextOf / planBilingual：随机链接经真实 Turndown（ALAG-42）', () => {
  // 地址与标题由 \ " ( ) < > ` 空格 字母随机拼成，过真实 Turndown：前后正文逐字保留，只有链接的段落不送翻。
  // 唯一的例外是语法上分不开的「地址以原有 \ 结尾、无标题、后接 "…")」——与维基 _\(norm\) "标题" 同形，按转义括号读。
  let seed = 7;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const ALPHABET = ['\\', '"', '(', ')', '<', '>', '`', ' ', 'a', 'b', ':', '/'];
  const randomText = (length: number): string =>
    Array.from({ length }, () => ALPHABET[rnd(ALPHABET.length)]).join('');
  const attr = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const TAILS: Array<[html: string, text: string]> = [
    [' (see y) end.', ' (see y) end.'],
    [' &quot;q&quot;) end.', ' "q") end.'],
    [' (y)) end.', ' (y)) end.'],
    [' &gt;) end.', ' >) end.'],
    [' z.', ' z.'],
    [' <code>c</code> end.', ' ⟦c1⟧ end.'],
  ];

  it.each(['new URL 规范化后的地址', '未规范化的原始地址'])('%s', (mode) => {
    const unexpected: string[] = [];
    for (let i = 0; i < 3000; i += 1) {
      const raw = `x${randomText(1 + rnd(6))}`;
      const data = rnd(10) < 3;
      let href = raw;
      if (mode.startsWith('new URL')) {
        try {
          href = new URL(data ? `data:text/plain,${raw}` : raw, 'https://example.com/d/').href;
        } catch {
          continue;
        }
      }
      const title = rnd(2) ? randomText(rnd(7)) : '';
      const [tailHtml, tail] = TAILS[rnd(TAILS.length)] ?? ['', ''];
      const image = rnd(4) === 0;
      const titleAttr = title ? ` title="${attr(title)}"` : '';
      const element = image
        ? `<img src="${attr(href)}" alt="P"${titleAttr}>`
        : `<a href="${attr(href)}"${titleAttr}>Link</a>`;
      const md = turndown.turndown(`<p>Pre ${element}${tailHtml}</p>`);
      const expected = `Pre ${image ? '' : 'Link'}${tail}`.replace(/\s+/g, ' ').trim();
      const accepted = href.endsWith('\\') && !title && tail.startsWith(' "');
      if (!accepted && plainTextOf(md).text !== expected) unexpected.push(md);
      const alone = turndown.turndown(`<p>${element}</p>`);
      if (alone && planBilingual(withFrontmatter(alone), 'web').segments.length > 0) unexpected.push(alone);
    }
    expect(unexpected).toEqual([]);
  });
});

describe('plainTextOf：链接目标里的反引号不参与行内代码配对（ALAG-42 codex R5）', () => {
  // Turndown 不转义地址与标题里的反引号；它们和正文里的反引号配成一对时会把标题的起始引号藏进占位符。
  const body = turndown.turndown(
    [
      '<p>Read <a href="data:text/plain,x)&#96;" title="&#96; label">Link</a> now.</p>',
      '<p>Call <a href="https://x/f" title="the &#96;f&#96; fn"><code>f()</code></a> or <code>g</code> and <a href="https://x/h" title="odd &#96; tick">h</a> then <code>k</code>.</p>',
    ].join(''),
  );
  const [first = '', second = ''] = body.split('\n\n');

  it('样例确实在地址与标题里有反引号', () => {
    expect(first).toBe('Read [Link](data:text/plain,x\\)` "` label") now.');
    expect(second).toBe('Call [`f()`](https://x/f "the `f` fn") or `g` and [h](https://x/h "odd ` tick") then `k`.');
  });

  it('地址与标题整个去掉；链接文字与正文里的行内代码照常换成占位符', () => {
    expect(plainTextOf(first)).toEqual({ text: 'Read Link now.', codes: [] });
    expect(plainTextOf(second)).toEqual({ text: 'Call ⟦c1⟧ or ⟦c2⟧ and h then ⟦c3⟧.', codes: ['`f()`', '`g`', '`k`'] });
    // 第二段标题里反引号是奇数个，成对检查（inlineStructuresBalanced）保守地整段不翻，与 main 相同。
    expect(planBilingual(withFrontmatter(body), 'web').segments).toEqual(['Read Link now.']);
  });
});
