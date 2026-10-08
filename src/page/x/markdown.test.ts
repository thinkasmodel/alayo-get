import { describe, expect, it } from 'vitest';
import type { XPost, XQuote } from './cells';
import { formatDuration, localDate, plainText, postsToMarkdown, postToMarkdown } from './markdown';

function post(overrides: Partial<XPost> = {}): XPost {
  return {
    id: '1',
    handle: 'ada',
    name: 'Ada',
    datetime: '2026-10-01T04:00:00.000Z',
    url: 'https://x.com/ada/status/1',
    textMd: '你好',
    truncated: false,
    media: [],
    quote: null,
    card: null,
    ...overrides,
  };
}

function quote(overrides: Partial<XQuote> = {}): XQuote {
  return {
    name: 'Bob',
    handle: 'bob',
    datetime: '2026-09-14T10:37:23.000Z',
    url: 'https://x.com/bob/status/9',
    textMd: '第一段\n第二行\n\n第二段',
    media: [],
    truncated: false,
    ...overrides,
  };
}

describe('postToMarkdown', () => {
  it('单个 \\n 输出为 `\\` 加换行，\\n\\n 输出为空行；行首尾空白去掉，三个以上换行也只空一行', () => {
    expect(postToMarkdown(post({ textMd: '一\n二\n\n三' }))).toBe('一\\\n二\n\n三');
    expect(postToMarkdown(post({ textMd: '  一 \n\n\n\n二\n' }))).toBe('一\n\n二');
  });

  it('截断的帖子在正文末尾接 ` … [全文](url)`', () => {
    expect(postToMarkdown(post({ textMd: '开头', truncated: true }))).toBe('开头 … [全文](https://x.com/ada/status/1)');
  });

  it('媒体按原顺序：图片、视频封面加时长链接、GIF 不写时长、没有时长写“▶ 视频”', () => {
    const md = postToMarkdown(
      post({
        textMd: '',
        media: [
          { kind: 'photo', url: 'https://pbs.twimg.com/media/A?format=jpg&name=large' },
          { kind: 'video', poster: 'https://pbs.twimg.com/v1.jpg', durationMs: 13_866, href: 'https://x.com/ada/status/1/video/2' },
          { kind: 'video', poster: 'https://pbs.twimg.com/v2.jpg', durationMs: 3_723_000, href: 'https://x.com/ada/status/1/video/3' },
          { kind: 'gif', poster: 'https://pbs.twimg.com/g.jpg', durationMs: null, href: 'https://x.com/ada/status/1/video/4' },
          { kind: 'video', poster: 'https://pbs.twimg.com/v3.jpg', durationMs: null, href: 'https://x.com/ada/status/1/video/5' },
        ],
      }),
    );
    expect(md).toBe(
      [
        '![](https://pbs.twimg.com/media/A?format=jpg&name=large)',
        '![](https://pbs.twimg.com/v1.jpg)',
        '[▶ 视频 (0:13)](https://x.com/ada/status/1/video/2)',
        '![](https://pbs.twimg.com/v2.jpg)',
        '[▶ 视频 (1:02:03)](https://x.com/ada/status/1/video/3)',
        '![](https://pbs.twimg.com/g.jpg)',
        '[▶ GIF](https://x.com/ada/status/1/video/4)',
        '![](https://pbs.twimg.com/v3.jpg)',
        '[▶ 视频](https://x.com/ada/status/1/video/5)',
      ].join('\n\n'),
    );
  });

  it('卡片写 `[label](url)`', () => {
    expect(postToMarkdown(post({ textMd: '看这个', card: { url: 'https://example.com/a', label: 'A [title]' } }))).toBe(
      '看这个\n\n[A \\[title\\]](https://example.com/a)',
    );
  });

  it('引用帖整个是 blockquote：每行有 `> ` 前缀，空行写成 `>`，首行是作者、日期、原帖链接', () => {
    const q = quote({ media: [{ kind: 'photo', url: 'https://pbs.twimg.com/media/Q?name=large' }] });
    const md = postToMarkdown(post({ textMd: '外层', quote: q }));
    const date = localDate(q.datetime);
    expect(md).toBe(
      [
        '外层',
        '',
        `> **Bob (@bob)** · ${date} · [原帖](https://x.com/bob/status/9)`,
        '>',
        '> 第一段\\',
        '> 第二行',
        '>',
        '> 第二段',
        '>',
        '> ![](https://pbs.twimg.com/media/Q?name=large)',
      ].join('\n'),
    );
    for (const line of md.split('\n').slice(2)) expect(line === '>' || line.startsWith('> ')).toBe(true);
  });

  it('引用没有原帖地址：首行去掉 [原帖]；截断时 [全文] 取外层帖子地址', () => {
    const md = postToMarkdown(post({ textMd: '外层', quote: quote({ url: '', textMd: '引用开头', truncated: true }) }));
    expect(md).toContain(`> **Bob (@bob)** · ${localDate('2026-09-14T10:37:23.000Z')}\n>\n> 引用开头 … [全文](https://x.com/ada/status/1)`);
    expect(md).not.toContain('[原帖]');
  });

  it('引用截断且有原帖地址：[全文] 取原帖地址', () => {
    const md = postToMarkdown(post({ quote: quote({ textMd: '引用开头', truncated: true }) }));
    expect(md).toContain('> 引用开头 … [全文](https://x.com/bob/status/9)');
  });
});

describe('postsToMarkdown', () => {
  it('作者串：帖与帖之间空一行，不加分隔线', () => {
    const md = postsToMarkdown([post({ textMd: '一' }), post({ id: '2', textMd: '二' }), post({ id: '3', textMd: '三' })]);
    expect(md).toBe('一\n\n二\n\n三');
    expect(md).not.toContain('---');
  });
});

describe('formatDuration', () => {
  it('按 Math.floor(ms / 1000) 秒计：m:ss，满 1 小时 h:mm:ss', () => {
    expect(formatDuration(12_836)).toBe('0:12');
    expect(formatDuration(13_866)).toBe('0:13');
    expect(formatDuration(62_000)).toBe('1:02');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });
});

describe('plainText', () => {
  it('链接留文字，图片、转义、硬换行、引用前缀去掉，空白合并', () => {
    expect(plainText('看 [github.com/a\\_b](https://github.com/a_b)\\\n第二行\n\n![](https://x/y.jpg)\n\n> **Bob** 1\\. 二')).toBe(
      '看 github.com/a_b 第二行 Bob 1. 二',
    );
  });
});
