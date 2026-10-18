import { describe, expect, it } from 'vitest';
import TurndownService from 'turndown';
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
