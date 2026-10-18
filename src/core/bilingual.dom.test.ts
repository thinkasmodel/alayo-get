import { describe, expect, it } from 'vitest';
import TurndownService from 'turndown';
import { applyTranslations, planBilingual, renderTranslation, type Unit } from './bilingual';

// 与 src/page/extract.ts 相同的 Turndown 配置；这里用它的实际输出验证列表/引用里的代码块。
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });

const SOURCE = 'https://example.com/x';

function withFrontmatter(body: string): string {
  return `---\nid: "01TEST"\nsource: "${SOURCE}"\nmedium: "web"\ntitle: "T"\nauthor: ""\npublished: ""\ncaptured: "2026-10-18T00:00:00.000Z"\nsite: "example.com"\ntags: []\nnote: ""\nextract: "full"\n---\n\n${body}\n`;
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
