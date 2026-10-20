import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Medium } from '@/shared/types';
import { updateDisplayedTitle } from './document';
import { updateFrontmatter } from './frontmatter';
import {
  applyTranslations,
  escapeMarkdownTranslation,
  planBilingual,
  plainTextOf,
  renderTranslation,
  type BilingualPlan,
  type Unit,
} from './bilingual';
import { setTranslationFields } from './frontmatter';

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/bilingual/${name}`, import.meta.url), 'utf8');
}

function translationsOf(name: string): Record<string, string> {
  return JSON.parse(fixture(`${name}.translations.json`)) as Record<string, string>;
}

function translatedItems(plan: ReturnType<typeof planBilingual>, table: Record<string, string>, target: string) {
  return plan.units.map((unit: Unit) => ({
    unit,
    lines: renderTranslation(
      unit,
      unit.segmentIndexes.map((index) => table[plan.segments[index] ?? ''] ?? ''),
      target,
    ),
  }));
}

const SOURCE = 'https://example.com/x';

function mini(body: string, medium: Medium = 'web'): string {
  return `---\nid: "01TEST"\nsource: "${SOURCE}"\nmedium: "${medium}"\ntitle: "T"\nauthor: ""\npublished: ""\ncaptured: "2026-10-18T00:00:00.000Z"\nsite: "example.com"\ntags: []\nnote: ""\nextract: "full"\n---\n\n${body}\n`;
}

function bodyOf(md: string): string {
  return md.slice(md.indexOf('\n---\n') + 5);
}

function planFor(body: string, medium: Medium = 'web'): BilingualPlan {
  return planBilingual(mini(body, medium), medium);
}

describe.each([
  ['article', 'web'],
  ['x', 'x'],
] as const)('金样例 %s', (name, medium: Medium) => {
  it('segments 恰好是译文表的全部键，plan → render → apply → frontmatter 与 expected 逐字节相同', () => {
    const original = fixture(`${name}.original.md`);
    const expected = fixture(`${name}.expected.md`);
    const table = translationsOf(name);

    const plan = planBilingual(original, medium);
    expect(plan.segments).toEqual(Object.keys(table));

    const items = translatedItems(plan, table, 'zh');
    const result = applyTranslations(original, items, medium);
    expect(result.missing).toEqual([]);
    expect(result.applied).toHaveLength(plan.units.length);

    const md = setTranslationFields(result.md, { lang: 'en', translated_to: 'zh', translation: 'complete' });
    expect(md).toBe(expected);
  });
});

describe('plainTextOf：送翻纯文本', () => {
  it('链接留文字、图片整个去掉、强调与行内 HTML 去掉、转义还原、空白合并', () => {
    const raw =
      '[链接](https://example.com) ![图](a.png) **粗** *斜* __下__ _线_ ~~删~~ <span>标签</span> \\* \\_ 和 `code1` 与 `code2`';
    const { text, codes } = plainTextOf(raw);
    expect(text).toBe('链接 粗 斜 下 线 删 标签 * _ 和 ⟦c1⟧ 与 ⟦c2⟧');
    expect(codes).toEqual(['`code1`', '`code2`']);
  });

  it('自动链接去掉尖括号保留地址；链接地址里的转义括号不影响文字', () => {
    expect(plainTextOf('<https://example.com/a(b)>').text).toBe('https://example.com/a(b)');
    expect(plainTextOf('<ada@example.com>').text).toBe('ada@example.com');
    expect(plainTextOf('see [A](https://x/1) and [B](https://x/2)').text).toBe('see A and B');
    expect(plainTextOf('[Wiki](https://x/Foo_\\(bar\\))').text).toBe('Wiki');
  });

  it('链接与图片带标题：标题里的括号与引号不留在送翻文字里（ALAG-42）', () => {
    expect(plainTextOf('on [conventions](https://x/Convention_\\(norm\\) "Convention (norm)") for').text).toBe(
      'on conventions for',
    );
    expect(plainTextOf('call [`fetch()`](https://x/fetch "fetch()") now').text).toBe('call ⟦c1⟧ now');
    expect(plainTextOf('[A](https://x/a \'single (q)\') end').text).toBe('A end');
    expect(plainTextOf('[A](https://x/a "say \\"hi\\" (x)") end').text).toBe('A end');
    expect(plainTextOf('[A](<https://x/a b\\(c\\)> "t (1)") end').text).toBe('A end');
    expect(plainTextOf('x ![pic](https://x/p.png "Figure (1)") y').text).toBe('x y');
  });

  it('裸地址末尾的原有反斜杠（\\)）后面的括号正文不被吞（ALAG-42 自查）', () => {
    expect(plainTextOf('[a](x\\) (see y) end.').text).toBe('a (see y) end.');
    expect(plainTextOf('[a](x\\) (y)) end.').text).toBe('a (y)) end.');
    expect(plainTextOf('[a](x\\)) tail').text).toBe('a tail');
  });

  it('手写的非常规链接目标仍按旧写法去掉（ALAG-42 自查）', () => {
    expect(plainTextOf('[a](x y) b').text).toBe('a b');
    expect(plainTextOf("[a](x 'T') b").text).toBe('a b');
  });

  it('手写的地址里有一层未转义的成对括号：整个去掉（ALAG-42）', () => {
    expect(plainTextOf('see [Unix](https://x/Unix_(OS)) here').text).toBe('see Unix here');
  });

  it('大量 ]( 或 [](（未闭合的括号）不是平方级（ALAG-42 codex R5）', () => {
    for (const raw of ['](' .repeat(16000), '[](' .repeat(16000), '[a](x '.repeat(16000)]) {
      const started = performance.now();
      plainTextOf(raw);
      expect(performance.now() - started).toBeLessThan(100);
    }
  });

  it('长空白加未闭合标题不触发多项式回溯（ALAG-42 codex R1）', () => {
    const cases = [
      `Read [A](${' '.repeat(3000)}"a ${'b'.repeat(100000)})`,
      `Read [A](x${' '.repeat(3000)}"a ${'b'.repeat(100000)})`,
    ];
    for (const raw of cases) {
      let started = performance.now();
      plainTextOf(raw);
      expect(performance.now() - started).toBeLessThan(150);
      started = performance.now();
      planFor(raw);
      expect(performance.now() - started).toBeLessThan(300);
    }
  });

  it('未闭合的链接目标里一长串反斜杠不触发指数级回溯（ALAG-42）', () => {
    const raw = `[a](${'\\'.repeat(42)} tail`;
    const started = performance.now();
    plainTextOf(raw);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('行内代码先换占位符，代码里的 Markdown 不再被处理', () => {
    const { text, codes } = plainTextOf('run `**a** [b]` now');
    expect(text).toBe('run ⟦c1⟧ now');
    expect(codes).toEqual(['`**a** [b]`']);
  });
});

describe('planBilingual：跳过规则（保守：认不出就不翻）', () => {
  it('代码块、HTML、表格、分隔线、两层引用、缩进代码、纯链接、没有字母的段都不翻', () => {
    const body = [
      '# Heading',
      '',
      '[原文](https://example.com/x)',
      '',
      '![img](a.png)',
      '',
      '12,400',
      '',
      '`12,400`',
      '',
      '| a | b |',
      '',
      '* * *',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '<div>hello</div>',
      '',
      '> > nested quote text',
      '',
      '    indented code',
      '',
      '> The best catalog is the one people are willing to update.',
    ].join('\n');
    const plan = planFor(body);
    expect(plan.segments).toEqual(['Heading', 'The best catalog is the one people are willing to update.']);
    expect(plan.units.map((u) => u.kind)).toEqual(['heading', 'quote-paragraph']);
  });

  it('只有带标题的链接或图片的段落也算纯链接，不翻（ALAG-42）', () => {
    const body = [
      '[Unix](https://x/Unix_\\(OS\\) "Unix (OS)")',
      '',
      '![Figure](https://x/p.png "Figure (1)")',
      '',
      'Body text.',
    ].join('\n');
    expect(planFor(body).segments).toEqual(['Body text.']);
  });

  it('medium 为 x 时跳过 @handle 标题与引用帖作者行', () => {
    const body = [
      '# @mayareads - We just shipped offline mode for the reader app.',
      '',
      'A normal paragraph.',
      '',
      '> **Ink & Switch (@inkandswitch)** · 2026-09-12 · [原帖](https://example.com/p)',
      '>',
      '> Local-first software puts your data on your device first and the cloud second.',
    ].join('\n');
    const plan = planFor(body, 'x');
    expect(plan.segments).toEqual([
      'A normal paragraph.',
      'Local-first software puts your data on your device first and the cloud second.',
    ]);
  });
});

describe('renderTranslation：占位符、标点与转义', () => {
  const paragraphPlan = planFor('Run `a` and `b` now.');

  it('占位符不区分大小写地换回原样行内代码', () => {
    const unit = paragraphPlan.units[0] as Unit;
    expect(renderTranslation(unit, ['运行 ⟦C1⟧ 和 ⟦C2⟧。'], 'zh')).toEqual(['', '运行 `a` 和 `b`。']);
  });

  it('译文里丢了的占位符不补', () => {
    const unit = paragraphPlan.units[0] as Unit;
    expect(renderTranslation(unit, ['只用 ⟦C1⟧'], 'zh')).toEqual(['', '只用 `a`']);
  });

  it('目标 zh / zh-Hant / ja 去掉中日文标点后的空白；目标 en 不清理', () => {
    const unit = paragraphPlan.units[0] as Unit;
    expect(renderTranslation(unit, ['你好。 世界。'], 'zh')).toEqual(['', '你好。世界。']);
    expect(renderTranslation(unit, ['你好。 世界。'], 'zh-TW')).toEqual(['', '你好。世界。']);
    expect(renderTranslation(unit, ['你好。 世界。'], 'ja')).toEqual(['', '你好。世界。']);
    expect(renderTranslation(unit, ['你好。 世界。'], 'en')).toEqual(['', '你好。 世界。']);
  });

  it('按 Turndown 的转义表转义（含行首规则）', () => {
    expect(escapeMarkdownTranslation('a\\b *c* _d_ `e` [f] ]g')).toBe('a\\\\b \\*c\\* \\_d\\_ \\`e\\` \\[f\\] \\]g');
    expect(escapeMarkdownTranslation('- a\n+ b\n===\n# c\n> d\n~~~\n1. e')).toBe(
      '\\- a\n\\+ b\n\\===\n\\# c\n\\> d\n\\~~~\n1\\. e',
    );
  });

  it('译文等于原文纯文本时不插入（占位符大小写不同也算相同）', () => {
    const unit = paragraphPlan.units[0] as Unit;
    expect(renderTranslation(unit, ['Run `a` and `b` now.'], 'zh')).toEqual([]);
    expect(renderTranslation(unit, ['Run ⟦C1⟧ and ⟦C2⟧ now.'], 'zh')).toEqual([]);
  });
});

describe('applyTranslations：中文原文、英文译文', () => {
  it('标题、段落、列表都按同一规则插入，目标 en 不清标点', () => {
    const md = mini(
      [
        '# 为什么我们需要慢思考',
        '',
        '快思考替我们省下了大量注意力，代价是它几乎从不怀疑自己。',
        '',
        '-   先写下直觉答案',
        '-   再找一条反例',
      ].join('\n'),
    );
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual([
      '为什么我们需要慢思考',
      '快思考替我们省下了大量注意力，代价是它几乎从不怀疑自己。',
      '先写下直觉答案',
      '再找一条反例',
    ]);
    const table: Record<string, string> = {
      '为什么我们需要慢思考': 'Why we need to think slowly',
      '快思考替我们省下了大量注意力，代价是它几乎从不怀疑自己。':
        'Thinking fast saves us a lot of attention, at the cost of it almost never doubts itself.',
      '先写下直觉答案': 'Write down your intuition first',
      '再找一条反例': 'Find another counterexample',
    };
    const result = applyTranslations(md, translatedItems(plan, table, 'en'), 'web');
    expect(result.missing).toEqual([]);
    expect(bodyOf(result.md)).toBe(
      [
        '',
        '# 为什么我们需要慢思考',
        '',
        '# Why we need to think slowly',
        '',
        '快思考替我们省下了大量注意力，代价是它几乎从不怀疑自己。',
        '',
        'Thinking fast saves us a lot of attention, at the cost of it almost never doubts itself.',
        '',
        '-   先写下直觉答案\\',
        '    Write down your intuition first',
        '-   再找一条反例\\',
        '    Find another counterexample',
        '',
      ].join('\n'),
    );
  });
});

describe('applyTranslations：在被改过的文件上插入', () => {
  const body = ['# Old title', '', 'First paragraph.', '', 'Second paragraph.'].join('\n');
  const table = { 'Old title': '旧标题', 'First paragraph.': '第一段。', 'Second paragraph.': '第二段。' };

  it('frontmatter 的 title / tags / note 改过：照常插入且这些改动保留', () => {
    const md = mini(body);
    const plan = planBilingual(md, 'web');
    const edited = updateFrontmatter(md, { title: 'New title', tags: ['设计'], note: '我的批注' });
    const result = applyTranslations(edited, translatedItems(plan, table, 'zh'), 'web');
    expect(result.missing).toEqual([]);
    expect(result.md).toContain('title: "New title"');
    expect(result.md).toContain('tags: ["设计"]');
    expect(result.md).toContain('note: "我的批注"');
    expect(bodyOf(result.md)).toBe(
      bodyOf(edited)
        .replace('First paragraph.', 'First paragraph.\n\n第一段。')
        .replace('Second paragraph.', 'Second paragraph.\n\n第二段。')
        .replace('# Old title\n', '# Old title\n\n# 旧标题\n'),
    );
  });

  it('正文显示标题行被 updateDisplayedTitle 改了：标题免插进 applied，其他照常', () => {
    const md = mini(body);
    const plan = planBilingual(md, 'web');
    const edited = updateDisplayedTitle(md, 'Old title', 'Renamed', SOURCE);
    const result = applyTranslations(edited, translatedItems(plan, table, 'zh'), 'web');
    expect(result.missing).toEqual([]);
    expect(result.applied.map((u) => u.kind)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(result.applied[0]?.displayTitle).toBe(true);
    expect(bodyOf(result.md)).toContain('# Renamed\n\nFirst paragraph.\n\n第一段。');
    expect(bodyOf(result.md)).not.toContain('旧标题');
  });

  it('正文里第二个一级标题被用户改了仍进 missing', () => {
    const md = mini('# Display\n\nFirst paragraph.\n\n# Second\n\nSecond paragraph.');
    const plan = planBilingual(md, 'web');
    expect(plan.units.filter((u) => u.displayTitle).map((u) => u.sourceLines.join('\n'))).toEqual(['# Display']);
    const table2: Record<string, string> = {
      Display: '显示',
      'First paragraph.': '第一段。',
      Second: '第二',
      'Second paragraph.': '第二段。',
    };
    const edited = md.replace('# Second', '# Renamed second');
    const result = applyTranslations(edited, translatedItems(plan, table2, 'zh'), 'web');
    expect(result.missing.map((u) => u.sourceLines.join('\n'))).toEqual(['# Second']);
    expect(result.applied.map((u) => u.kind)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(bodyOf(result.md)).toContain('# Display\n\n# 显示');
    expect(bodyOf(result.md)).toContain('First paragraph.\n\n第一段。');
    expect(bodyOf(result.md)).not.toContain('# 第二');
    expect(bodyOf(result.md)).toContain('# Renamed second');
  });

  it('某段被用户改了：该段进 missing，其他照常', () => {
    const md = mini(body);
    const plan = planBilingual(md, 'web');
    const edited = md.replace('Second paragraph.', 'Second paragraph, user edited.');
    const result = applyTranslations(edited, translatedItems(plan, table, 'zh'), 'web');
    expect(result.missing.map((u) => u.sourceLines.join('\n'))).toEqual(['Second paragraph.']);
    expect(bodyOf(result.md)).toContain('First paragraph.\n\n第一段。');
    expect(bodyOf(result.md)).toContain('Second paragraph, user edited.');
    expect(bodyOf(result.md)).not.toContain('第二段。');
  });

  it('两段原文完全相同：各自插入一次；对同一批 items 调用两次不重复插入', () => {
    const md = mini('Same text.\n\nSame text.');
    const plan = planBilingual(md, 'web');
    expect(plan.units).toHaveLength(2);
    const items = translatedItems(plan, { 'Same text.': '同样的文字。' }, 'zh');

    const once = applyTranslations(md, items, 'web');
    expect(once.applied).toHaveLength(2);
    expect(bodyOf(once.md)).toBe('\nSame text.\n\n同样的文字。\n\nSame text.\n\n同样的文字。\n');

    const twice = applyTranslations(once.md, items, 'web');
    expect(twice.applied).toHaveLength(2);
    expect(twice.missing).toEqual([]);
    expect(twice.alreadyPresent).toHaveLength(2);
    expect(twice.alreadyPresent).toEqual(items.map((item) => item.unit));
    expect(twice.md).toBe(once.md);
  });

  it('译文等同于原文的单元不插入；apply 记为 applied 但文件字节不变', () => {
    const md = mini('Stay as is.');
    const plan = planBilingual(md, 'web');
    const items = translatedItems(plan, { 'Stay as is.': 'Stay as is.' }, 'zh');
    const result = applyTranslations(md, items, 'web');
    expect(result.applied).toHaveLength(1);
    expect(result.md).toBe(md);
  });
});

describe('applyTranslations：前后块紧挨着（没有空行）', () => {
  it('标题/段落后面直接跟列表项：替换原行先做，译文行顺序正确', () => {
    const md = mini(['# Title', '-   Item text', '', 'Paragraph.', '-   Second item'].join('\n'));
    const plan = planBilingual(md, 'web');
    const table = {
      Title: '标题',
      'Item text': '项目文字',
      'Paragraph.': '段落。',
      'Second item': '第二项',
    };
    const result = applyTranslations(md, translatedItems(plan, table, 'zh'), 'web');
    expect(result.missing).toEqual([]);
    expect(bodyOf(result.md)).toBe(
      [
        '',
        '# Title',
        '',
        '# 标题',
        '-   Item text\\',
        '    项目文字',
        '',
        'Paragraph.',
        '',
        '段落。',
        '-   Second item\\',
        '    第二项',
        '',
      ].join('\n'),
    );
  });
});

describe('applyTranslations：同文字块分两次写回（续修 A）', () => {
  it('第二次只传最后一段：跳过已译的第一块，插到最后一块，applied 正确', () => {
    const md = mini('Same text here.\n\nOther.\n\nSame text here.');
    const plan = planBilingual(md, 'web');
    expect(plan.units.map((unit) => unit.sourceLines.join('\n'))).toEqual(['Same text here.', 'Other.', 'Same text here.']);
    const table: Record<string, string> = { 'Same text here.': '同样的文字。', 'Other.': '另一段。' };
    const forUnits = (units: Unit[]) =>
      units.map((unit) => ({
        unit,
        lines: renderTranslation(
          unit,
          unit.segmentIndexes.map((index) => table[plan.segments[index] ?? ''] ?? ''),
          'zh',
        ),
      }));

    const first = applyTranslations(md, forUnits([plan.units[0] as Unit, plan.units[1] as Unit]), 'web');
    expect(first.missing).toEqual([]);
    expect(first.applied).toHaveLength(2);

    const second = applyTranslations(first.md, forUnits([plan.units[2] as Unit]), 'web');
    expect(second.missing).toEqual([]);
    expect(second.applied).toHaveLength(1);
    expect((second.md.match(/同样的文字。/g) ?? []).length).toBe(2);
    expect(bodyOf(second.md)).toBe(
      '\nSame text here.\n\n同样的文字。\n\nOther.\n\n另一段。\n\nSame text here.\n\n同样的文字。\n',
    );
  });
});

describe('planBilingual / renderTranslation：硬换行段落里不送翻的行（续修 B）', () => {
  it('Post 🧵 one\\ + 1/5：只送有文字的行，1/5 在译文中原样照抄', () => {
    const md = mini('Post 🧵 one\\\n1/5');
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['Post 🧵 one']);
    expect(plan.units).toHaveLength(1);
    const unit = plan.units[0] as Unit;
    expect(unit.perLine).toBe(true);
    const lines = renderTranslation(unit, ['T:Post 🧵 one'], 'zh');
    expect(lines).toEqual(['', 'T:Post 🧵 one\\', '1/5']);

    const result = applyTranslations(md, [{ unit, lines }], 'web');
    expect(result.missing).toEqual([]);
    expect(bodyOf(result.md)).toBe('\nPost 🧵 one\\\n1/5\n\nT:Post 🧵 one\\\n1/5\n');
  });

  it('三行中间一行是纯链接：不送翻、照抄，并保持换行', () => {
    const md = mini('First line\\\n[卡片](https://example.com/card)\nThird line');
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['First line', 'Third line']);
    const unit = plan.units[0] as Unit;
    const lines = renderTranslation(unit, ['第一行', '第三行'], 'zh');
    expect(lines).toEqual(['', '第一行\\', '[卡片](https://example.com/card)\\', '第三行']);

    const result = applyTranslations(md, [{ unit, lines }], 'web');
    expect(result.missing).toEqual([]);
    expect(bodyOf(result.md)).toBe(
      '\nFirst line\\\n[卡片](https://example.com/card)\nThird line\n\n第一行\\\n[卡片](https://example.com/card)\\\n第三行\n',
    );
  });

  it('整段每一行都没有可翻文字：整块跳过', () => {
    const plan = planFor('1/5\\\n2/5');
    expect(plan.units).toEqual([]);
    expect(plan.segments).toEqual([]);
  });
});

describe('planBilingual：引用块里的硬换行（续修 C）', () => {
  it('连接前去掉行尾硬换行标记，送翻文本不含 \\', () => {
    const md = mini('> line one\\\n> line two');
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual(['line one line two']);
    const unit = plan.units[0] as Unit;
    const lines = renderTranslation(unit, ['第一行 第二行'], 'zh');
    expect(lines).toEqual(['>', '> 第一行 第二行']);

    const result = applyTranslations(md, [{ unit, lines }], 'web');
    expect(result.missing).toEqual([]);
    expect(bodyOf(result.md)).toBe('\n> line one\\\n> line two\n>\n> 第一行 第二行\n');
  });
});

describe('planBilingual：显示标题行（续修 2）', () => {
  it('只给正文第一个非空的一级标题打 displayTitle', () => {
    const plan = planFor('# Display\n\nText.\n\n# Second\n\nMore.');
    expect(plan.units.filter((unit) => unit.kind === 'heading').map((unit) => unit.displayTitle)).toEqual([true, false]);
  });

  it('第一个非空行不是一级标题时不打标记', () => {
    const plan = planFor('Intro.\n\n# Later heading');
    expect(plan.units.find((unit) => unit.kind === 'heading')?.displayTitle).toBe(false);

    const plan2 = planFor('## Second level first\n\n# Later H1');
    expect(plan2.units.filter((unit) => unit.kind === 'heading').map((unit) => unit.displayTitle)).toEqual([false, false]);
  });
});

describe('renderTranslation / applyTranslations：空白或缺失译文（续修 3B）', () => {
  it('单段空白译文视为无效：render 返回 null，apply 不插入、进 missing', () => {
    const md = mini('Hello world.');
    const plan = planBilingual(md, 'web');
    const unit = plan.units[0] as Unit;
    expect(renderTranslation(unit, [''], 'zh')).toBeNull();
    expect(renderTranslation(unit, ['   '], 'zh')).toBeNull();
    expect(renderTranslation(unit, [], 'zh')).toBeNull();

    const result = applyTranslations(md, [{ unit, lines: null }], 'web');
    expect(result.applied).toEqual([]);
    expect(result.missing).toEqual([unit]);
    expect(result.md).toBe(md);
  });

  it('两段中一段空白：另一段照常插入，空白段进 missing', () => {
    const md = mini('Hello world.\n\nSecond paragraph.');
    const plan = planBilingual(md, 'web');
    const first = plan.units[0] as Unit;
    const second = plan.units[1] as Unit;
    expect(renderTranslation(first, [''], 'zh')).toBeNull();
    const valid = renderTranslation(second, ['第二段。'], 'zh');
    expect(valid).toEqual(['', '第二段。']);

    const result = applyTranslations(
      md,
      [
        { unit: first, lines: null },
        { unit: second, lines: valid },
      ],
      'web',
    );
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]).toBe(second);
    expect(result.missing).toEqual([first]);
    expect(result.md).toContain('Second paragraph.\n\n第二段。');
    expect(result.md).not.toContain('第一段');
  });

  it('perLine 段里一行空白译文：整块不插入、进 missing', () => {
    const md = mini('First line\\\nSecond line');
    const plan = planBilingual(md, 'web');
    const unit = plan.units[0] as Unit;
    expect(unit.perLine).toBe(true);
    expect(renderTranslation(unit, ['第一行', ''], 'zh')).toBeNull();

    const result = applyTranslations(md, [{ unit, lines: null }], 'web');
    expect(result.applied).toEqual([]);
    expect(result.missing).toEqual([unit]);
    expect(result.md).toBe(md);
  });
});

describe('planBilingual / applyTranslations：引用段后的懒续行（续修 8A）', () => {
  it('引用段后紧跟不带 > 的懒续行：不建单元，文件逐字节不变', () => {
    const md = mini('> Quoted first line\nlazy continuation');
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual([]);
    expect(plan.units).toEqual([]);
    expect(applyTranslations(md, [], 'web').md).toBe(md);
  });

  it('当前文件被追加懒续行后：原引用段单元进 missing，文件不变', () => {
    const original = mini('> Quoted first line');
    const plan = planBilingual(original, 'web');
    expect(plan.units).toHaveLength(1);
    const unit = plan.units[0] as Unit;
    const items = translatedItems(plan, { 'Quoted first line': '引用第一行' }, 'zh');
    const current = mini('> Quoted first line\nlazy continuation');

    const result = applyTranslations(current, items, 'web');
    expect(result.applied).toEqual([]);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toBe(unit);
    expect(result.alreadyPresent).toEqual([]);
    expect(result.md).toBe(current);
  });
});

describe('planBilingual：网址与行内代码里的符号不参与成对检查（续修 11）', () => {
  it('链接网址里的下划线不阻止段落/列表项送翻，原文逐字节不变', () => {
    const body = [
      'See the [API](https://en.wikipedia.org/wiki/File_System_Access_API) today.',
      '',
      'Read [x](https://a.com/a_b) now.',
      '',
      '-   Item with [link](https://a.com/x_y) here.',
      '',
      'Call `my_func()` first.',
    ].join('\n');
    const md = mini(body);
    const plan = planBilingual(md, 'web');
    const codeSegment = plainTextOf('Call `my_func()` first.').text;
    expect(plan.segments).toEqual(['See the API today.', 'Read x now.', 'Item with link here.', codeSegment]);

    const table: Record<string, string> = {
      'See the API today.': '今天看看 API。',
      'Read x now.': '现在读 x。',
      'Item with link here.': '这里有一项带链接。',
      [codeSegment]: '先调用函数。',
    };
    const result = applyTranslations(md, translatedItems(plan, table, 'zh'), 'web');
    expect(result.missing).toEqual([]);
    const after = bodyOf(result.md);
    expect(after).toContain('See the [API](https://en.wikipedia.org/wiki/File_System_Access_API) today.');
    expect(after).toContain('Read [x](https://a.com/a_b) now.');
    expect(after).toContain('-   Item with [link](https://a.com/x_y) here.');
    expect(after).toContain('Call `my_func()` first.');
    expect(after).toContain('今天看看 API。');
    expect(after).toContain('现在读 x。');
    expect(after).toContain('这里有一项带链接。');
    expect(after).toContain('先调用函数。');
  });

  it('词中下划线 snake_case 照常送翻', () => {
    const md = mini('A snake_case word.');
    const plan = planBilingual(md, 'web');
    const segment = plainTextOf('A snake_case word.').text;
    expect(plan.segments).toEqual([segment]);

    const result = applyTranslations(md, translatedItems(plan, { [segment]: '一个蛇形词。' }, 'zh'), 'web');
    expect(result.missing).toEqual([]);
    expect(bodyOf(result.md)).toContain('A snake_case word.');
    expect(bodyOf(result.md)).toContain('一个蛇形词。');
  });
});

describe('planBilingual：链接文字是网址时方括号仍成对（续修 12）', () => {
  it('四个真实行都送翻，写回后原文逐字节不变', () => {
    const para1 =
      'Related: [https://x.com/IntuitMachine/status/2068808668393451770](https://x.com/IntuitMachine/status/2068808668393451770)';
    const para2 =
      'QPT on loops: [https://www.youtube.com/watch?v=53Y3SYR5vTU\\&list=PLoOMKjCBaDuX8vYGfcSUgw\\_84xj3wo62-\\&index=10](https://www.youtube.com/watch?v=53Y3SYR5vTU&list=PLoOMKjCBaDuX8vYGfcSUgw_84xj3wo62-&index=10)';
    const para3 =
      '**before the alpha -  subscribe to my substack for more fresh alpha -** [https://substack.com/@0xcodila](https://substack.com/@0xcodila)';
    const item =
      'Turndown repository has changed its URL to [https://github.com/mixmark-io/turndown](https://github.com/mixmark-io/turndown).';
    const md = mini([para1, '', para2, '', para3, '', `-   ${item}`].join('\n'));
    const plan = planBilingual(md, 'web');
    expect(plan.segments).toEqual([
      plainTextOf(para1).text,
      plainTextOf(para2).text,
      plainTextOf(para3).text,
      plainTextOf(item).text,
    ]);

    const table: Record<string, string> = {};
    plan.segments.forEach((segment, index) => {
      table[segment] = `译文 ${index + 1}`;
    });
    const result = applyTranslations(md, translatedItems(plan, table, 'zh'), 'web');
    expect(result.missing).toEqual([]);
    const after = bodyOf(result.md);
    for (const original of [para1, para2, para3, `-   ${item}`]) {
      expect(after).toContain(original);
    }
  });
});
