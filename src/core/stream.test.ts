import { describe, expect, it } from 'vitest';
import bilibiliHtml from '../../tests/fixtures/stream/bilibili-video.html?raw';
import youtubeHtml from '../../tests/fixtures/stream/youtube-watch.html?raw';
import { MEDIA_MAX_BYTES } from './media';
import { classifyDirect, extractJsonObject, formatSeconds, parseStreamHtml, parseStreamUrl, platformLabel } from './stream';

const MB = 1024 * 1024;

describe('parseStreamUrl：youtube', () => {
  const expected = {
    platform: 'youtube',
    videoId: 'dQw4w9WgXcQ',
    canonical: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
  };

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
    'https://youtu.be/dQw4w9WgXcQ?si=abcDEF123',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ?feature=share',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM',
    'https://youtube.com/watch?v=dQw4w9WgXcQ#t=1',
  ])('%s → 同一 canonical 与 embed', (url) => {
    expect(parseStreamUrl(url)).toEqual(expected);
  });

  it.each([
    'https://www.youtube.com/@RickAstleyYT',
    'https://www.youtube.com/results?search_query=rick+astley',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
  ])('%s → null', (url) => {
    expect(parseStreamUrl(url)).toBeNull();
  });
});

describe('parseStreamUrl：bilibili', () => {
  it('BV 号，去掉 spm_id_from 等参数', () => {
    expect(parseStreamUrl('https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333.337.search-card.all.click')).toEqual({
      platform: 'bilibili',
      videoId: 'BV1GJ411x7h7',
      canonical: 'https://www.bilibili.com/video/BV1GJ411x7h7',
      embed: 'https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7',
    });
  });

  it('?p=2：canonical 带 ?p=2，embed 带 &page=2；p=1 不带', () => {
    expect(parseStreamUrl('https://www.bilibili.com/video/BV1GJ411x7h7?p=2')).toMatchObject({
      canonical: 'https://www.bilibili.com/video/BV1GJ411x7h7?p=2',
      embed: 'https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7&page=2',
    });
    expect(parseStreamUrl('https://www.bilibili.com/video/BV1GJ411x7h7?p=1')?.canonical).toBe('https://www.bilibili.com/video/BV1GJ411x7h7');
  });

  it('av 号', () => {
    expect(parseStreamUrl('https://www.bilibili.com/video/av170001')).toEqual({
      platform: 'bilibili',
      videoId: 'av170001',
      canonical: 'https://www.bilibili.com/video/av170001',
      embed: 'https://player.bilibili.com/player.html?aid=170001',
    });
  });

  it('m.bilibili.com', () => {
    expect(parseStreamUrl('https://m.bilibili.com/video/BV1GJ411x7h7')?.canonical).toBe('https://www.bilibili.com/video/BV1GJ411x7h7');
  });

  it('番剧：embed 为空', () => {
    expect(parseStreamUrl('https://www.bilibili.com/bangumi/play/ep123?from=search')).toEqual({
      platform: 'bilibili',
      videoId: 'ep123',
      canonical: 'https://www.bilibili.com/bangumi/play/ep123',
      embed: '',
    });
  });

  it('b23.tv 短链：识别为 bilibili，videoId 为空，canonical 为原链接', () => {
    expect(parseStreamUrl('https://b23.tv/abc')).toEqual({ platform: 'bilibili', videoId: '', canonical: 'https://b23.tv/abc', embed: '' });
  });

  it.each(['https://space.bilibili.com/123', 'https://www.bilibili.com/', 'https://www.bilibili.com/video/BV123'])('%s → null', (url) => {
    expect(parseStreamUrl(url)).toBeNull();
  });
});

describe('parseStreamUrl：x', () => {
  it('x.com 与 twitter.com 的视频专链', () => {
    expect(parseStreamUrl('https://x.com/h/status/1/video/1')).toEqual({ platform: 'x', videoId: '1', canonical: 'https://x.com/h/status/1/video/1', embed: '' });
    expect(parseStreamUrl('https://twitter.com/h/status/1/video/2')).toEqual({ platform: 'x', videoId: '1', canonical: 'https://x.com/h/status/1/video/2', embed: '' });
    expect(parseStreamUrl('https://mobile.twitter.com/h/status/1/video/1?s=20')?.canonical).toBe('https://x.com/h/status/1/video/1');
  });

  it.each(['https://x.com/h/status/1', 'https://x.com/h/status/1/photo/1', 'https://x.com/h', 'https://x.com/home'])('%s → null（帖子页仍走 X 文章剪藏）', (url) => {
    expect(parseStreamUrl(url)).toBeNull();
  });
});

describe('parseStreamUrl：网盘', () => {
  it('百度网盘 /s/1…：videoId 去掉开头的 1，canonical 保留 pwd', () => {
    expect(parseStreamUrl('https://pan.baidu.com/s/1AbC-d_e?pwd=x1y2')).toEqual({
      platform: 'baidupan',
      videoId: 'AbC-d_e',
      canonical: 'https://pan.baidu.com/s/1AbC-d_e?pwd=x1y2',
      embed: '',
    });
    expect(parseStreamUrl('https://yun.baidu.com/s/1AbC')?.canonical).toBe('https://pan.baidu.com/s/1AbC');
  });

  it('百度网盘 share/init?surl=', () => {
    expect(parseStreamUrl('https://pan.baidu.com/share/init?surl=AbC')).toEqual({
      platform: 'baidupan',
      videoId: 'AbC',
      canonical: 'https://pan.baidu.com/s/1AbC',
      embed: '',
    });
  });

  it('115：canonical 改到 115cdn.com，保留 password', () => {
    expect(parseStreamUrl('https://115.com/s/sw12ab?password=abcd')).toEqual({
      platform: '115',
      videoId: 'sw12ab',
      canonical: 'https://115cdn.com/s/sw12ab?password=abcd',
      embed: '',
    });
    expect(parseStreamUrl('https://anxia.com/s/sw12ab')?.canonical).toBe('https://115cdn.com/s/sw12ab');
  });

  it('夸克', () => {
    expect(parseStreamUrl('https://pan.quark.cn/s/abcdef123456')).toEqual({
      platform: 'quark',
      videoId: 'abcdef123456',
      canonical: 'https://pan.quark.cn/s/abcdef123456',
      embed: '',
    });
    expect(parseStreamUrl('https://pan.quark.cn/s/abcdef123456?pwd=Zz9#/list')?.canonical).toBe('https://pan.quark.cn/s/abcdef123456?pwd=Zz9');
  });

  it.each(['https://pan.baidu.com/disk/home', 'https://pan.baidu.com/s/2AbC', 'https://115.com/', 'https://pan.quark.cn/list', 'https://quark.cn/s/abc'])('%s → null', (url) => {
    expect(parseStreamUrl(url)).toBeNull();
  });
});

describe('classifyDirect：直链 other', () => {
  it('视频超过 100MB 或没有大小 → 流媒体；音频 8MB → 媒体剪藏', () => {
    expect(classifyDirect('video/mp4', 150 * MB)).toBe('stream');
    expect(classifyDirect('video/mp4', null)).toBe('stream');
    expect(classifyDirect('audio/mpeg', 8 * MB)).toBe('media');
    expect(classifyDirect('video/mp4', MEDIA_MAX_BYTES)).toBe('media');
    expect(classifyDirect('video/mp4', MEDIA_MAX_BYTES + 1)).toBe('stream');
  });

  it('图片、PDF 永远是媒体剪藏；content-type 判不出时按调用方给的类别', () => {
    expect(classifyDirect('image/png', null)).toBe('media');
    expect(classifyDirect('application/pdf', 500 * MB)).toBe('media');
    expect(classifyDirect('application/octet-stream', null, 'video')).toBe('stream');
    expect(classifyDirect(null, 8 * MB, 'audio')).toBe('media');
  });
});

describe('显示名与时长', () => {
  it('平台显示名', () => {
    expect(['youtube', 'bilibili', 'x', 'baidupan', '115', 'quark'].map((p) => platformLabel(p as never))).toEqual(['YouTube', 'B 站', 'X 视频', '百度网盘', '115', '夸克']);
    expect(platformLabel('other', 'video')).toBe('视频直链');
    expect(platformLabel('other', 'audio')).toBe('音频直链');
  });

  it('时长同 ALAG-3', () => {
    expect(formatSeconds(47)).toBe('0:47');
    expect(formatSeconds(213)).toBe('3:33');
    expect(formatSeconds(3723)).toBe('1:02:03');
  });
});

describe('extractJsonObject', () => {
  it('括号配对：字符串里的括号与转义不计，后面的代码不吞', () => {
    const text = 'x = {"a":"} \\" {","b":{"c":[1,2]}};(function(){var y={}})()';
    expect(extractJsonObject(text, text.indexOf('{'))).toEqual({ a: '} " {', b: { c: [1, 2] } });
  });

  it('截不出或不是 JSON 返回 null', () => {
    expect(extractJsonObject('{"a":1', 0)).toBeNull();
    expect(extractJsonObject("{a:'1'}", 0)).toBeNull();
  });
});

describe('parseStreamHtml：样本', () => {
  it('YouTube', () => {
    const meta = parseStreamHtml('youtube', youtubeHtml, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(meta.title).toBe('Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)');
    expect(meta.author).toBe('Rick Astley');
    expect(meta.duration).toBe(213);
    expect(meta.description.startsWith('The official video for')).toBe(true);
    expect(meta.description).not.toContain('...');
    expect(meta.published).toBe('2009-10-25T06:57:33.000Z');
    expect(meta.cover).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
    expect(meta.embed).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('B 站：简介取 videoData.desc，封面转 https，og:title 后缀去掉', () => {
    const meta = parseStreamHtml('bilibili', bilibiliHtml, 'https://www.bilibili.com/video/BV1GJ411x7h7');
    expect(meta.title).toBe('【官方 MV】Never Gonna Give You Up - Rick Astley');
    expect(meta.author).toBe('索尼音乐中国');
    expect(meta.duration).toBe(213);
    expect(meta.description).toBe('-');
    expect(meta.cover).toBe('https://i1.hdslb.com/bfs/archive/5242750857121e05146d5d5b13a47a2a6dd36e98.jpg');
    expect(meta.embed).toBe('https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7');
    expect(meta.published).toBe(new Date(1577835803 * 1000).toISOString());
  });

  it('脚本缺失时用 og 补：B 站标题去掉后缀，YouTube 去掉 “ - YouTube”', () => {
    const bili = bilibiliHtml.replace(/__INITIAL_STATE__/g, '__NO_STATE__');
    const meta = parseStreamHtml('bilibili', bili, 'https://www.bilibili.com/video/BV1GJ411x7h7');
    expect(meta.title).toBe('【官方 MV】Never Gonna Give You Up - Rick Astley');
    expect(meta.author).toBe('索尼音乐中国');
    expect(meta.duration).toBe(213);
    expect(meta.description).toBe('');

    const yt = parseStreamHtml('youtube', '<title>某视频 - YouTube</title>', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(yt).toMatchObject({ title: '某视频', author: '', duration: null, cover: '', embed: '' });
  });
});
