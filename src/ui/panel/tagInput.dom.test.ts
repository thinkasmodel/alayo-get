import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedEntry, SavedIndexData } from '@/shared/types';
import { createTagInput } from './tagInput';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function entry(id: string, tags: string[]): SavedEntry {
  return {
    id,
    file: `${id}.md`,
    title: id,
    medium: 'web',
    source: `https://example.com/${id}`,
    savedAt: '2026-09-28T12:00:00.000Z',
    tags,
  };
}

// 设计 ×3、设计系统 ×2、界面文案 ×1
const index: SavedIndexData = {
  a: entry('a', ['设计', '设计系统']),
  b: entry('b', ['设计', '界面文案']),
  c: entry('c', ['设计', '设计系统']),
};

function setup(initial: string[] = []) {
  const onChange = vi.fn<(tags: string[]) => void>();
  const loadIndex = vi.fn(async () => index);
  const tagInput = createTagInput({ id: 'tags', initial, loadIndex, onChange });
  document.body.replaceChildren(tagInput.el);
  const { input } = tagInput;
  input.focus();
  const type = async (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  };
  const key = (k: string) => input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const options = () => [...tagInput.el.querySelectorAll<HTMLElement>('[role="option"]')];
  const labels = () => options().map((o) => o.querySelector('.optlabel')?.textContent);
  const chips = () => [...tagInput.el.querySelectorAll('.chiptext')].map((c) => c.textContent);
  const activeLabel = () => tagInput.el.querySelector('[aria-selected="true"] .optlabel')?.textContent;
  return { tagInput, input, onChange, loadIndex, type, key, options, labels, chips, activeLabel };
}

afterEach(() => document.body.replaceChildren());

describe('标签输入', () => {
  it('按前缀过滤建议，按使用次数排序，每条带"N 条剪藏"', async () => {
    const t = setup();
    await t.type('设');
    expect(t.labels()).toEqual(['设计', '设计系统', '新建标签“设”']);
    expect(t.options()[0]?.textContent).toContain('3 条剪藏');
    expect(t.options()[1]?.textContent).toContain('2 条剪藏');

    await t.type('界');
    expect(t.labels()).toEqual(['界面文案', '新建标签“界”']);
    expect(t.loadIndex).toHaveBeenCalledTimes(1);
  });

  it('"新建标签"：输入不是已有标签时出现，与已有标签完全相同时不出现', async () => {
    const t = setup();
    await t.type('读书');
    expect(t.labels()).toEqual(['新建标签“读书”']);

    await t.type('设计');
    expect(t.labels()).toEqual(['设计', '设计系统']);
    expect(t.labels()).not.toContain('新建标签“设计”');
  });

  it('回车添加当前选中项；没有下拉时回车把输入加成标签', async () => {
    const t = setup();
    await t.type('设');
    t.key('Enter');
    expect(t.chips()).toEqual(['设计']);
    expect(t.input.value).toBe('');
    expect(t.onChange).toHaveBeenLastCalledWith(['设计']);

    t.input.value = '  随手记  ';
    t.key('Enter');
    expect(t.chips()).toEqual(['设计', '随手记']);
    expect(t.onChange).toHaveBeenLastCalledWith(['设计', '随手记']);
  });

  it('重复的标签被拒，已选的标签不再出现在建议里', async () => {
    const t = setup(['设计']);
    t.input.value = ' 设计 ';
    t.key('Enter');
    expect(t.chips()).toEqual(['设计']);
    expect(t.onChange).not.toHaveBeenCalled();

    await t.type('设');
    expect(t.labels()).toEqual(['设计系统', '新建标签“设”']);
  });

  it('输入为空时退格删掉最后一个 chip', () => {
    const t = setup(['设计', '界面文案']);
    t.input.value = 'x';
    t.key('Backspace');
    expect(t.chips()).toEqual(['设计', '界面文案']);

    t.input.value = '';
    t.key('Backspace');
    expect(t.chips()).toEqual(['设计']);
    expect(t.onChange).toHaveBeenLastCalledWith(['设计']);
  });

  it('↑↓ 移动选中项，回车选中的是移动后的那一项', async () => {
    const t = setup();
    await t.type('设');
    expect(t.activeLabel()).toBe('设计');
    t.key('ArrowDown');
    expect(t.activeLabel()).toBe('设计系统');
    t.key('ArrowDown');
    expect(t.activeLabel()).toBe('新建标签“设”');
    t.key('ArrowDown');
    expect(t.activeLabel()).toBe('新建标签“设”');
    t.key('ArrowUp');
    expect(t.activeLabel()).toBe('设计系统');
    t.key('Enter');
    expect(t.chips()).toEqual(['设计系统']);
  });

  it('Esc 关闭下拉；chip 的删除按钮带 aria-label', async () => {
    const t = setup(['设计']);
    await t.type('界');
    expect(t.options()).toHaveLength(2);
    t.key('Escape');
    expect(t.options()).toHaveLength(0);

    const remove = t.tagInput.el.querySelector<HTMLButtonElement>('button[aria-label="删除标签 设计"]');
    expect(remove).not.toBeNull();
    remove?.click();
    expect(t.chips()).toEqual([]);
    expect(t.onChange).toHaveBeenLastCalledWith([]);
  });
});
