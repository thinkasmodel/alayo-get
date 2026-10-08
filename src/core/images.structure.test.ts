// codex review ALAG-2A 第 2 轮：图片按 Markdown 结构识别，不截断带括号的地址，不动代码块。
import { describe, expect, it } from 'vitest';
import { findImages, planImages, rewriteImages } from './images';

describe('按结构识别图片', () => {
  it('地址里有转义括号（Turndown 的输出形式）：完整识别并解码', () => {
    const md = '![图](https://img.example.com/photo\\(1\\).png)';
    expect(planImages(md)).toEqual([{ url: 'https://img.example.com/photo(1).png', index: 1 }]);
    const out = rewriteImages(md, new Map([['https://img.example.com/photo(1).png', '.assets/X/1.png']]));
    expect(out).toBe('![图](.assets/X/1.png)');
  });

  it('地址里有成对的未转义括号：完整识别', () => {
    const md = '![wiki](https://upload.example.org/File_(2020).jpg "标题")';
    expect(planImages(md).map((p) => p.url)).toEqual(['https://upload.example.org/File_(2020).jpg']);
    const out = rewriteImages(md, new Map([['https://upload.example.org/File_(2020).jpg', '.assets/X/1.jpg']]));
    expect(out).toBe('![wiki](.assets/X/1.jpg "标题")');
  });

  it('尖括号包起来的地址', () => {
    const md = '![a](<https://img.example.com/a b.png>)';
    expect(planImages(md).map((p) => p.url)).toEqual(['https://img.example.com/a b.png']);
  });

  it('围栏代码块里的图片语法不下载、不改写', () => {
    const md = ['正文', '', '```markdown', '![example](https://img.example.com/example.png)', '```', '', '~~~', '![x](https://img.example.com/x.png)', '~~~'].join('\n');
    expect(planImages(md)).toEqual([]);
    expect(rewriteImages(md, new Map([['https://img.example.com/example.png', '.assets/X/1.png']]))).toBe(md);
  });

  it('行内代码里的图片语法不下载', () => {
    const md = '写法是 `![alt](https://img.example.com/in-code.png)`，真正的图：![](https://img.example.com/real.png)';
    expect(planImages(md).map((p) => p.url)).toEqual(['https://img.example.com/real.png']);
  });

  it('代码块结束后的图片照常识别', () => {
    const md = ['```', 'code', '```', '![after](https://img.example.com/after.png)'].join('\n');
    expect(planImages(md).map((p) => p.url)).toEqual(['https://img.example.com/after.png']);
  });

  it('链接里套图片：识别里面的图片', () => {
    const md = '[![封面](https://img.example.com/c.png)](https://example.com/post)';
    expect(findImages(md).map((r) => r.url)).toEqual(['https://img.example.com/c.png']);
  });

  it('转义的感叹号不是图片', () => {
    expect(planImages('\\![不是图](https://img.example.com/no.png)')).toEqual([]);
  });
});
