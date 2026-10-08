import { describe, expect, it } from 'vitest';
import { encodeFragmentPart, fragmentUrl } from './textFragment';

describe('encodeFragmentPart', () => {
  it('encodeURIComponent 之外把 - 也编码；, 与 & 已被编码', () => {
    expect(encodeFragmentPart('a-b,c&d 中')).toBe('a%2Db%2Cc%26d%20%E4%B8%AD');
  });
});

describe('fragmentUrl', () => {
  const page = 'https://example.com/post?id=7';

  it('只有 textStart', () => {
    expect(fragmentUrl(page, { textStart: 'hello world' })).toBe('https://example.com/post?id=7#:~:text=hello%20world');
  });

  it('textStart 加 textEnd', () => {
    expect(fragmentUrl(page, { textStart: '快思考', textEnd: 'a-b' })).toBe(
      'https://example.com/post?id=7#:~:text=%E5%BF%AB%E6%80%9D%E8%80%83,a%2Db',
    );
  });

  it('带 prefix 与 suffix：前缀-, 与 ,-后缀', () => {
    expect(fragmentUrl(page, { prefix: 'the', textStart: 'quick', textEnd: 'fox', suffix: 'jumps' })).toBe(
      'https://example.com/post?id=7#:~:text=the-,quick,fox,-jumps',
    );
  });

  it('原地址有 #sec 时接成 #sec:~:text=', () => {
    expect(fragmentUrl('https://example.com/post#sec', { textStart: 'x' })).toBe('https://example.com/post#sec:~:text=x');
  });

  it('原地址已带 :~: 指令时先去掉再接新的', () => {
    expect(fragmentUrl('https://example.com/post#:~:text=old', { textStart: 'new' })).toBe('https://example.com/post#:~:text=new');
    expect(fragmentUrl('https://example.com/post#sec:~:text=old,er', { textStart: 'new' })).toBe('https://example.com/post#sec:~:text=new');
  });
});
