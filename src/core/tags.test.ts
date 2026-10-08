import { describe, expect, it } from 'vitest';
import type { SavedEntry, SavedIndexData } from '@/shared/types';
import { tagSuggestions } from './tags';

function entry(id: string, tags: string[]): SavedEntry {
  return { id, file: `${id}.md`, title: id, medium: 'web', source: `https://e.x/${id}`, savedAt: '', tags };
}

const index: SavedIndexData = {
  a: entry('a', ['设计', '界面文案', 'ai']),
  b: entry('b', ['设计', 'ai']),
  c: entry('c', ['设计', '设计系统']),
  d: entry('d', ['界面文案', 'b-tag']),
  e: entry('e', ['ai']),
};

describe('tagSuggestions', () => {
  it('prefix 为空时按次数降序返回最常用的', () => {
    expect(tagSuggestions(index, '')).toEqual([
      { tag: 'ai', count: 3 },
      { tag: '设计', count: 3 },
      { tag: '界面文案', count: 2 },
      { tag: 'b-tag', count: 1 },
      { tag: '设计系统', count: 1 },
    ]);
  });

  it('次数相同时按字典序', () => {
    const tie: SavedIndexData = { x: entry('x', ['b', 'a', 'c']) };
    expect(tagSuggestions(tie, '').map((t) => t.tag)).toEqual(['a', 'b', 'c']);
  });

  it('prefix 非空时只返回以它开头的', () => {
    expect(tagSuggestions(index, '设计')).toEqual([
      { tag: '设计', count: 3 },
      { tag: '设计系统', count: 1 },
    ]);
    expect(tagSuggestions(index, '不存在')).toEqual([]);
  });

  it('默认最多 8 条，可指定 limit', () => {
    const many: SavedIndexData = { m: entry('m', Array.from({ length: 12 }, (_, i) => `t${String(i).padStart(2, '0')}`)) };
    expect(tagSuggestions(many, '')).toHaveLength(8);
    expect(tagSuggestions(index, '', 2).map((t) => t.tag)).toEqual(['ai', '设计']);
  });
});
