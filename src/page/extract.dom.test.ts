import { describe, expect, it } from 'vitest';
import articleHtml from '../../tests/fixtures/article.html?raw';
import codeHtml from '../../tests/fixtures/code.html?raw';
import shortHtml from '../../tests/fixtures/short.html?raw';
import { extractFromDocument, MIN_TEXT_LENGTH, stripImageRdfa } from './extract';

/**
 * 用手写的合成页面构造文档。全局 jsdom 的地址是 localhost，测不了相对地址，
 * 所以加一个 <base> 让 baseURI 等于假定的页面地址。
 */
function load(html: string, url: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);
  return doc;
}

describe('extractFromDocument', () => {
  it('正常文章：取到标题，textLength ≥ 200，相对路径图片转成绝对地址的 ![](…)', () => {
    const url = 'https://blog.example.com/posts/2026/clipper.html';
    const doc = load(articleHtml, url);
    const capture = extractFromDocument(doc, url);

    expect(capture.kind).toBe('page');
    expect(capture.url).toBe(url);
    expect(capture.title).toContain('合成文章：如何写一个剪藏扩展');
    expect(capture.textLength).toBeGreaterThanOrEqual(MIN_TEXT_LENGTH);
    expect(capture.markdown).not.toBeNull();
    const md = capture.markdown ?? '';
    expect(md).toMatch(/!\[示意图\]\(https:\/\/blog\.example\.com\/posts\/2026\/images\/figure-1\.png\)/);
    expect(md).toContain('(https://blog.example.com/posts/notes/design.html)');
    expect(md).not.toContain('](images/');
    expect(capture.description).toBe('一篇手写的合成文章，用来测试正文抽取。');
    expect(capture.coverUrl).toBe('https://blog.example.com/static/cover.jpg');
    // 原文档没有被 Defuddle 改动（抽取用的是副本）
    expect(doc.querySelector('footer')).not.toBeNull();
    expect(doc.querySelector('nav')).not.toBeNull();
  });

  it('短页面：markdown 为 null，退化为书签剪藏', () => {
    const url = 'https://example.com/short';
    const capture = extractFromDocument(load(shortHtml, url), url);
    expect(capture.markdown).toBeNull();
    expect(capture.textLength).toBeLessThan(MIN_TEXT_LENGTH);
    expect(capture.title).toBe('一个很短的页面');
    expect(capture.description).toBe('几乎没有正文的页面。');
  });

  it('带代码块的文章：输出 fenced 代码块', () => {
    const url = 'https://dev.example.com/post';
    const capture = extractFromDocument(load(codeHtml, url), url);
    expect(capture.markdown).not.toBeNull();
    const md = capture.markdown ?? '';
    expect(md).toMatch(/```[a-z]*\nfunction add\(a, b\) \{\n {2}return a \+ b;\n\}\nconsole\.log\(add\(1, 2\)\);\n```/);
    expect(md).not.toMatch(/^ {4}function add/m);
  });
});

// ALAG-8：Defuddle 的懒加载图片规则会把 img 上任何“像图片地址”的属性值换进 src；
// 维基百科的 <img resource="…/wiki/File:X.png"> 因此被存成了说明页。真机复现见 experiments/alag-8-image-probe.mjs（jsdom 里 Defuddle 走不到这条规则）。
describe('stripImageRdfa', () => {
  it('去掉 img 的 RDFa resource、about 属性，src 与其他属性不变', () => {
    const doc = new DOMParser().parseFromString(
      '<figure><a href="https://en.wikipedia.org/wiki/File:A.png"><img resource="https://en.wikipedia.org/wiki/File:A.png" about="#x" src="//upload.wikimedia.org/a/A.png" loading="lazy" data-src="https://cdn.example/A-large.png" alt="A"></a></figure><div resource="keep"></div>',
      'text/html',
    );
    stripImageRdfa(doc);
    const img = doc.querySelector('img');
    expect(img?.hasAttribute('resource')).toBe(false);
    expect(img?.hasAttribute('about')).toBe(false);
    expect(img?.getAttribute('src')).toBe('//upload.wikimedia.org/a/A.png');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('data-src')).toBe('https://cdn.example/A-large.png');
    expect(doc.querySelector('div')?.getAttribute('resource')).toBe('keep');
  });
});
