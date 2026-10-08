import { describe, expect, it } from 'vitest';
import { clipBaseName, sameFileName, uniqueFileName } from './filename';

describe('clipBaseName', () => {
  it('非法字符和控制字符换成 -', () => {
    expect(clipBaseName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(clipBaseName('tab\there\u0007bell')).toBe('tab-here-bell');
  });

  it('连续空白合并，去掉首尾空白', () => {
    expect(clipBaseName('  多个   空格  之间 ')).toBe('多个 空格 之间');
  });

  it('去掉开头的点', () => {
    expect(clipBaseName('.hidden')).toBe('hidden');
    expect(clipBaseName('...  dots')).toBe('dots');
    expect(clipBaseName('a.b')).toBe('a.b');
  });

  it('61 个码点的中文标题截成 59 个码点加 …', () => {
    const title = '中'.repeat(61);
    const name = clipBaseName(title);
    expect(name).toBe('中'.repeat(59) + '…');
    expect(Array.from(name)).toHaveLength(60);
  });

  it('60 个码点不截断', () => {
    expect(clipBaseName('字'.repeat(60))).toBe('字'.repeat(60));
  });

  it('含 emoji 的标题按码点计数', () => {
    const emoji = '😀'; // 一个码点、两个 UTF-16 码元
    const title = emoji.repeat(61);
    const name = clipBaseName(title);
    expect(Array.from(name)).toHaveLength(60);
    expect(name).toBe(emoji.repeat(59) + '…');
    expect(clipBaseName(emoji.repeat(60))).toBe(emoji.repeat(60));
  });

  it('空标题用“未命名剪藏”', () => {
    expect(clipBaseName('')).toBe('未命名剪藏');
    expect(clipBaseName('   ')).toBe('未命名剪藏');
    expect(clipBaseName('...')).toBe('未命名剪藏');
  });
});

describe('uniqueFileName', () => {
  it('不重名时直接用 名.md', () => {
    expect(uniqueFileName('文章', ['别的.md'])).toBe('文章.md');
  });

  it('重名依次加 (2)、(3)', () => {
    expect(uniqueFileName('文章', ['文章.md'])).toBe('文章 (2).md');
    expect(uniqueFileName('文章', ['文章.md', '文章 (2).md'])).toBe('文章 (3).md');
  });

  it('按不分大小写的文件系统判重', () => {
    expect(uniqueFileName('Title', ['title.md'])).toBe('Title (2).md');
    expect(sameFileName('A.md', 'a.md')).toBe(true);
  });
});
