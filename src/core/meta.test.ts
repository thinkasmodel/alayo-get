import { describe, expect, it } from 'vitest';
import { decodeEntities, parseHtmlMeta } from './meta';

const PAGE = 'https://example.com/blog/post.html';

describe('parseHtmlMeta', () => {
  it('og 字段优先', () => {
    const html = `<!doctype html><html><head>
      <title>页面标题 - 站点</title>
      <meta name="description" content="普通描述">
      <meta property="og:title" content="OG 标题">
      <meta property="og:description" content="OG 描述">
      <meta property="og:image" content="https://cdn.example.com/cover.jpg">
      <meta property="og:site_name" content="示例站">
      <meta property="article:published_time" content="2026-10-01T08:00:00Z">
      <meta name="author" content="Ada">
    </head><body></body></html>`;
    expect(parseHtmlMeta(html, PAGE)).toEqual({
      title: 'OG 标题',
      description: 'OG 描述',
      image: 'https://cdn.example.com/cover.jpg',
      siteName: '示例站',
      published: '2026-10-01T08:00:00Z',
      author: 'Ada',
    });
  });

  it('没有 og 字段时退回 <title> 和 description', () => {
    const html = `<html><head><TITLE lang="zh">
        只有   标题
      </TITLE><meta name="description" content="普通描述"></head></html>`;
    const meta = parseHtmlMeta(html, PAGE);
    expect(meta.title).toBe('只有 标题');
    expect(meta.description).toBe('普通描述');
    expect(meta.image).toBe('');
  });

  it('解码 HTML 实体', () => {
    const html = `<title>A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39; &#20013;&#x6587; &amp;lt;</title>
      <meta property="og:description" content="Tom &amp; Jerry&#39;s &#x1F600;">`;
    const meta = parseHtmlMeta(html, PAGE);
    expect(meta.title).toBe(`A & B <C> "D" 'E' 中文 &lt;`);
    expect(meta.description).toBe("Tom & Jerry's 😀");
  });

  it('相对地址的 og:image 转成绝对地址', () => {
    expect(parseHtmlMeta('<meta property="og:image" content="../img/cover.png">', PAGE).image).toBe(
      'https://example.com/img/cover.png',
    );
    expect(parseHtmlMeta('<meta property="og:image" content="//cdn.example.net/c.webp">', PAGE).image).toBe(
      'https://cdn.example.net/c.webp',
    );
  });

  it('属性顺序颠倒的 meta 标签', () => {
    const html = `<meta content="倒序标题" property="og:title"><meta content="倒序描述" name="description" />`;
    const meta = parseHtmlMeta(html, PAGE);
    expect(meta.title).toBe('倒序标题');
    expect(meta.description).toBe('倒序描述');
  });

  it('单引号属性', () => {
    const html = `<meta property='og:title' content='单引号 "标题"'><meta name='author' content='Bob'>`;
    const meta = parseHtmlMeta(html, PAGE);
    expect(meta.title).toBe('单引号 "标题"');
    expect(meta.author).toBe('Bob');
  });
});

describe('decodeEntities', () => {
  it('只解码一遍', () => {
    expect(decodeEntities('&amp;amp;')).toBe('&amp;');
  });

  it('不认识的实体原样保留', () => {
    expect(decodeEntities('&nbsp;&foo;')).toBe('&nbsp;&foo;');
  });
});
