import { describe, expect, it } from 'vitest';
import {
  decodeDataUrl,
  extForMedia,
  fileNameFromContentDisposition,
  fileNameFromUrl,
  formatProgressBytes,
  isMediaDocument,
  mediaBaseName,
  mediaKeyOf,
  mediaKindFromContentType,
  mediaUrlForMeta,
  parseMediaMeta,
  serializeMediaMeta,
  splitExt,
} from './media';

describe('媒体剪藏的纯函数', () => {
  it('类别：按 content-type', () => {
    expect(mediaKindFromContentType('image/jpeg')).toBe('image');
    expect(mediaKindFromContentType('application/pdf; charset=binary')).toBe('pdf');
    expect(mediaKindFromContentType('audio/mpeg')).toBe('audio');
    expect(mediaKindFromContentType('video/mp4')).toBe('video');
    expect(mediaKindFromContentType('text/html')).toBeNull();
    expect(mediaKindFromContentType(null)).toBeNull();
  });

  it('原文件名：Content-Disposition 优先 filename*，其次 filename；URL 取路径最后一段并解码', () => {
    expect(fileNameFromContentDisposition(`attachment; filename="a b.pdf"; filename*=UTF-8''%E8%AE%BA%E6%96%87.pdf`)).toBe('论文.pdf');
    expect(fileNameFromContentDisposition('inline; filename="report \\"v2\\".pdf"')).toBe('report "v2".pdf');
    expect(fileNameFromContentDisposition('attachment; filename=plain.mp3')).toBe('plain.mp3');
    expect(fileNameFromContentDisposition(null)).toBe('');
    expect(fileNameFromUrl('https://cdn.sspai.com/2026/cover%402x.jpg?w=1')).toBe('cover@2x.jpg');
    expect(fileNameFromUrl('https://example.com/%E0%A4%A.jpg')).toBe('%E0%A4%A.jpg');
    expect(fileNameFromUrl('data:image/png;base64,AAAA')).toBe('');
  });

  it('扩展名：编号不算扩展名；没有扩展名时按 content-type 补', () => {
    expect(splitExt('keynote-1080p.mp4')).toEqual({ stem: 'keynote-1080p', ext: 'mp4' });
    expect(splitExt('1706.03762')).toEqual({ stem: '1706.03762', ext: '' });
    expect(splitExt('.hidden')).toEqual({ stem: '.hidden', ext: '' });
    expect(extForMedia('application/pdf', 'https://arxiv.org/pdf/1706.03762')).toBe('pdf');
    expect(extForMedia('audio/mpeg', 'https://x/a')).toBe('mp3');
    expect(extForMedia('image/jpeg', 'https://x/a')).toBe('jpg');
    expect(extForMedia('video/quicktime', 'https://x/a')).toBe('mov');
    expect(extForMedia(null, 'https://x/a')).toBe('');
  });

  it('媒体文件基础名：页面标题 - 原文件名主干；标题为空或与文件名（主干）相同时只用主干', () => {
    expect(mediaBaseName('少数派年度盘点', 'cover@2x.jpg')).toBe('少数派年度盘点 - cover@2x');
    expect(mediaBaseName('  ', 'cover.jpg')).toBe('cover');
    expect(mediaBaseName('cover.jpg', 'cover.jpg')).toBe('cover');
    expect(mediaBaseName(' cover ', 'cover.jpg')).toBe('cover');
    expect(mediaBaseName('页面', '')).toBe('页面');
  });

  it('侧档：键序固定、两空格缩进、结尾换行，解析后原样写回', () => {
    const text = serializeMediaMeta({
      note: 'n',
      tags: ['t'],
      mime: 'image/jpeg',
      bytes: 3,
      captured: '2026-10-07T08:40:00.000Z',
      site: 'sspai.com',
      title: '页',
      medium: 'image',
      media_url: 'https://cdn/a.jpg',
      source: 'https://sspai.com/p',
      file: '页 - a.jpg',
      id: '01X',
    });
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['id', 'file', 'source', 'media_url', 'medium', 'title', 'site', 'captured', 'bytes', 'mime', 'tags', 'note']);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "id": "01X",\n');
    expect(serializeMediaMeta(parseMediaMeta(text))).toBe(text);
  });

  it('data: 地址：解码内容，去重键用内容的 SHA-256，侧档写 data: 加 mime', async () => {
    const url = 'data:text/plain;base64,YWJj';
    expect(decodeDataUrl(url)).toEqual({ mime: 'text/plain', bytes: new TextEncoder().encode('abc') });
    expect(decodeDataUrl('data:,a%20b')?.bytes).toEqual(new TextEncoder().encode('a b'));
    // SHA-256("abc")
    expect(await mediaKeyOf(url)).toBe('data:sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await mediaKeyOf('https://CDN.example.com/a.jpg?utm_source=x#f')).toBe('https://cdn.example.com/a.jpg');
    expect(mediaUrlForMeta(url, 'text/plain')).toBe('data:text/plain');
  });

  it('下载进度的量按总数的单位写', () => {
    expect(formatProgressBytes(12.3 * 1024 * 1024, 40.1 * 1024 * 1024)).toBe('12.3 / 40.1 MB');
    expect(formatProgressBytes(300 * 1024, 900 * 1024)).toBe('300 / 900 KB');
    expect(formatProgressBytes(12.3 * 1024 * 1024)).toBe('12.3 MB');
    expect(formatProgressBytes(0.5 * 1024 ** 3, 1.8 * 1024 ** 3)).toBe('0.5 / 1.8 GB');
  });
});

describe('isMediaDocument（ALAG-4 编排者裁决：只有媒体文件本身跳过抽取）', () => {
  it('图片、音频、视频、PDF 算媒体文件；text/plain、XML、HTML 不算', () => {
    for (const type of ['image/png', 'audio/mpeg', 'video/mp4', 'application/pdf']) expect(isMediaDocument(type), type).toBe(true);
    for (const type of ['text/plain', 'application/xml', 'text/xml', 'application/json', 'text/html', 'application/xhtml+xml', '', null, undefined]) {
      expect(isMediaDocument(type), String(type)).toBe(false);
    }
  });
});

describe('decodeDataUrl：非 base64 逐字节解码', () => {
  it('%XX 转成对应字节（不经 UTF-8 解码）', () => {
    expect(decodeDataUrl('data:image/png,%89PNG%0D%0A%1A%0A')?.bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(decodeDataUrl('data:text/plain,a%20b')?.bytes).toEqual(new TextEncoder().encode('a b'));
  });

  it('非 ASCII 字符按 UTF-8 编码，非法 % 序列按字面处理', () => {
    expect(decodeDataUrl('data:text/plain,你好%E4%BD%A0')?.bytes).toEqual(new TextEncoder().encode('你好你'));
    expect(decodeDataUrl('data:text/plain,100%')?.bytes).toEqual(new TextEncoder().encode('100%'));
  });

  it('约 300KB 的长连续普通字符（非 base64 svg）也能解码，字节长度等于原文 UTF-8 长度', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text>${'a'.repeat(300_000)}</text></svg>`;
    const decoded = decodeDataUrl(`data:image/svg+xml,${svg}`);
    expect(decoded).not.toBeNull();
    expect(decoded?.bytes.length).toBe(new TextEncoder().encode(svg).length);
  });
});
