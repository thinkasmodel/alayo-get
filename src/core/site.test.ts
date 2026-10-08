import { describe, expect, it } from 'vitest';
import { mediaCredentials, sameSite } from './site';

describe('sameSite', () => {
  it('子域与主域同站', () => {
    expect(sameSite('https://sspai.com/p', 'https://cdn.sspai.com/a.jpg')).toBe(true);
  });

  it('不同可注册域不同站', () => {
    expect(sameSite('https://a.com', 'https://b.com')).toBe(false);
  });

  it('私有后缀（github.io）下的两个子域不同站', () => {
    expect(sameSite('https://x.github.io', 'https://y.github.io')).toBe(false);
  });

  it('多级公共后缀（co.uk）按 eTLD+1 判', () => {
    expect(sameSite('https://a.co.uk', 'https://cdn.a.co.uk')).toBe(true);
  });

  it('协议不同不同站（schemeful）', () => {
    expect(sameSite('http://a.com', 'https://a.com')).toBe(false);
  });

  it('端口不计', () => {
    expect(sameSite('https://a.com:8443', 'https://a.com')).toBe(true);
  });

  it('IP 只在完全相同时同站', () => {
    expect(sameSite('http://127.0.0.1/x', 'http://127.0.0.1:3000/y')).toBe(true);
    expect(sameSite('http://127.0.0.1/x', 'http://127.0.0.2')).toBe(false);
  });

  it('localhost 同名同站', () => {
    expect(sameSite('http://localhost/a', 'http://localhost:5173/b')).toBe(true);
  });

  it('data:、ftp:、非法地址一律不同站', () => {
    expect(sameSite('data:image/png;base64,iVBORw0KGgo=', 'data:image/png;base64,iVBORw0KGgo=')).toBe(false);
    expect(sameSite('https://a.com', 'data:image/png;base64,iVBORw0KGgo=')).toBe(false);
    expect(sameSite('ftp://a.com/x', 'ftp://a.com/y')).toBe(false);
    expect(sameSite('not a url', 'https://a.com')).toBe(false);
    expect(sameSite('https://a.com', '')).toBe(false);
  });
});

describe('mediaCredentials', () => {
  it('同站带 cookie，跨站不带', () => {
    expect(mediaCredentials('https://blog.example.com/post', 'https://cdn.example.com/a.pdf')).toBe('include');
    expect(mediaCredentials('https://blog.example.com/post', 'https://files.other.com/a.pdf')).toBe('omit');
  });
});
