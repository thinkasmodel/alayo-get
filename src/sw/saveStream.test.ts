import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import bilibiliHtml from '../../tests/fixtures/stream/bilibili-video.html?raw';
import youtubeHtml from '../../tests/fixtures/stream/youtube-watch.html?raw';
import { clipBaseName } from '@/core/filename';
import { parseStreamHtml, parseStreamUrl, type ParsedStream } from '@/core/stream';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createPendingQueue } from '@/io/pending';
import { createSavedIndex, type SavedIndex } from '@/io/savedIndex';
import type { Capture } from '@/shared/types';
import { captureLink, saveClip, type FetchLike, type SaveDeps } from './saveClip';
import { blobStreamCapture, captureStreamPage, netdiskStreamCapture, partialStreamCapture } from './saveStream';

const NOW = new Date('2026-10-07T08:20:00.000Z');
const ID = '01JSTREAM00000000000000001';
const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const MAXRES = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg';
const HQ = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
const BV = 'https://www.bilibili.com/video/BV1GJ411x7h7';
const BILI_PIC = 'https://i1.hdslb.com/bfs/archive/5242750857121e05146d5d5b13a47a2a6dd36e98.jpg';

type FakeRoute = { status?: number; type?: string; body?: string; url?: string } | 'network-error';

/** 假 fetch：按 URL 返回预设响应（可指定跳转后的 res.url），并记录请求。 */
function fakeFetch(routes: Record<string, FakeRoute>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route || route === 'network-error') throw new TypeError('Failed to fetch');
    const headers = new Headers();
    if (route.type) headers.set('content-type', route.type);
    const res = new Response(route.body ?? 'image-bytes', { status: route.status ?? 200, headers });
    Object.defineProperty(res, 'url', { value: route.url ?? url });
    return res;
  };
  return { fn, calls };
}

let library: MemoryLibrary;
let index: SavedIndex;
let ids: string[];

function makeDeps(fetchFn: FetchLike): SaveDeps {
  return {
    library,
    index,
    pending: createPendingQueue(),
    fetch: fetchFn,
    now: () => NOW,
    newId: () => {
      const id = ids.shift();
      if (!id) throw new Error('测试 id 用完了');
      return id;
    },
  };
}

const save = (capture: Capture, fetchFn: FetchLike, snapshot = false) => saveClip({ capture, snapshot }, makeDeps(fetchFn));

function parsed(url: string): ParsedStream {
  const p = parseStreamUrl(url);
  if (!p) throw new Error(`不是平台地址：${url}`);
  return p;
}

/** frontmatter 的行与正文。 */
function split(md: string): { lines: string[]; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(md);
  if (!m?.[1] || m[2] === undefined) throw new Error('没有 frontmatter');
  return { lines: m[1].split('\n'), body: m[2] };
}

beforeEach(() => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  index = createSavedIndex();
  ids = [ID, '01JSTREAM00000000000000002'];
});

describe('流媒体剪藏：YouTube', () => {
  const ytRoutes = { [WATCH]: { type: 'text/html; charset=utf-8', body: youtubeHtml }, [MAXRES]: { type: 'image/jpeg' } };

  it('页面保存：frontmatter 末五行、正文版式同样张；记录键为 canonical；&t=1 再存为 duplicate', async () => {
    const { fn, calls } = fakeFetch(ytRoutes);
    const capture = await captureStreamPage(parsed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), '标签页标题', fn);
    expect(calls[0]).toMatchObject({ url: WATCH, init: { credentials: 'include' } });
    expect(capture).toMatchObject({ kind: 'stream', url: WATCH, fetched: true, coverUrl: MAXRES });
    expect(JSON.parse(JSON.stringify(capture))).toEqual(capture);

    const outcome = await save(capture, fn);
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    const title = 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)';
    // 文件名照 ALAG-2 规则按 60 码点截断
    const file = `${clipBaseName(title)}.md`;
    expect(outcome.clip).toMatchObject({
      file,
      title,
      medium: 'video',
      site: 'youtube.com',
      source: WATCH,
      extract: 'full',
      imageCount: 1,
      imageFailures: 0,
      stream: { platform: 'youtube', duration: 213, medium: 'video' },
    });
    expect(outcome.clip.stream?.oversize).toBeUndefined();

    const md = library.text(file) ?? '';
    const { lines, body } = split(md);
    expect(lines.slice(0, 11).map((l) => l.split(':')[0])).toEqual(['id', 'source', 'medium', 'title', 'author', 'published', 'captured', 'site', 'tags', 'note', 'extract']);
    expect(lines).toContain('medium: "video"');
    expect(lines).toContain('author: "Rick Astley"');
    expect(lines).toContain('published: "2009-10-25T06:57:33.000Z"');
    expect(lines.slice(-5)).toEqual([
      'platform: "youtube"',
      'video_id: "dQw4w9WgXcQ"',
      'embed: "https://www.youtube.com/embed/dQw4w9WgXcQ"',
      'duration: 213',
      `cover: ".assets/${ID}/cover.jpg"`,
    ]);
    const description = parseStreamHtml('youtube', youtubeHtml, WATCH).description;
    expect(body).toBe(
      [`# ${title}`, `[原文](${WATCH})`, `![](.assets/${ID}/cover.jpg)`, '▶ YouTube 视频 (3:33) · Rick Astley', description.trim()].join('\n\n') + '\n',
    );
    expect(library.files.has(`.assets/${ID}/cover.jpg`)).toBe(true);
    expect(await index.get(WATCH)).toMatchObject({ id: ID, medium: 'video', file });

    const again = await captureStreamPage(parsed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'), '', fn);
    expect((await save(again, fn)).state).toBe('duplicate');
  });

  it('封面下载失败：maxresdefault 失败再试 hqdefault；都失败时 cover 为空串，正文用远程封面地址', async () => {
    const hq = fakeFetch({ [WATCH]: ytRoutes[WATCH], [MAXRES]: { status: 404 }, [HQ]: { type: 'image/jpeg' } });
    const withHq = await save(await captureStreamPage(parsed(WATCH), '', hq.fn), hq.fn);
    expect(hq.calls.map((c) => c.url)).toEqual([WATCH, MAXRES, HQ]);
    expect(withHq.state === 'saved' && withHq.clip.imageCount).toBe(1);

    fakeBrowser.reset();
    library = new MemoryLibrary();
    index = createSavedIndex();
    ids = [ID];
    const none = fakeFetch({ [WATCH]: ytRoutes[WATCH], [MAXRES]: 'network-error', [HQ]: { status: 404 } });
    const outcome = await save(await captureStreamPage(parsed(WATCH), '', none.fn), none.fn);
    expect(outcome.state === 'saved' && outcome.clip).toMatchObject({ imageCount: 0, imageFailures: 1 });
    const file = [...library.files.keys()][0] ?? '';
    expect([...library.files.keys()]).toHaveLength(1);
    const { lines, body } = split(library.text(file) ?? '');
    expect(lines.at(-1)).toBe('cover: ""');
    expect(body).toContain(`\n\n![](${MAXRES})\n\n▶ YouTube 视频 (3:33) · Rick Astley\n\n`);
  });

  it('抓取失败：退用标签页标题，extract partial，duration null，没有 ▶ 时长和作者', async () => {
    const { fn } = fakeFetch({ [WATCH]: 'network-error' });
    const capture = await captureStreamPage(parsed(WATCH), '标签页标题 - YouTube', fn);
    expect(capture).toMatchObject({ title: '标签页标题 - YouTube', fetched: false, coverUrl: '' });
    const outcome = await save(capture, fn);
    expect(outcome.state === 'saved' && outcome.clip).toMatchObject({ extract: 'partial', stream: { platform: 'youtube', duration: null } });
    const { lines, body } = split(library.text('标签页标题 - YouTube.md') ?? '');
    expect(lines).toContain('extract: "partial"');
    expect(lines.slice(-5)).toEqual(['platform: "youtube"', 'video_id: "dQw4w9WgXcQ"', 'embed: "https://www.youtube.com/embed/dQw4w9WgXcQ"', 'duration: null', 'cover: ""']);
    expect(body).toBe(`# 标签页标题 - YouTube\n\n[原文](${WATCH})\n\n▶ YouTube 视频\n`);
  });
});

describe('流媒体剪藏：B 站', () => {
  it('样本：标题、作者、时长、封面转 https；简介是“-”所以正文不写简介', async () => {
    const { fn } = fakeFetch({ [BV]: { type: 'text/html', body: bilibiliHtml }, [BILI_PIC]: { type: 'image/jpeg' } });
    const capture = await captureStreamPage(parsed(`${BV}/?spm_id_from=333.1007`), '', fn);
    expect(capture).toMatchObject({
      title: '【官方 MV】Never Gonna Give You Up - Rick Astley',
      author: '索尼音乐中国',
      coverUrl: BILI_PIC,
      description: '-',
      stream: { platform: 'bilibili', videoId: 'BV1GJ411x7h7', embed: 'https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7', duration: 213 },
    });
    const outcome = await save(capture, fn);
    expect(outcome.state === 'saved' && outcome.clip.stream).toEqual({ platform: 'bilibili', duration: 213, medium: 'video' });
    const { body } = split(library.text('【官方 MV】Never Gonna Give You Up - Rick Astley.md') ?? '');
    expect(body.trimEnd().split('\n\n').at(-1)).toBe('▶ B 站 视频 (3:33) · 索尼音乐中国');
  });

  it('b23.tv 短链：按跳转后的地址再解析，canonical 为视频页', async () => {
    const { fn } = fakeFetch({ 'https://b23.tv/abc': { type: 'text/html', body: bilibiliHtml, url: `${BV}?share_source=copy` } });
    const capture = await captureStreamPage(parsed('https://b23.tv/abc'), '链接文字', fn);
    expect(capture).toMatchObject({ url: BV, fetched: true, stream: { videoId: 'BV1GJ411x7h7' } });
  });
});

describe('流媒体剪藏：网盘、X 视频、blob', () => {
  const pageCapture = (title: string): Capture => ({
    url: 'https://pan.baidu.com/s/1AbC-d_e?pwd=x1y2',
    title,
    site: '百度网盘',
    author: '',
    published: '',
    description: '分享的文件',
    coverUrl: '',
    markdown: '正文',
    textLength: 100,
    kind: 'page',
  });

  it('页面采集有标题 → 流媒体剪藏（platform baidupan，duration null）', async () => {
    const capture = netdiskStreamCapture(pageCapture('电影.mp4_免费高速下载|百度网盘'), parsed('https://pan.baidu.com/s/1AbC-d_e?pwd=x1y2'));
    expect(capture).not.toBeNull();
    if (!capture) return;
    const outcome = await save(capture, fakeFetch({}).fn);
    expect(outcome.state === 'saved' && outcome.clip).toMatchObject({
      medium: 'video',
      source: 'https://pan.baidu.com/s/1AbC-d_e?pwd=x1y2',
      stream: { platform: 'baidupan', duration: null, medium: 'video' },
    });
    const { lines, body } = split(library.text('电影.mp4_免费高速下载-百度网盘.md') ?? '');
    expect(lines.slice(-5)).toEqual(['platform: "baidupan"', 'video_id: "AbC-d_e"', 'embed: ""', 'duration: null', 'cover: ""']);
    expect(body).toContain('▶ 百度网盘 视频\n\n分享的文件\n');
  });

  it('没有标题（或标题就是地址）→ 照旧存书签剪藏', async () => {
    const p = parsed('https://pan.baidu.com/s/1AbC-d_e?pwd=x1y2');
    expect(netdiskStreamCapture(pageCapture(''), p)).toBeNull();
    expect(netdiskStreamCapture(pageCapture('https://pan.baidu.com/s/1AbC-d_e?pwd=x1y2'), p)).toBeNull();
    const outcome = await save({ ...pageCapture(''), markdown: null }, fakeFetch({}).fn);
    expect(outcome.state === 'fallback' && outcome.clip.medium).toBe('link');
  });

  it('右键网盘链接：抓到目标页 → 流媒体剪藏 full；抓取失败、只有链接文字 → partial', async () => {
    const link = 'https://pan.quark.cn/s/abcdef123456';
    const ok = fakeFetch({ [link]: { type: 'text/html', body: '<title>夸克网盘分享</title>' } });
    const fetched = netdiskStreamCapture(await captureLink(link, '', ok.fn), parsed(link));
    expect(fetched).toMatchObject({ kind: 'stream', title: '夸克网盘分享', fetched: true, stream: { platform: 'quark' } });
    const failed = netdiskStreamCapture(await captureLink(link, '我的分享', fakeFetch({}).fn), parsed(link));
    expect(failed).toMatchObject({ title: '我的分享', fetched: false });
    expect(netdiskStreamCapture(await captureLink(link, '', fakeFetch({}).fn), parsed(link))).toBeNull();
  });

  it('别处的 X 视频专链：标题用链接文字或 URL，extract partial', async () => {
    const p = parsed('https://x.com/h/status/1/video/1');
    expect(partialStreamCapture(p, '')).toMatchObject({ title: 'https://x.com/h/status/1/video/1', fetched: false, stream: { platform: 'x', videoId: '1' } });
    const outcome = await save(partialStreamCapture(p, '一条视频'), fakeFetch({}).fn);
    expect(outcome.state === 'saved' && outcome.clip).toMatchObject({ extract: 'partial', stream: { platform: 'x', duration: null } });
    expect(library.text('一条视频.md')).toContain('\n▶ X 视频\n');
  });

  it('blob: 视频：存当前页的直链流媒体剪藏，没有大小，不加超大小字', async () => {
    const capture = blobStreamCapture('https://example.com/watch/1', '某个播放页', 'video');
    const outcome = await save(capture, fakeFetch({}).fn);
    expect(outcome.state === 'saved' && outcome.clip.stream).toEqual({ platform: 'other', duration: null, medium: 'video' });
    const { lines, body } = split(library.text('某个播放页.md') ?? '');
    expect(lines.slice(-5)).toEqual(['platform: "other"', 'video_id: ""', 'embed: ""', 'duration: null', 'cover: ""']);
    expect(body).toBe('# 某个播放页\n\n[原文](https://example.com/watch/1)\n\n▶ 视频直链\n');
  });
});

describe('流媒体剪藏：抓到的页面不是要存的视频', () => {
  it('YouTube：样本里的视频 ID 与请求的不一致 → partial，退用标签页标题', async () => {
    const other = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
    const { fn } = fakeFetch({ [other]: { type: 'text/html', body: youtubeHtml } });
    const capture = await captureStreamPage(parsed(other), '标签页标题', fn);
    expect(capture).toMatchObject({ title: '标签页标题', fetched: false, coverUrl: '', stream: { videoId: 'aaaaaaaaaaa' } });
  });

  it('YouTube：同意页（只有 <title>）→ partial，标题不是页面 title', async () => {
    const { fn } = fakeFetch({ [WATCH]: { type: 'text/html', body: '<html><head><title>Before you continue to YouTube</title></head></html>' } });
    const capture = await captureStreamPage(parsed(WATCH), '链接文字', fn);
    expect(capture).toMatchObject({ title: '链接文字', fetched: false });
    expect(capture.title).not.toBe('Before you continue to YouTube');
  });

  it('B 站：样本里的 bvid 与请求的不一致 → partial', async () => {
    const other = 'https://www.bilibili.com/video/BV1xx411c7mD';
    const { fn } = fakeFetch({ [other]: { type: 'text/html', body: bilibiliHtml } });
    expect(await captureStreamPage(parsed(other), '链接文字', fn)).toMatchObject({ title: '链接文字', fetched: false });
  });

  it('B 站 av 号：videoData.aid 与之一致才算抓到', async () => {
    const aid = /"aid":(\d+)/.exec(bilibiliHtml)?.[1];
    expect(aid).toBeDefined();
    const same = `https://www.bilibili.com/video/av${aid}`;
    const wrong = 'https://www.bilibili.com/video/av1';
    const { fn } = fakeFetch({ [same]: { type: 'text/html', body: bilibiliHtml }, [wrong]: { type: 'text/html', body: bilibiliHtml } });
    expect((await captureStreamPage(parsed(same), '', fn)).fetched).toBe(true);
    expect((await captureStreamPage(parsed(wrong), '', fn)).fetched).toBe(false);
  });

  it('B 站番剧页：没有 videoData 时看 og:url、canonical 里的 ep 号', async () => {
    const ep = 'https://www.bilibili.com/bangumi/play/ep123';
    const page = (url: string) => `<html><head><meta property="og:url" content="${url}"><meta property="og:title" content="某番_哔哩哔哩_bilibili"><title>x</title></head></html>`;
    const { fn } = fakeFetch({ [ep]: { type: 'text/html', body: page('https://www.bilibili.com/bangumi/play/ep123/') } });
    expect(await captureStreamPage(parsed(ep), '', fn)).toMatchObject({ fetched: true, title: '某番' });
    const bad = fakeFetch({ [ep]: { type: 'text/html', body: page('https://www.bilibili.com/bangumi/play/ep1234') } });
    expect((await captureStreamPage(parsed(ep), '链接文字', bad.fn)).fetched).toBe(false);
  });
});

describe('流媒体剪藏：只有 og 元数据（平台 JSON 取不到）', () => {
  const ogPage = (url: string, title: string) =>
    `<html><head><meta property="og:title" content="${title}"><meta property="og:image" content="https://img.example.com/c.jpg"><meta property="og:url" content="${url}"><title>x</title></head></html>`;

  it('YouTube：og:url 与请求同一个 id → full，标题、封面来自 og', async () => {
    const { fn } = fakeFetch({ [WATCH]: { type: 'text/html', body: ogPage(WATCH, 'og 标题') } });
    expect(await captureStreamPage(parsed(WATCH), '链接文字', fn)).toMatchObject({
      fetched: true,
      title: 'og 标题',
      coverUrl: 'https://img.example.com/c.jpg',
    });
  });

  it('B 站：og:url 与请求同一个 BV → full', async () => {
    const { fn } = fakeFetch({ [BV]: { type: 'text/html', body: ogPage(`${BV}/`, 'og 标题_哔哩哔哩_bilibili') } });
    expect(await captureStreamPage(parsed(BV), '链接文字', fn)).toMatchObject({
      fetched: true,
      title: 'og 标题',
      coverUrl: 'https://img.example.com/c.jpg',
    });
  });

  it('og:url 指向另一个 id → 仍降级为 partial（错页保护）', async () => {
    const yt = fakeFetch({ [WATCH]: { type: 'text/html', body: ogPage('https://www.youtube.com/watch?v=aaaaaaaaaaa', 'og 标题') } });
    expect(await captureStreamPage(parsed(WATCH), '链接文字', yt.fn)).toMatchObject({ fetched: false, title: '链接文字' });
    const bili = fakeFetch({ [BV]: { type: 'text/html', body: ogPage('https://www.bilibili.com/video/BV1xx411c7mD/', 'og 标题') } });
    expect(await captureStreamPage(parsed(BV), '链接文字', bili.fn)).toMatchObject({ fetched: false, title: '链接文字' });
  });
});

// ALAG-17：视频页 HTML 超过 4MB 按抓取失败处理
describe('流媒体剪藏：视频页太大', () => {
  it('B 站视频页超过 4MB → partial（fetched: false），不抛错', async () => {
    const { fn } = fakeFetch({ [BV]: { type: 'text/html', body: bilibiliHtml + ' '.repeat(4 * 1024 * 1024) } });
    const capture = await captureStreamPage(parsed(BV), '标签页标题', fn);
    expect(capture).toMatchObject({ url: BV, title: '标签页标题', fetched: false, stream: { platform: 'bilibili', videoId: 'BV1GJ411x7h7' } });
  });
});
