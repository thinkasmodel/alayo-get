// Turndown 输出 → 图片规划 → 重写 的联合回归（codex review ALAG-2A 第 2 轮）。
import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import { planImages, rewriteImages } from './images';

const turndown = () => new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });

describe('Turndown 与图片规划联动', () => {
  it('带括号的图片地址：下载的是完整地址，重写后不残留', () => {
    const md = turndown().turndown('<p><img src="https://img.example.com/photo(1).png" alt="图"></p>');
    const plan = planImages(md);
    expect(plan.map((p) => p.url)).toEqual(['https://img.example.com/photo(1).png']);
    const out = rewriteImages(md, new Map([['https://img.example.com/photo(1).png', '.assets/X/1.png']]));
    expect(out).toBe('![图](.assets/X/1.png)');
  });

  it('代码块里的图片语法原样保留', () => {
    const html = '<pre><code>![example](https://img.example.com/example.png)</code></pre><p><img src="https://img.example.com/real.png" alt=""></p>';
    const md = turndown().turndown(html);
    expect(planImages(md).map((p) => p.url)).toEqual(['https://img.example.com/real.png']);
    const out = rewriteImages(md, new Map([
      ['https://img.example.com/example.png', '.assets/X/9.png'],
      ['https://img.example.com/real.png', '.assets/X/1.png'],
    ]));
    expect(out).toContain('![example](https://img.example.com/example.png)');
    expect(out).toContain('![](.assets/X/1.png)');
  });

  it('alt 里有换行的图片：照样识别并改写（codex review 第 5 轮）', () => {
    const md = turndown().turndown('<p><img src="https://img.example.com/multi.png" alt="第一行\n第二行"></p>');
    expect(md).toContain('\n');
    expect(planImages(md).map((p) => p.url)).toEqual(['https://img.example.com/multi.png']);
    const out = rewriteImages(md, new Map([['https://img.example.com/multi.png', '.assets/X/1.png']]));
    expect(out).toContain('(.assets/X/1.png)');
    expect(out).not.toContain('https://img.example.com/multi.png');
  });

  it('alt 不跨空行：段落之间的方括号不会被拼成图片', () => {
    const md = '![未闭合\n\n另一段](https://img.example.com/no.png)';
    expect(planImages(md)).toEqual([]);
  });

  it('引用块里的代码块：图片示例不下载、不改写（codex review 第 3 轮）', () => {
    const html = '<blockquote><pre><code>![q](https://img.example.com/quoted.png)</code></pre></blockquote>';
    const md = turndown().turndown(html);
    expect(md).toContain('> ```');
    expect(planImages(md)).toEqual([]);
    expect(rewriteImages(md, new Map([['https://img.example.com/quoted.png', '.assets/X/1.png']]))).toBe(md);
  });

  it('列表里的代码块：图片示例不下载、不改写（codex review 第 3 轮）', () => {
    const html = '<ul><li><p>步骤</p><pre><code>![l](https://img.example.com/listed.png)</code></pre></li></ul>';
    const md = turndown().turndown(html);
    expect(planImages(md)).toEqual([]);
    expect(rewriteImages(md, new Map([['https://img.example.com/listed.png', '.assets/X/1.png']]))).toBe(md);
  });
});
