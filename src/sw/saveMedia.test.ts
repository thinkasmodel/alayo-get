import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { parse } from 'yaml';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createPendingQueue, type PendingQueue } from '@/io/pending';
import { createSavedIndex, type SavedIndex } from '@/io/savedIndex';
import type { Capture, SavingState } from '@/shared/types';
import { mediaCapture } from './route';
import { saveClip, type FetchLike, type SaveDeps } from './saveClip';

const NOW = new Date('2026-10-07T08:40:00.000Z');
const MB = 1024 * 1024;
const PAGE = 'https://sspai.com/post/90002?utm_source=feed';
const PAGE_CANONICAL = 'https://sspai.com/post/90002';
const IMG = 'https://cdn.sspai.com/2026/cover@2x.jpg';
const ID1 = '01JMEDIA000000000000000001';
const ID2 = '01JMEDIA000000000000000002';

type Body = Uint8Array | (() => ReadableStream<Uint8Array>);
interface FakeResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: Body;
}
/** 一个地址的假响应；head 缺省时 HEAD 用 GET 的响应头、不带响应体。 */
type FakeRoute = (FakeResponse & { head?: FakeResponse | 'network-error' }) | 'network-error';

/** 假 fetch：按地址与 method 返回预设响应，记录请求与返回的 Response。 */
function fakeFetch(routes: Record<string, FakeRoute>) {
  const calls: Array<{ url: string; method: string; init?: RequestInit; res?: Response }> = [];
  const fn: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const call: (typeof calls)[number] = { url, method, init };
    calls.push(call);
    const route = routes[url];
    if (!route || route === 'network-error') throw new TypeError('Failed to fetch');
    const spec = method === 'HEAD' ? (route.head ?? { status: route.status, headers: route.headers }) : route;
    if (spec === 'network-error') throw new TypeError('Failed to fetch');
    const body = method === 'HEAD' || spec.body === undefined ? null : typeof spec.body === 'function' ? spec.body() : spec.body;
    call.res = new Response(body as BodyInit | null, { status: spec.status ?? 200, headers: spec.headers ?? {} });
    return call.res;
  };
  return { fn, calls };
}

const bytes = (text: string) => new TextEncoder().encode(text);

/** 重复同一块数据 count 次的流（不真分配那么多内存）。 */
function repeatedStream(chunk: Uint8Array, count: number) {
  let sent = 0;
  const state = { pulled: 0 };
  const make = () =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= count) {
          controller.close();
          return;
        }
        sent++;
        state.pulled++;
        controller.enqueue(chunk);
      },
    });
  return { make, state };
}

let library: MemoryLibrary;
let index: SavedIndex;
let pending: PendingQueue;
let ids: string[];
let progress: SavingState[];

function makeDeps(fetchFn: FetchLike): SaveDeps {
  return {
    library,
    index,
    pending,
    fetch: fetchFn,
    now: () => NOW,
    newId: () => {
      const id = ids.shift();
      if (!id) throw new Error('测试 id 用完了');
      return id;
    },
    onProgress: (s) => progress.push(s),
  };
}

function frontmatterOf(md: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m?.[1]) throw new Error('没有 frontmatter');
  return parse(m[1]) as Record<string, unknown>;
}

const save = (capture: Capture, fetchFn: FetchLike, snapshot = false) => saveClip({ capture, snapshot }, makeDeps(fetchFn));

beforeEach(() => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  index = createSavedIndex();
  pending = createPendingQueue();
  ids = [ID1, ID2, '01JMEDIA000000000000000003'];
  progress = [];
});

describe('媒体剪藏：右键图片', () => {
  const jpg = bytes('jpeg-bytes-1');

  it('根目录出现“页面标题 - 原文件名.jpg”，字节一致；侧档字段与顺序同样张；记录键为媒体地址', async () => {
    const { fn, calls } = fakeFetch({ [IMG]: { headers: { 'content-type': 'image/jpeg', 'content-length': String(jpg.byteLength) }, body: jpg } });
    const outcome = await save(mediaCapture(PAGE, '少数派年度盘点', 'image', IMG), fn);

    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    const file = '少数派年度盘点 - cover@2x.jpg';
    expect([...library.files.keys()].sort()).toEqual([`.meta/${ID1}.json`, file].sort());
    expect(library.files.get(file)).toEqual(jpg);
    // 写入顺序：媒体文件 → 侧档
    expect(library.ops.map((o) => o.path)).toEqual([file, `.meta/${ID1}.json`]);
    // 带 cookie 下载
    expect(calls[0]?.init?.credentials).toBe('include');

    expect(library.text(`.meta/${ID1}.json`)).toBe(
      `${JSON.stringify(
        {
          id: ID1,
          file,
          source: PAGE_CANONICAL,
          media_url: IMG,
          medium: 'image',
          title: '少数派年度盘点',
          site: 'sspai.com',
          captured: NOW.toISOString(),
          bytes: jpg.byteLength,
          mime: 'image/jpeg',
          tags: [],
          note: '',
        },
        null,
        2,
      )}\n`,
    );

    expect(outcome.clip).toMatchObject({
      id: ID1,
      file,
      title: '少数派年度盘点',
      medium: 'image',
      site: 'sspai.com',
      source: IMG,
      extract: 'full',
      media: { kind: 'image', bytes: jpg.byteLength },
    });
    expect(await index.get(IMG)).toMatchObject({ id: ID1, file, medium: 'image', source: IMG });
    expect(await index.get(PAGE_CANONICAL)).toBeUndefined();

    // 下载进度：phase download 带类别
    const downloads = progress.filter((p) => p.progress.phase === 'download');
    expect(downloads.length).toBeGreaterThan(0);
    expect(downloads.every((p) => p.progress.kind === 'image' && p.preview.medium === 'image' && p.preview.source === IMG)).toBe(true);
    expect(downloads.at(-1)?.progress).toMatchObject({ done: jpg.byteLength, total: jpg.byteLength });
  });

  it('同一图片再存为 duplicate，不写文件；同页另一张图正常保存', async () => {
    const other = 'https://cdn.sspai.com/2026/second.png';
    const { fn } = fakeFetch({
      [IMG]: { headers: { 'content-type': 'image/jpeg' }, body: jpg },
      [other]: { headers: { 'content-type': 'image/png' }, body: bytes('png') },
    });
    expect((await save(mediaCapture(PAGE, '少数派年度盘点', 'image', IMG), fn)).state).toBe('saved');
    const opsBefore = library.ops.length;
    const again = await save(mediaCapture(PAGE, '少数派年度盘点', 'image', `${IMG}#again`), fn);
    expect(again.state).toBe('duplicate');
    expect(library.ops.length).toBe(opsBefore);

    const second = await save(mediaCapture(PAGE, '少数派年度盘点', 'image', other), fn);
    expect(second.state).toBe('saved');
    expect(library.files.has('少数派年度盘点 - second.png')).toBe(true);
    expect(library.files.has(`.meta/${ID2}.json`)).toBe(true);
  });

  it('页面标题与原文件名相同 → 只用原文件名；重名得到 … (2).jpg', async () => {
    library.files.set('cover@2x.jpg', bytes('old'));
    const { fn } = fakeFetch({ [IMG]: { headers: { 'content-type': 'image/jpeg' }, body: jpg } });
    const outcome = await save(mediaCapture(PAGE, 'cover@2x.jpg', 'image', IMG), fn);
    expect(outcome.state === 'saved' && outcome.clip.file).toBe('cover@2x (2).jpg');
    expect(library.files.get('cover@2x.jpg')).toEqual(bytes('old'));
  });

  it('data: 图片：去重键是内容的 SHA-256，侧档 media_url 写 data: 加 mime，扩展名按 mime 补', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const { fn, calls } = fakeFetch({});
    const outcome = await save(mediaCapture(PAGE, '内嵌图', 'image', dataUrl), fn);
    expect(calls).toHaveLength(0);
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(outcome.clip.file).toBe('内嵌图.png');
    expect(outcome.clip.source).toMatch(/^data:sha256:[0-9a-f]{64}$/);
    const meta = JSON.parse(library.text(`.meta/${ID1}.json`) ?? '{}') as Record<string, unknown>;
    expect(meta).toMatchObject({ media_url: 'data:image/png', mime: 'image/png', bytes: 8 });
    expect((await save(mediaCapture(PAGE, '内嵌图', 'image', dataUrl), fn)).state).toBe('duplicate');
  });

  it('超过 1MB 的 data: 图片在需要授权时不进暂存队列，返回 DataUrlTooLarge', async () => {
    library.permissionState = 'prompt';
    const big = `data:image/png;base64,${'A'.repeat(MB + 8)}`;
    const outcome = await save(mediaCapture(PAGE, '内嵌图', 'image', big), fakeFetch({}).fn);
    expect(outcome).toMatchObject({
      state: 'failed',
      error: { name: 'DataUrlTooLarge', message: '这张图片是内嵌数据，太大，没法暂存，请授权后重新保存' },
    });
    expect(await pending.list()).toEqual([]);
    // 小的照常暂存
    expect((await save(mediaCapture(PAGE, '内嵌图', 'image', 'data:image/png;base64,iVBORw0KGgo='), fakeFetch({}).fn)).state).toBe('needs-permission');
    expect(await pending.list()).toHaveLength(1);
  });
});

describe('媒体剪藏：PDF', () => {
  const PDF = 'https://arxiv.org/pdf/1706.03762';

  it('没有 content-length：边读边下载成功，medium pdf，扩展名按 content-type 补', async () => {
    const { make } = repeatedStream(bytes('%PDF-'), 3);
    const { fn } = fakeFetch({ [PDF]: { headers: { 'content-type': 'application/pdf' }, body: make } });
    const outcome = await save(mediaCapture(PDF, 'Attention Is All You Need', 'pdf', PDF), fn);
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(outcome.clip).toMatchObject({ file: 'Attention Is All You Need - 1706.03762.pdf', medium: 'pdf', media: { kind: 'pdf', bytes: 15 } });
    expect(library.text('Attention Is All You Need - 1706.03762.pdf')).toBe('%PDF-%PDF-%PDF-');
    const meta = JSON.parse(library.text(`.meta/${ID1}.json`) ?? '{}') as Record<string, unknown>;
    expect(meta).toMatchObject({ source: PDF, media_url: PDF, medium: 'pdf', mime: 'application/pdf', bytes: 15 });
    // 总数未知时 download 进度不带 total
    expect(progress.find((p) => p.progress.phase === 'download')?.progress).toEqual({ phase: 'download', done: 0, kind: 'pdf' });
  });

  it('流超过 100MB → 中止下载，存成书签剪藏（extract partial，标题用页面标题），没有残留的半截文件', async () => {
    const stream = repeatedStream(new Uint8Array(MB), 101);
    const { fn } = fakeFetch({ [PDF]: { headers: { 'content-type': 'application/pdf' }, body: stream.make } });
    const outcome = await save(mediaCapture(PDF, '一篇很大的论文', 'pdf', PDF), fn);
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(stream.state.pulled).toBeLessThanOrEqual(102);
    expect(outcome.clip).toMatchObject({ medium: 'link', extract: 'partial', title: '一篇很大的论文', file: '一篇很大的论文.md', source: PDF });
    expect([...library.files.keys()]).toEqual(['一篇很大的论文.md']);
    const fm = frontmatterOf(library.text('一篇很大的论文.md') ?? '');
    expect(fm).toMatchObject({ medium: 'link', extract: 'partial', source: PDF, title: '一篇很大的论文' });
    expect(await index.get(PDF)).toMatchObject({ medium: 'link' });
  });

  it('content-length 超过 100MB → 不读响应体，直接退回书签剪藏', async () => {
    const stream = repeatedStream(new Uint8Array(MB), 200);
    const { fn } = fakeFetch({ [PDF]: { headers: { 'content-type': 'application/pdf', 'content-length': String(200 * MB) }, body: stream.make } });
    const outcome = await save(mediaCapture(PDF, '大论文', 'pdf', PDF), fn);
    expect(outcome.state === 'saved' && outcome.clip.medium).toBe('link');
    expect([...library.files.keys()]).toEqual(['大论文.md']);
  });

  it('HTTP 错误 → failed（DownloadError），不写文件', async () => {
    const { fn } = fakeFetch({ [PDF]: { status: 403, body: bytes('no') } });
    const outcome = await save(mediaCapture(PDF, '论文', 'pdf', PDF), fn);
    expect(outcome).toMatchObject({ state: 'failed', error: { name: 'DownloadError', message: '下载失败（HTTP 403）' } });
    expect(library.files.size).toBe(0);
  });
});

describe('媒体剪藏：音视频直链', () => {
  const VIDEO = 'https://cdn.example.com/media/keynote-1080p.mp4';
  const AUDIO = 'https://cdn.example.com/media/episode.mp3';
  const VPAGE = 'https://example.com/wwdc';

  it('视频 content-length 150MB → 直链流媒体剪藏（platform other），只发 HEAD，不下载', async () => {
    const { fn, calls } = fakeFetch({ [VIDEO]: { headers: { 'content-type': 'video/mp4', 'content-length': String(150 * MB) }, body: bytes('never') } });
    const outcome = await save(mediaCapture(VPAGE, 'WWDC 主题演讲', 'video', VIDEO), fn);
    expect(calls.map((c) => c.method)).toEqual(['HEAD']);
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    const file = 'WWDC 主题演讲 - keynote-1080p.mp4.md';
    expect(outcome.clip).toMatchObject({
      file,
      title: 'WWDC 主题演讲 - keynote-1080p.mp4',
      medium: 'video',
      source: VIDEO,
      site: 'cdn.example.com',
      extract: 'full',
      stream: { platform: 'other', duration: null, medium: 'video', oversize: { bytes: 150 * MB } },
    });
    expect([...library.files.keys()]).toEqual([file]);
    const md = library.text(file) ?? '';
    expect(frontmatterOf(md)).toMatchObject({ source: VIDEO, medium: 'video', platform: 'other', video_id: '', embed: '', duration: null, cover: '' });
    expect(md).toContain('\n▶ 视频直链 · 150 MB\n\n来自 [WWDC 主题演讲](https://example.com/wwdc)\n');
    expect(await index.get(VIDEO)).toMatchObject({ medium: 'video', file });
  });

  it('视频没有 content-length（HEAD、GET 都没有）→ 同样存流媒体，oversize.bytes 为 null，GET 不读响应体', async () => {
    const { fn, calls } = fakeFetch({ [VIDEO]: { headers: { 'content-type': 'video/mp4' }, body: bytes('never') } });
    const outcome = await save(mediaCapture(VPAGE, 'WWDC 主题演讲', 'video', VIDEO), fn);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
    expect(calls[1]?.res?.bodyUsed).toBe(false);
    expect(outcome.state === 'saved' && outcome.clip.stream).toEqual({ platform: 'other', duration: null, medium: 'video', oversize: { bytes: null } });
    expect(library.text('WWDC 主题演讲 - keynote-1080p.mp4.md')).toContain('\n▶ 视频直链\n');
  });

  it('HEAD 失败时用 GET 的响应头', async () => {
    const { fn, calls } = fakeFetch({
      [VIDEO]: { head: 'network-error', headers: { 'content-type': 'video/mp4', 'content-length': String(150 * MB) }, body: bytes('never') },
    });
    const outcome = await save(mediaCapture(VPAGE, 'WWDC', 'video', VIDEO), fn);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
    expect(outcome.state === 'saved' && outcome.clip.stream?.oversize).toEqual({ bytes: 150 * MB });
  });

  it('音频 8MB → 媒体剪藏，下载原文件', async () => {
    const stream = repeatedStream(new Uint8Array(MB), 8);
    const { fn, calls } = fakeFetch({ [AUDIO]: { headers: { 'content-type': 'audio/mpeg', 'content-length': String(8 * MB) }, body: stream.make } });
    const outcome = await save(mediaCapture(VPAGE, '播客', 'audio', AUDIO), fn);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(outcome.clip).toMatchObject({ file: '播客 - episode.mp3', medium: 'audio', media: { kind: 'audio', bytes: 8 * MB } });
    expect(outcome.clip.stream).toBeUndefined();
    expect((library.files.get('播客 - episode.mp3') as Uint8Array).byteLength).toBe(8 * MB);
    // 进度节流：每 1MB 至少推一次，最后一次 done = total
    const downloads = progress.filter((p) => p.progress.phase === 'download').map((p) => p.progress);
    expect(downloads.length).toBeGreaterThanOrEqual(8);
    expect(downloads.at(-1)).toEqual({ phase: 'download', done: 8 * MB, total: 8 * MB, kind: 'audio' });
  });

  it('标签页本身就是媒体文件：不写“来自”那一行', async () => {
    const { fn } = fakeFetch({ [VIDEO]: { headers: { 'content-type': 'video/mp4', 'content-length': String(150 * MB) } } });
    const outcome = await save(mediaCapture(VIDEO, 'keynote-1080p.mp4', 'video', VIDEO), fn);
    expect(outcome.state === 'saved' && outcome.clip.title).toBe('keynote-1080p.mp4');
    expect(library.text('keynote-1080p.mp4.md')).not.toContain('来自');
  });
});

describe('媒体剪藏：写到一半出错', () => {
  it('写 .meta 时抛错：媒体文件被删掉，记录没写，结果为 failed', async () => {
    const { fn } = fakeFetch({ [IMG]: { headers: { 'content-type': 'image/jpeg' }, body: bytes('jpeg') } });
    library.failWrite = { match: (p) => p.startsWith('.meta/'), error: Object.assign(new Error('磁盘满了'), { name: 'QuotaExceededError' }) };
    const outcome = await save(mediaCapture(PAGE, '少数派年度盘点', 'image', IMG), fn);
    expect(outcome).toMatchObject({ state: 'failed', error: { name: 'QuotaExceededError', message: '磁盘满了' } });
    expect(library.files.size).toBe(0);
    expect(library.ops).toEqual([
      { op: 'write', path: '少数派年度盘点 - cover@2x.jpg' },
      { op: 'remove', path: '少数派年度盘点 - cover@2x.jpg' },
    ]);
    expect(await index.all()).toEqual({});
  });
});

describe('媒体剪藏：响应是网页', () => {
  it('PDF 地址返回 200 + text/html（如登录页）→ failed（DownloadError），不写文件、不写记录', async () => {
    const PDF = 'https://arxiv.org/pdf/1706.03762';
    const { fn } = fakeFetch({ [PDF]: { headers: { 'content-type': 'Text/HTML; charset=utf-8' }, body: bytes('<html>login</html>') } });
    const outcome = await save(mediaCapture(PDF, '论文', 'pdf', PDF), fn);
    expect(outcome).toMatchObject({ state: 'failed', error: { name: 'DownloadError', message: '服务器返回的是网页，不是文件（可能需要登录）' } });
    expect(library.files.size).toBe(0);
    expect(await index.get(PDF)).toBeUndefined();
  });
});

// ALAG-17 S2：扩展名由已验证的 MIME 定，服务器给的文件名只贡献主干
describe('媒体剪藏：服务器给的文件名后缀', () => {
  const PHOTO = 'https://cdn.sspai.com/2026/photo.png';

  it('application/octet-stream + filename="photo.bat" → 写出 .bin，主干含 photo，侧档 file 一致', async () => {
    const { fn } = fakeFetch({
      [PHOTO]: { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="photo.bat"' }, body: bytes('MZ') },
    });
    const outcome = await save(mediaCapture(PAGE, '少数派年度盘点', 'image', PHOTO), fn);
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    const file = outcome.clip.file;
    expect(file.endsWith('.bin')).toBe(true);
    expect(file).not.toContain('.bat');
    expect(file.slice(0, -'.bin'.length)).toContain('photo');
    expect(library.files.has(file)).toBe(true);
    const meta = JSON.parse(library.text(`.meta/${ID1}.json`) ?? '{}') as Record<string, unknown>;
    expect(meta.file).toBe(file);
  });

  it('同一地址返回 text/html（文件名说是 .png）→ 仍是 failed（DownloadError），不写文件', async () => {
    const { fn } = fakeFetch({
      [PHOTO]: { headers: { 'content-type': 'text/html', 'content-disposition': 'attachment; filename="photo.png"' }, body: bytes('<html></html>') },
    });
    const outcome = await save(mediaCapture(PAGE, '少数派年度盘点', 'image', PHOTO), fn);
    expect(outcome).toMatchObject({ state: 'failed', error: { name: 'DownloadError' } });
    expect(library.files.size).toBe(0);
  });
});
