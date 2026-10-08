import { describe, expect, it } from 'vitest';
import { parseXStatusUrl, xStatusUrl } from './url';

describe('parseXStatusUrl', () => {
  it('x.com、twitter.com、mobile.twitter.com 的帖子页', () => {
    expect(parseXStatusUrl('https://x.com/naval/status/1002103360646823936')).toEqual({ handle: 'naval', id: '1002103360646823936' });
    expect(parseXStatusUrl('https://twitter.com/naval/status/1002103360646823936')).toEqual({ handle: 'naval', id: '1002103360646823936' });
    expect(parseXStatusUrl('https://mobile.twitter.com/p4nthera_/status/2107175720086589633')).toEqual({
      handle: 'p4nthera_',
      id: '2107175720086589633',
    });
  });

  it('后面跟 /photo/1、/video/1、/history、/analytics、?s=20、# 也认', () => {
    const want = { handle: 'viktoroddy', id: '2107279715195392141' };
    for (const tail of ['/photo/1', '/video/1', '/history', '/analytics', '?s=20', '#', '#m', '/']) {
      expect(parseXStatusUrl(`https://x.com/viktoroddy/status/2107279715195392141${tail}`)).toEqual(want);
    }
  });

  it('主页、个人页、/i/…、/search、别的站返回 null', () => {
    for (const url of [
      'https://x.com/',
      'https://x.com/home',
      'https://x.com/naval',
      'https://x.com/naval/with_replies',
      'https://x.com/i/bookmarks',
      'https://x.com/i/status/1002103360646823936',
      'https://x.com/i/article/2077744776565149697',
      'https://x.com/search?q=naval&src=typed_query',
      'https://x.com/naval/status/',
      'https://x.com/naval/status/abc',
      'https://example.com/naval/status/1002103360646823936',
      'not a url',
    ]) {
      expect(parseXStatusUrl(url), url).toBeNull();
    }
  });
});

describe('xStatusUrl', () => {
  it('生成 x.com 帖子地址', () => {
    expect(xStatusUrl('naval', '1002103360646823936')).toBe('https://x.com/naval/status/1002103360646823936');
  });
});
