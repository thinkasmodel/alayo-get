import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { emitFrontmatter, updateFrontmatter, type FrontmatterFields } from './frontmatter';

const base: FrontmatterFields = {
  id: '01JABCDEF0123456789XYZABCD',
  source: 'https://www.example.com/post?id=1',
  medium: 'web',
  title: '普通标题',
  author: 'Ada',
  published: '2026-10-05T08:00:00+08:00',
  captured: new Date('2026-10-06T01:02:03.000Z'),
  tags: ['设计', '界面文案'],
  note: '',
  extract: 'full',
};

/** 取出 --- 块之间的 YAML 文本并解析。 */
function parseBlock(fm: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n$/.exec(fm);
  if (!m?.[1]) throw new Error('frontmatter 格式不对');
  return parse(m[1]) as Record<string, unknown>;
}

describe('emitFrontmatter', () => {
  it('键序固定、每键一行，YAML 解析回原值', () => {
    const fm = emitFrontmatter(base);
    const lines = fm.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines.slice(1, 12).map((l) => l.split(':')[0])).toEqual([
      'id',
      'source',
      'medium',
      'title',
      'author',
      'published',
      'captured',
      'site',
      'tags',
      'note',
      'extract',
    ]);
    expect(lines[12]).toBe('---');
    expect(fm.endsWith('---\n')).toBe(true);
    expect(fm).toContain('tags: ["设计", "界面文案"]\n');

    expect(parseBlock(fm)).toEqual({
      id: base.id,
      source: base.source,
      medium: 'web',
      title: '普通标题',
      author: 'Ada',
      published: '2026-10-05T00:00:00.000Z',
      captured: '2026-10-06T01:02:03.000Z',
      site: 'example.com',
      tags: ['设计', '界面文案'],
      note: '',
      extract: 'full',
    });
  });

  it('标题含中文冒号、半角引号、换行等，仍能解析回原值', () => {
    const tricky = [
      '设计：界面文案',
      '他说 "hello": world',
      "it's # not a comment",
      '第一行\n第二行\r\n第三行',
      '- 开头像列表',
      '[像数组] {像对象}',
      'tab\there \\ 反斜杠',
      `控制字符${String.fromCharCode(1)}与 DEL${String.fromCharCode(0x7f)}与 NEL${String.fromCharCode(0x85)}`,
      `行分隔${String.fromCharCode(0x2028)}段分隔${String.fromCharCode(0x2029)}`,
      'emoji 😀 与 &amp;',
    ];
    for (const title of tricky) {
      const fm = emitFrontmatter({ ...base, title, note: title, tags: [title, 'x'] });
      // 每个键仍只占一行
      expect(fm.split('\n')).toHaveLength(14);
      const data = parseBlock(fm);
      expect(data.title).toBe(title);
      expect(data.note).toBe(title);
      expect(data.tags).toEqual([title, 'x']);
    }
  });

  it('空值写 ""，空 tags 写 []', () => {
    const fm = emitFrontmatter({ ...base, author: '', published: '', tags: [] });
    expect(fm).toContain('author: ""\n');
    expect(fm).toContain('published: ""\n');
    expect(fm).toContain('tags: []\n');
    expect(parseBlock(fm).tags).toEqual([]);
  });

  it('published 解析不了的原样保留', () => {
    const fm = emitFrontmatter({ ...base, published: '上周三' });
    expect(parseBlock(fm).published).toBe('上周三');
  });

  it('site 取主机名并去掉开头的 www.', () => {
    expect(parseBlock(emitFrontmatter({ ...base, source: 'https://WWW.Blog.example.org/x' })).site).toBe(
      'blog.example.org',
    );
  });
});

describe('updateFrontmatter', () => {
  const md = emitFrontmatter(base) + '\n# 普通标题\n\n[原文](https://www.example.com/post?id=1)\n\nnote: 正文里的同名行\n';

  it('只改目标行，其余字节不变', () => {
    const out = updateFrontmatter(md, { note: '新的批注：带"引号"' });
    const before = md.split('\n');
    const after = out.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.map((line, i) => (line === before[i] ? -1 : i)).filter((i) => i >= 0);
    expect(changed).toEqual([10]);
    expect(after[10]).toBe('note: "新的批注：带\\"引号\\""');
    expect(parseBlock(out.slice(0, out.indexOf('\n---\n') + 5)).note).toBe('新的批注：带"引号"');
    // 正文里同名的行不动
    expect(out.endsWith('note: 正文里的同名行\n')).toBe(true);
  });

  it('同时改标题和标签', () => {
    const out = updateFrontmatter(md, { title: '新标题', tags: ['a'] });
    const data = parseBlock(out.slice(0, out.indexOf('\n---\n') + 5));
    expect(data.title).toBe('新标题');
    expect(data.tags).toEqual(['a']);
    expect(data.note).toBe('');
    expect(out.replace(/^title: .*$/m, '').replace(/^tags: .*$/m, '')).toBe(
      md.replace(/^title: .*$/m, '').replace(/^tags: .*$/m, ''),
    );
  });

  it('没有 --- 块时抛错', () => {
    expect(() => updateFrontmatter('# 没有 frontmatter\n', { note: 'x' })).toThrow();
  });
});
