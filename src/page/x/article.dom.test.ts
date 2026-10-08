import { describe, expect, it } from 'vitest';
import { longformToMarkdown } from './article';

/** 合成 Draft.js 正文：每项是 [列表标签, depth, 文字]。 */
function body(items: Array<['ol' | 'ul', number, string]>): Element {
  const root = document.createElement('div');
  let list: Element | null = null;
  for (const [tag, depth, text] of items) {
    if (!list || list.tagName.toLowerCase() !== tag) {
      list = document.createElement(tag);
      list.className = `public-DraftStyleDefault-${tag}`;
      root.append(list);
    }
    const li = document.createElement('li');
    li.setAttribute('data-block', 'true');
    li.className = `public-DraftStyleDefault-depth${depth}`;
    li.textContent = text;
    list.append(li);
  }
  return root;
}

describe('longformToMarkdown：嵌套列表按父项内容起始列缩进（codex review 第 2 轮）', () => {
  it('有序列表第 10 项之后的 depth1 子项：行前 4 个空格', () => {
    const items: Array<['ol', number, string]> = Array.from({ length: 10 }, (_, i) => ['ol', 0, `第 ${i + 1} 项`]);
    const md = longformToMarkdown(body([...items, ['ol', 1, '子项']]), {});
    const lines = md.split('\n');
    expect(lines[9]).toBe('10. 第 10 项');
    expect(lines[10]).toBe('    1. 子项');
  });

  it('有序、无序混合的两层列表', () => {
    const md = longformToMarkdown(
      body([
        ['ol', 0, '甲'],
        ['ul', 1, '甲一'],
        ['ul', 1, '甲二'],
        ['ol', 0, '乙'],
        ['ul', 0, '丙'],
        ['ol', 1, '丙一'],
      ]),
      {},
    );
    expect(md).toBe(['1. 甲', '   - 甲一', '   - 甲二', '2. 乙', '- 丙', '  1. 丙一'].join('\n'));
  });
});
