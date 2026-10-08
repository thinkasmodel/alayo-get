import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from './canonical';

describe('canonicalizeUrl', () => {
  it('去掉 utm 参数和 fragment', () => {
    expect(canonicalizeUrl('https://example.com/post?utm_source=x&utm_medium=y#section-2')).toBe(
      'https://example.com/post',
    );
  });

  it('去掉其余跟踪参数，保留其他参数的原顺序', () => {
    expect(
      canonicalizeUrl('https://example.com/a?z=1&fbclid=abc&b=2&gclid=g&a=3&si=s&spm=p&UTM_Campaign=c&ref_src=r'),
    ).toBe('https://example.com/a?z=1&b=2&a=3');
  });

  it('保留参数的原编码', () => {
    expect(canonicalizeUrl('https://example.com/s?q=%E4%B8%AD%E6%96%87+x&utm_id=1')).toBe(
      'https://example.com/s?q=%E4%B8%AD%E6%96%87+x',
    );
  });

  it('微信文章只保留 __biz、mid、idx、sn 四个参数', () => {
    expect(
      canonicalizeUrl(
        'https://mp.weixin.qq.com/s?__biz=MzA5&mid=2650&idx=1&sn=abcd&chksm=xyz&scene=21&key=k#wechat_redirect',
      ),
    ).toBe('https://mp.weixin.qq.com/s?__biz=MzA5&mid=2650&idx=1&sn=abcd');
  });

  it('去掉参数后查询串为空的，连 ? 一起去掉', () => {
    expect(canonicalizeUrl('https://example.com/p?utm_source=a&fbclid=b')).toBe('https://example.com/p');
    expect(canonicalizeUrl('https://example.com/p?')).toBe('https://example.com/p');
  });

  it('协议和主机名转小写，去掉默认端口', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM:443/Path/To?Q=1')).toBe('https://example.com/Path/To?Q=1');
    expect(canonicalizeUrl('http://Example.com:80/')).toBe('http://example.com/');
    expect(canonicalizeUrl('http://example.com:8080/')).toBe('http://example.com:8080/');
  });

  it('解析不了的地址原样返回', () => {
    expect(canonicalizeUrl('  not a url ')).toBe('not a url');
  });
});
