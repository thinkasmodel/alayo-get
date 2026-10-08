import { describe, expect, it } from 'vitest';
import { classifyTab, CONTEXT_MENUS, mediaCapture, predictPreviewMedium, quoteCapture, resolveQuoteCapture, routeContextClick } from './route';

const page = 'https://sspai.com/post/90002';

describe('routeContextClick', () => {
  it('页面空白处 → 保存当前页；不认识的菜单项忽略', () => {
    expect(routeContextClick({ menuItemId: 'save-page', pageUrl: page })).toEqual({ action: 'page' });
    expect(routeContextClick({ menuItemId: 'other' })).toEqual({ action: 'ignore' });
  });

  it('右键链接：平台链接带 stream，其余为 null（书签剪藏）', () => {
    const yt = routeContextClick({ menuItemId: 'save-link', linkUrl: 'https://youtu.be/dQw4w9WgXcQ', pageUrl: page });
    expect(yt).toMatchObject({ action: 'link', stream: { platform: 'youtube', videoId: 'dQw4w9WgXcQ' } });
    expect(routeContextClick({ menuItemId: 'save-link', linkUrl: 'https://example.com/a', pageUrl: page })).toEqual({
      action: 'link',
      url: 'https://example.com/a',
      stream: null,
    });
    // X 帖子链接（没有 /video/n）仍是书签
    expect(routeContextClick({ menuItemId: 'save-link', linkUrl: 'https://x.com/h/status/1' })).toMatchObject({ stream: null });
  });

  it('图片：http(s)、data: → 媒体剪藏；blob: → NoDownloadableUrl', () => {
    expect(routeContextClick({ menuItemId: 'save-image', srcUrl: 'https://cdn.sspai.com/a.jpg', pageUrl: page })).toEqual({
      action: 'media',
      kind: 'image',
      url: 'https://cdn.sspai.com/a.jpg',
    });
    expect(routeContextClick({ menuItemId: 'save-image', srcUrl: 'data:image/png;base64,AAAA', pageUrl: page })).toMatchObject({ action: 'media', kind: 'image' });
    expect(routeContextClick({ menuItemId: 'save-image', srcUrl: 'blob:https://sspai.com/1-2', pageUrl: page })).toEqual({
      action: 'fail',
      name: 'NoDownloadableUrl',
      message: '这张图片没有可下载的地址',
    });
  });

  it('平台视频页（页面或 frame）上右键视频 → 该平台的流媒体剪藏', () => {
    expect(routeContextClick({ menuItemId: 'save-video', srcUrl: 'blob:https://www.youtube.com/x', pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toMatchObject({
      action: 'stream',
      parsed: { platform: 'youtube', canonical: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      from: 'page',
    });
    expect(
      routeContextClick({ menuItemId: 'save-video', srcUrl: 'blob:x', pageUrl: page, frameUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }),
    ).toMatchObject({ action: 'stream', parsed: { platform: 'youtube' }, from: 'frame' });
  });

  it('x.com：帖子页或视频专链 → 按该帖存；时间线 → XVideoNeedsPost', () => {
    expect(routeContextClick({ menuItemId: 'save-video', srcUrl: 'blob:https://x.com/1', pageUrl: 'https://x.com/h/status/123' })).toEqual({
      action: 'x-video',
      statusId: '123',
    });
    expect(routeContextClick({ menuItemId: 'save-video', srcUrl: 'blob:https://x.com/1', pageUrl: 'https://x.com/h/status/123/video/1' })).toEqual({
      action: 'x-video',
      statusId: '123',
    });
    // X 上的 GIF 是 mp4 直链，也按帖子走
    expect(routeContextClick({ menuItemId: 'save-video', srcUrl: 'https://video.twimg.com/tweet_video/a.mp4', pageUrl: 'https://x.com/h/status/123' })).toMatchObject({
      action: 'x-video',
    });
    expect(routeContextClick({ menuItemId: 'save-video', srcUrl: 'blob:https://x.com/1', pageUrl: 'https://x.com/home' })).toEqual({
      action: 'fail',
      name: 'XVideoNeedsPost',
      message: '在时间线上认不出是哪条帖子，请打开帖子页再存',
    });
    // x.com 上的图片照常是媒体剪藏
    expect(routeContextClick({ menuItemId: 'save-image', srcUrl: 'https://pbs.twimg.com/media/a.jpg', pageUrl: 'https://x.com/home' })).toMatchObject({
      action: 'media',
      kind: 'image',
    });
  });

  it('其余视频、音频：有地址 → 媒体剪藏（大小在保存时探测）；blob: 或没有地址 → 当前页的直链流媒体剪藏', () => {
    expect(routeContextClick({ menuItemId: 'save-video', srcUrl: 'https://cdn.example.com/k.mp4', pageUrl: page })).toEqual({
      action: 'media',
      kind: 'video',
      url: 'https://cdn.example.com/k.mp4',
    });
    expect(routeContextClick({ menuItemId: 'save-audio', srcUrl: 'https://cdn.example.com/a.mp3', pageUrl: page })).toMatchObject({ action: 'media', kind: 'audio' });
    expect(routeContextClick({ menuItemId: 'save-video', srcUrl: 'blob:https://example.com/1', pageUrl: page })).toEqual({ action: 'blob-stream', medium: 'video' });
    expect(routeContextClick({ menuItemId: 'save-audio', pageUrl: page })).toEqual({ action: 'blob-stream', medium: 'audio' });
  });
});

describe('classifyTab', () => {
  it('平台视频页（含 X 视频专链）→ 流媒体；X 帖子页本身不是', () => {
    expect(classifyTab('https://www.bilibili.com/video/BV1GJ411x7h7')).toMatchObject({ action: 'stream', parsed: { platform: 'bilibili' } });
    expect(classifyTab('https://x.com/h/status/1/video/1')).toMatchObject({ action: 'stream', parsed: { platform: 'x' } });
    expect(classifyTab('https://x.com/h/status/1')).toEqual({ action: 'page' });
  });

  it('contentType 不是 HTML 时按它判类别；判不出或是 HTML 照旧', () => {
    expect(classifyTab('https://arxiv.org/pdf/1706.03762', 'application/pdf')).toEqual({ action: 'media', kind: 'pdf' });
    expect(classifyTab('https://example.com/a', 'image/png')).toEqual({ action: 'media', kind: 'image' });
    expect(classifyTab('https://example.com/a.mp4', 'video/mp4; codecs=avc1')).toEqual({ action: 'media', kind: 'video' });
    expect(classifyTab('https://example.com/a', 'text/html; charset=utf-8')).toEqual({ action: 'page' });
    expect(classifyTab('https://example.com/a', 'text/plain')).toEqual({ action: 'page' });
    expect(classifyTab('https://example.com/a.pdf')).toEqual({ action: 'page' });
  });
});

describe('predictPreviewMedium 与 mediaCapture', () => {
  it('保存中的预览卡按地址预判图标', () => {
    expect(predictPreviewMedium('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('stream');
    expect(predictPreviewMedium('https://example.com/paper.pdf')).toBe('pdf');
    expect(predictPreviewMedium('https://example.com/a.JPG')).toBe('image');
    expect(predictPreviewMedium('https://example.com/a.mp3')).toBe('audio');
    expect(predictPreviewMedium('https://example.com/a.webm')).toBe('video');
    expect(predictPreviewMedium('https://arxiv.org/pdf/1706.03762')).toBe('web');
  });

  it('媒体剪藏的 Capture 能 JSON 往返，原文件名取自地址', () => {
    const capture = mediaCapture(page, '少数派年度盘点', 'image', 'https://cdn.sspai.com/2026/cover%402x.jpg?w=1');
    expect(capture.media).toEqual({ kind: 'image', url: 'https://cdn.sspai.com/2026/cover%402x.jpg?w=1', fileName: 'cover@2x.jpg' });
    expect(JSON.parse(JSON.stringify(capture))).toEqual(capture);
  });

  it('右键菜单的标题逐字取自 DESIGN.md §4', () => {
    expect(CONTEXT_MENUS.map((m) => [m.id, m.title, m.context])).toEqual([
      ['save-page', '存入 Alayo Get', 'page'],
      ['save-link', '把链接存入 Alayo Get', 'link'],
      ['save-image', '把图片存入 Alayo Get', 'image'],
      ['save-video', '把视频存入 Alayo Get', 'video'],
      ['save-audio', '把音频存入 Alayo Get', 'audio'],
      ['save-quote', '摘录到 Alayo Get', 'selection'],
    ]);
  });
});

describe('classifyTab：非 HTML 但不是媒体的文档（ALAG-4 编排者裁决）', () => {
  it('text/plain、XML 照改动前的行为保留页面采集结果', () => {
    for (const type of ['text/plain; charset=utf-8', 'application/xml', 'text/xml', 'application/json']) {
      expect(classifyTab('https://example.com/a.txt', type), type).toEqual({ action: 'page' });
    }
  });
});

describe('摘录剪藏的入口（ALAG-4 brief B §1）', () => {
  it('右键菜单含“摘录到 Alayo Get”，只在选中文字时出现', () => {
    expect(CONTEXT_MENUS).toContainEqual({ id: 'save-quote', title: '摘录到 Alayo Get', context: 'selection' });
  });

  it('选中文字 → 摘录', () => {
    expect(routeContextClick({ menuItemId: 'save-quote', pageUrl: page, selectionText: '一段话', frameId: 0 })).toEqual({ action: 'quote' });
  });

  it('页面回了选区：用页面的地址、标题与摘录信息', () => {
    const info = { markdown: '**一段**话', fragmentUrl: `${page}#:~:text=a`, selectedAt: '2026-10-07T08:31:00.000Z' };
    expect(resolveQuoteCapture({ url: page, title: '页面标题', quote: info }, { pageUrl: 'https://other/', selectionText: 'x' }, { title: '标签页' }, new Date())).toEqual(
      quoteCapture(page, '页面标题', info),
    );
  });

  it('取不到选区（页面回 null、不能注入、选区在子 frame 里）：用选中文字作纯文本，片段为 null，出处 pageUrl，标题取标签页', () => {
    const now = new Date('2026-10-07T08:31:00.000Z');
    const expected = quoteCapture(page, '标签页标题', { markdown: '选中的 \\*文字\\*', fragmentUrl: null, selectedAt: now.toISOString() });
    const info = { pageUrl: page, selectionText: '  选中的 *文字*  ' };
    expect(resolveQuoteCapture({ url: page, title: '页面', quote: null }, info, { title: '标签页标题' }, now)).toEqual(expected);
    expect(resolveQuoteCapture(null, info, { title: '标签页标题', url: 'https://tab/' }, now)).toEqual(expected);
    expect(JSON.parse(JSON.stringify(expected))).toEqual(expected);
  });
});
