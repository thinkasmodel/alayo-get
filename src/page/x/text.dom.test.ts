import { describe, expect, it } from 'vitest';
import { planImages } from '@/core/images';
import { paragraphs } from './markdown';
import { tweetTextToMarkdown } from './text';

function el(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('tweetTextToMarkdown', () => {
  it('行首像 Markdown 语法的文本被转义；行首空白去掉后也不会变成列表或标题', () => {
    const md = paragraphs(tweetTextToMarkdown(el('<span>第一行\n  - 不是列表\n# 不是标题\n&gt; 不是引用\n1. 不是编号</span>'), {}));
    expect(md).toBe('第一行\\\n\\- 不是列表\\\n\\# 不是标题\\\n\\> 不是引用\\\n1\\. 不是编号');
  });

  it('提及、话题、站内相对链接补成 https://x.com；t.co 按映射还原', () => {
    const md = tweetTextToMarkdown(
      el(
        '<a href="/naval">@naval</a> <a href="/hashtag/AI?src=hashtag_click">#AI</a> <a href="/search?q=%24TSLA">$TSLA</a> ' +
          '<a href="https://t.co/abc"><span aria-hidden="true">https://</span>example.com/a_b</a>',
      ),
      { 'https://t.co/abc': 'https://example.com/a_b' },
    );
    expect(md).toBe(
      '[@naval](https://x.com/naval) [#AI](https://x.com/hashtag/AI) [$TSLA](https://x.com/search?q=%24TSLA) [example.com/a\\_b](https://example.com/a_b)',
    );
  });

  it('正文 `look!` 紧接链接：不会拼成图片语法（codex review 第 2 轮）', () => {
    const md = tweetTextToMarkdown(el('<span>look!</span><a href="https://t.co/x">example.com</a>'), { 'https://t.co/x': 'https://example.com/a.png' });
    expect(md).toBe('look\\![example.com/a.png](https://example.com/a.png)');
    // 只剩转义过的 `\![`，没有未转义的图片语法开头
    expect(md).not.toMatch(/(^|[^\\])!\[/);
    expect(planImages(md)).toEqual([]);
  });

  it('`<` 和 `&` 转义成字面字符', () => {
    expect(tweetTextToMarkdown(el('<span>&lt;div&gt; &amp; co</span>'), {})).toBe('\\<div> \\& co');
  });
});
