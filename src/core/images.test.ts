import { describe, expect, it } from 'vitest';
import { assetPath, extFromContentType, planImages, rewriteImages } from './images';

const MD = [
  '![第一张](https://img.example.com/a.jpg)',
  '文字 ![](http://img.example.com/b.png "标题") 文字',
  '![重复](https://img.example.com/a.jpg)',
  '![内嵌](data:image/png;base64,iVBORw0KGgo=)',
  '[普通链接](https://example.com/page)',
  '![转义\\]的说明](https://img.example.com/c)',
].join('\n\n');

describe('planImages', () => {
  it('同一地址只出现一次，按首次出现顺序从 1 编号', () => {
    expect(planImages(MD)).toEqual([
      { url: 'https://img.example.com/a.jpg', index: 1 },
      { url: 'http://img.example.com/b.png', index: 2 },
      { url: 'https://img.example.com/c', index: 3 },
    ]);
  });

  it('data: 图片和普通链接不在计划里', () => {
    const urls = planImages(MD).map((p) => p.url);
    expect(urls.some((u) => u.startsWith('data:'))).toBe(false);
    expect(urls).not.toContain('https://example.com/page');
  });

  it('最多 max 张', () => {
    const many = Array.from({ length: 5 }, (_, i) => `![](https://x.example/${i}.png)`).join('\n');
    expect(planImages(many, 3).map((p) => p.index)).toEqual([1, 2, 3]);
  });
});

describe('rewriteImages', () => {
  it('成功的换成 .assets/<id>/<序号>.<ext>，失败的和 data: 不动，title 保留', () => {
    const id = '01JTEST';
    const local = new Map([
      ['https://img.example.com/a.jpg', assetPath(id, 1, 'jpg')],
      ['http://img.example.com/b.png', assetPath(id, 2, 'png')],
    ]);
    const out = rewriteImages(MD, local);
    expect(out).toBe(
      [
        '![第一张](.assets/01JTEST/1.jpg)',
        '文字 ![](.assets/01JTEST/2.png "标题") 文字',
        '![重复](.assets/01JTEST/1.jpg)',
        '![内嵌](data:image/png;base64,iVBORw0KGgo=)',
        '[普通链接](https://example.com/page)',
        '![转义\\]的说明](https://img.example.com/c)',
      ].join('\n\n'),
    );
  });

  it('assetPath 格式', () => {
    expect(assetPath('01JX', 'cover', 'webp')).toBe('.assets/01JX/cover.webp');
  });
});

describe('extFromContentType', () => {
  it('第一级：按 content-type 映射', () => {
    expect(extFromContentType('image/jpeg', 'https://x.example/a.png')).toBe('jpg');
    expect(extFromContentType('image/png; charset=binary', 'https://x.example/a')).toBe('png');
    expect(extFromContentType('IMAGE/GIF', 'https://x.example/a')).toBe('gif');
    expect(extFromContentType('image/webp', 'https://x.example/a')).toBe('webp');
    expect(extFromContentType('image/svg+xml', 'https://x.example/a')).toBe('svg');
    expect(extFromContentType('image/avif', 'https://x.example/a')).toBe('avif');
  });

  it('第二级：映射不到时取 URL 路径里的扩展名', () => {
    expect(extFromContentType('application/octet-stream', 'https://x.example/p/photo.JPEG?w=100')).toBe('jpg');
    expect(extFromContentType(null, 'https://x.example/p/photo.png#x')).toBe('png');
  });

  it('第三级：还是没有就返回 null（判为下载失败）', () => {
    expect(extFromContentType('application/octet-stream', 'https://x.example/p/photo')).toBeNull();
    expect(extFromContentType('', 'https://x.example/p/photo?format=jpg')).toBeNull();
  });
});

// ALAG-8：服务器明确返回网页等文本内容时不能按 URL 后缀存成图片（维基百科 /wiki/File:X.png 说明页）
describe('extFromContentType：明确不是图片的内容', () => {
  it('text/html、其他 text/*、xhtml、json 返回 null，不按 URL 后缀回退', () => {
    expect(extFromContentType('text/html; charset=utf-8', 'https://en.wikipedia.org/wiki/File:Plain_text.png')).toBeNull();
    expect(extFromContentType('text/plain', 'https://x.example/a.jpg')).toBeNull();
    expect(extFromContentType('application/xhtml+xml', 'https://x.example/a.png')).toBeNull();
    expect(extFromContentType('application/json', 'https://x.example/a.webp')).toBeNull();
  });
});
