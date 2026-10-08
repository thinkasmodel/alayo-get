// X 剪藏正文里随语言变化的固定文字：视频标记、截断长帖的全文链接、引用头的原帖链接（ALAG-7 brief A §8）。
import { beforeEach, describe, expect, it } from 'vitest';
import { CJK, useLocale } from '../../../tests/setup/i18n';
import type { XPost, XQuote } from './cells';
import { localDate, postToMarkdown } from './markdown';

function post(overrides: Partial<XPost> = {}): XPost {
  return {
    id: '1876543210',
    handle: 'janedoe',
    name: 'Jane Doe',
    datetime: '2026-10-07T04:00:00.000Z',
    url: 'https://x.com/janedoe/status/1876543210',
    textMd: 'Shipping the new onboarding today.',
    truncated: false,
    media: [],
    quote: null,
    card: null,
    ...overrides,
  };
}

const quote = (overrides: Partial<XQuote> = {}): XQuote => ({
  name: 'Alayo',
  handle: 'alayo',
  datetime: '2026-10-06T10:00:00.000Z',
  url: 'https://x.com/alayo/status/1876500000',
  textMd: 'A long quoted post',
  media: [],
  truncated: false,
  ...overrides,
});

beforeEach(() => useLocale('en'));

describe('英文：X 剪藏的固定文字', () => {
  it('视频标记 ▶ Video (0:42) / ▶ Video；GIF 不变', () => {
    const md = postToMarkdown(
      post({
        textMd: '',
        media: [
          { kind: 'video', poster: 'https://pbs.twimg.com/v1.jpg', durationMs: 42_000, href: 'https://x.com/janedoe/status/1876543210/video/1' },
          { kind: 'gif', poster: 'https://pbs.twimg.com/g.jpg', durationMs: null, href: 'https://x.com/janedoe/status/1876543210/video/2' },
          { kind: 'video', poster: 'https://pbs.twimg.com/v2.jpg', durationMs: null, href: 'https://x.com/janedoe/status/1876543210/video/3' },
        ],
      }),
    );
    expect(md).toContain('[▶ Video (0:42)](https://x.com/janedoe/status/1876543210/video/1)');
    expect(md).toContain('[▶ GIF](https://x.com/janedoe/status/1876543210/video/2)');
    expect(md).toContain('[▶ Video](https://x.com/janedoe/status/1876543210/video/3)');
  });

  it('截断长帖：… [Full post](url)', () => {
    expect(postToMarkdown(post({ textMd: 'Start', truncated: true }))).toBe('Start … [Full post](https://x.com/janedoe/status/1876543210)');
  });

  it('引用头 [Post](url)；引用截断时 [Full post] 取原帖地址', () => {
    const md = postToMarkdown(post({ quote: quote({ truncated: true }) }));
    expect(md).toContain(`> **Alayo (@alayo)** · ${localDate('2026-10-06T10:00:00.000Z')} · [Post](https://x.com/alayo/status/1876500000)`);
    expect(md).toContain('> A long quoted post … [Full post](https://x.com/alayo/status/1876500000)');
    expect(md).not.toMatch(CJK);
  });
});
