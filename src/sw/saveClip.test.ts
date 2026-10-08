import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { parse } from 'yaml';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createPendingQueue } from '@/io/pending';
import { createSavedIndex } from '@/io/savedIndex';
import type { Capture, SavingState } from '@/shared/types';
import { captureLink, flushPending, saveClip, type FetchLike, type SaveDeps } from './saveClip';

const NOW = new Date('2026-10-06T02:00:00.000Z');

type FakeRoute = { status?: number; type?: string; body?: string } | 'network-error';

/** 假 fetch：按 URL 返回预设响应，并记录请求。 */
function fakeFetch(routes: Record<string, FakeRoute>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route || route === 'network-error') throw new TypeError('Failed to fetch');
    const headers = new Headers();
    if (route.type) headers.set('content-type', route.type);
    return new Response(route.body ?? 'image-bytes', { status: route.status ?? 200, headers });
  };
  return { fn, calls };
}

function articleCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    url: 'https://www.example.com/post?id=7&utm_source=feed#top',
    title: '一篇文章：测试',
    site: '示例站',
    author: 'Ada',
    published: '2026-10-01',
    description: '描述',
    coverUrl: '',
    markdown: [
      '第一段。',
      '![图一](https://img.example.com/1.jpg)',
      '![图二](https://img.example.com/2)',
      '![图一又出现](https://img.example.com/1.jpg)',
      '![内嵌](data:image/gif;base64,R0lGOD)',
    ].join('\n\n'),
    textLength: 500,
    kind: 'page',
    ...overrides,
  };
}

const SOURCE = 'https://www.example.com/post?id=7';

let library: MemoryLibrary;
let ids: string[];
let progress: SavingState[];

function makeDeps(fetchFn: FetchLike, extra: Partial<SaveDeps> = {}): SaveDeps {
  return {
    library,
    index: createSavedIndex(),
    pending: createPendingQueue(),
    fetch: fetchFn,
    now: () => NOW,
    newId: () => {
      const id = ids.shift();
      if (!id) throw new Error('测试 id 用完了');
      return id;
    },
    onProgress: (s) => progress.push(s),
    ...extra,
  };
}

function frontmatterOf(md: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m?.[1]) throw new Error('没有 frontmatter');
  return parse(m[1]) as Record<string, unknown>;
}

beforeEach(() => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  ids = ['01JID000000000000000000001', '01JID000000000000000000002', '01JID000000000000000000003'];
  progress = [];
});

describe('saveClip', () => {
  it('文章剪藏：写出附件和 .md，附件全部写完后才写 .md', async () => {
    const { fn, calls } = fakeFetch({
      'https://img.example.com/1.jpg': { type: 'image/jpeg' },
      'https://img.example.com/2': { type: 'image/png' },
    });
    const deps = makeDeps(fn);
    const outcome = await saveClip({ capture: articleCapture(), snapshot: false }, deps);

    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    const id = '01JID000000000000000000001';
    expect(outcome.clip).toMatchObject({
      id,
      file: '一篇文章：测试.md',
      title: '一篇文章：测试',
      medium: 'web',
      site: 'example.com',
      source: SOURCE,
      extract: 'full',
      imageCount: 2,
      imageFailures: 0,
      tags: [],
      note: '',
      savedAt: NOW.toISOString(),
    });

    // 文件集合
    expect([...library.files.keys()].sort()).toEqual(
      [`.assets/${id}/1.jpg`, `.assets/${id}/2.png`, '一篇文章：测试.md'].sort(),
    );
    // 写入顺序：.md 最后
    const writes = library.ops.filter((o) => o.op === 'write').map((o) => o.path);
    expect(writes).toHaveLength(3);
    expect(writes[writes.length - 1]).toBe('一篇文章：测试.md');
    // 同一地址只下载一次；请求不带凭据
    expect(calls.map((c) => c.url).sort()).toEqual(['https://img.example.com/1.jpg', 'https://img.example.com/2']);
    expect(calls.every((c) => c.init?.credentials === 'omit')).toBe(true);

    const md = library.text('一篇文章：测试.md') ?? '';
    expect(frontmatterOf(md)).toEqual({
      id,
      source: SOURCE,
      medium: 'web',
      title: '一篇文章：测试',
      author: 'Ada',
      published: '2026-10-01T00:00:00.000Z',
      captured: NOW.toISOString(),
      site: 'example.com',
      tags: [],
      note: '',
      extract: 'full',
    });
    const body = md.slice(md.indexOf('\n---\n') + 5);
    expect(body).toBe(
      [
        '',
        '# 一篇文章：测试',
        '',
        `[原文](${SOURCE})`,
        '',
        '第一段。',
        '',
        `![图一](.assets/${id}/1.jpg)`,
        '',
        `![图二](.assets/${id}/2.png)`,
        '',
        `![图一又出现](.assets/${id}/1.jpg)`,
        '',
        '![内嵌](data:image/gif;base64,R0lGOD)',
        '',
      ].join('\n'),
    );

    // 已保存记录
    expect(await deps.index.get(SOURCE)).toEqual({
      id,
      file: '一篇文章：测试.md',
      title: '一篇文章：测试',
      medium: 'web',
      source: SOURCE,
      savedAt: NOW.toISOString(),
      tags: [],
    });
  });

  it('有一张图片下载失败：保留远程地址，imageFailures 为 1', async () => {
    const { fn } = fakeFetch({
      'https://img.example.com/1.jpg': { type: 'image/jpeg' },
      'https://img.example.com/2': 'network-error',
    });
    const outcome = await saveClip({ capture: articleCapture(), snapshot: false }, makeDeps(fn));
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(outcome.clip.imageCount).toBe(1);
    expect(outcome.clip.imageFailures).toBe(1);
    const md = library.text(outcome.clip.file) ?? '';
    expect(md).toContain('![图二](https://img.example.com/2)');
    expect(md).toContain('![图一](.assets/01JID000000000000000000001/1.jpg)');
    expect([...library.files.keys()].filter((p) => p.startsWith('.assets/'))).toEqual([
      '.assets/01JID000000000000000000001/1.jpg',
    ]);
  });

  it('HTTP 错误、定不出扩展名都算下载失败', async () => {
    const { fn } = fakeFetch({
      'https://img.example.com/1.jpg': { status: 404, type: 'text/html' },
      'https://img.example.com/2': { type: 'application/octet-stream' },
    });
    const outcome = await saveClip({ capture: articleCapture(), snapshot: false }, makeDeps(fn));
    expect(outcome.state === 'saved' && outcome.clip.imageFailures).toBe(2);
  });

  // ALAG-8：图片地址返回 200 的网页（维基百科 /wiki/File:X.png 说明页）时不能存成 .jpg/.png
  it('图片地址返回 200 的网页：算下载失败，保留远程地址，不写附件', async () => {
    const { fn } = fakeFetch({
      'https://img.example.com/1.jpg': { type: 'text/html; charset=utf-8', body: '<!DOCTYPE html><title>File:1.jpg</title>' },
      'https://img.example.com/2': { type: 'image/png' },
    });
    const outcome = await saveClip({ capture: articleCapture(), snapshot: false }, makeDeps(fn));
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(outcome.clip.imageCount).toBe(1);
    expect(outcome.clip.imageFailures).toBe(1);
    expect(library.text(outcome.clip.file) ?? '').toContain('![图一](https://img.example.com/1.jpg)');
    expect([...library.files.keys()].filter((p) => p.startsWith('.assets/'))).toEqual(['.assets/01JID000000000000000000001/2.png']);
  });

  it('markdown 为 null 时退化为书签剪藏，extract: fallback', async () => {
    const { fn } = fakeFetch({ 'https://cdn.example.com/cover': { type: 'image/webp' } });
    const capture = articleCapture({ markdown: null, coverUrl: 'https://cdn.example.com/cover', description: '页面描述' });
    const outcome = await saveClip({ capture, snapshot: false }, makeDeps(fn));
    expect(outcome.state).toBe('fallback');
    if (outcome.state !== 'fallback') return;
    expect(outcome.clip.medium).toBe('link');
    expect(outcome.clip.extract).toBe('fallback');
    const md = library.text(outcome.clip.file) ?? '';
    const fm = frontmatterOf(md);
    expect(fm.medium).toBe('link');
    expect(fm.extract).toBe('fallback');
    expect(md.slice(md.indexOf('\n---\n') + 5)).toBe(
      `\n[一篇文章：测试](${SOURCE})\n\n页面描述\n\n![](.assets/01JID000000000000000000001/cover.webp)\n`,
    );
    const writes = library.ops.map((o) => o.path);
    expect(writes).toEqual(['.assets/01JID000000000000000000001/cover.webp', outcome.clip.file]);
  });

  it('不能注入的页面存成书签剪藏，extract: fallback，没有描述和封面就不写', async () => {
    const capture: Capture = {
      url: 'chrome://extensions/',
      title: '扩展程序',
      site: '',
      author: '',
      published: '',
      description: '',
      coverUrl: '',
      markdown: null,
      textLength: 0,
      kind: 'uninjectable',
    };
    const outcome = await saveClip({ capture, snapshot: false }, makeDeps(fakeFetch({}).fn));
    expect(outcome.state).toBe('fallback');
    const md = library.text('扩展程序.md') ?? '';
    expect(md.slice(md.indexOf('\n---\n') + 5)).toBe('\n[扩展程序](chrome://extensions/)\n');
  });

  it('重复保存返回 duplicate，不写任何文件', async () => {
    const { fn } = fakeFetch({});
    const deps = makeDeps(fn);
    const first = await saveClip({ capture: articleCapture(), snapshot: false }, deps);
    expect(first.state).toBe('saved');
    const opsBefore = library.ops.length;
    const filesBefore = new Map(library.files);

    // 换一个只差跟踪参数和 fragment 的地址，规范化后是同一个出处
    const again = await saveClip(
      { capture: articleCapture({ url: 'https://www.example.com/post?id=7&fbclid=zzz' }), snapshot: false },
      deps,
    );
    expect(again.state).toBe('duplicate');
    if (again.state !== 'duplicate') return;
    expect(again.previous.id).toBe('01JID000000000000000000001');
    expect(again.preview.source).toBe(SOURCE);
    expect(library.ops.length).toBe(opsBefore);
    expect(library.files).toEqual(filesBefore);
  });

  it('另存快照：写出 名 (2).md，生成新的 id，已保存记录指向最新的', async () => {
    const { fn } = fakeFetch({});
    const deps = makeDeps(fn);
    const first = await saveClip({ capture: articleCapture(), snapshot: false }, deps);
    const second = await saveClip({ capture: articleCapture(), snapshot: true }, deps);
    expect(first.state).toBe('saved');
    expect(second.state).toBe('saved');
    if (first.state !== 'saved' || second.state !== 'saved') return;
    expect(second.clip.file).toBe('一篇文章：测试 (2).md');
    expect(second.clip.id).toBe('01JID000000000000000000002');
    expect(second.clip.id).not.toBe(first.clip.id);
    expect(library.text('一篇文章：测试.md')).toBeDefined();
    expect(frontmatterOf(library.text('一篇文章：测试 (2).md') ?? '').id).toBe('01JID000000000000000000002');
    expect((await deps.index.get(SOURCE))?.file).toBe('一篇文章：测试 (2).md');
  });

  it('剪藏库未授权：返回 needs-permission，暂存一条；授权后补写成功，队列清空', async () => {
    const { fn } = fakeFetch({ 'https://img.example.com/1.jpg': { type: 'image/jpeg' } });
    const deps = makeDeps(fn);
    library.permissionState = 'prompt';

    const outcome = await saveClip({ capture: articleCapture(), snapshot: false }, deps);
    expect(outcome.state).toBe('needs-permission');
    expect(library.files.size).toBe(0);
    const queued = await deps.pending.list();
    expect(queued).toEqual([{ capture: articleCapture(), snapshot: false }]);
    // 存在 chrome.storage.session 的 pendingSaves 里
    expect((await fakeBrowser.storage.session.get('pendingSaves')).pendingSaves).toHaveLength(1);

    // 仍未授权时补写什么都不做
    await flushPending(deps);
    expect(await deps.pending.list()).toHaveLength(1);

    library.permissionState = 'granted';
    const outcomes: string[] = [];
    await flushPending(deps, (o) => outcomes.push(o.state));
    expect(outcomes).toEqual(['saved']);
    expect(await deps.pending.list()).toEqual([]);
    expect(library.text('一篇文章：测试.md')).toContain('# 一篇文章：测试');
    expect(await deps.index.get(SOURCE)).toBeDefined();
  });

  it('还没选剪藏库也返回 needs-permission；队列最多 20 条，超出丢最早的', async () => {
    library.permissionState = 'missing';
    const deps = makeDeps(fakeFetch({}).fn);
    for (let i = 0; i < 22; i++) {
      const outcome = await saveClip(
        { capture: articleCapture({ url: `https://example.com/p${i}` }), snapshot: false },
        deps,
      );
      expect(outcome.state).toBe('needs-permission');
    }
    const queued = await deps.pending.list();
    expect(queued).toHaveLength(20);
    expect(queued[0]?.capture.url).toBe('https://example.com/p2');
    expect(queued[19]?.capture.url).toBe('https://example.com/p21');
  });

  it('写入抛 NotFoundError：返回 failed，带错误名', async () => {
    const err = new Error('目录不存在了');
    err.name = 'NotFoundError';
    library.failWrite = { match: (p) => p.endsWith('.md'), error: err };
    const deps = makeDeps(fakeFetch({}).fn);
    const outcome = await saveClip({ capture: articleCapture(), snapshot: false }, deps);
    expect(outcome).toEqual({
      state: 'failed',
      preview: { title: '一篇文章：测试', site: 'example.com', source: SOURCE, medium: 'web' },
      error: { name: 'NotFoundError', message: '目录不存在了' },
    });
    expect(await deps.index.get(SOURCE)).toBeUndefined();
  });

  it('onProgress 收到图片进度 done / total，最后进入 write 阶段', async () => {
    const { fn } = fakeFetch({
      'https://img.example.com/1.jpg': { type: 'image/jpeg' },
      'https://img.example.com/2': { type: 'image/png' },
    });
    await saveClip({ capture: articleCapture(), snapshot: false }, makeDeps(fn));
    expect(progress.every((p) => p.state === 'saving' && p.preview.source === SOURCE)).toBe(true);
    const imageSteps = progress.filter((p) => p.progress.phase === 'images').map((p) => p.progress);
    expect(imageSteps[0]).toEqual({ phase: 'images', done: 0, total: 2 });
    expect(imageSteps.map((p) => p.done)).toEqual([0, 1, 2]);
    expect(imageSteps.every((p) => p.total === 2)).toBe(true);
    expect(progress[progress.length - 1]?.progress).toEqual({ phase: 'write' });
  });
});

describe('saveClip：X 剪藏（ALAG-3）', () => {
  const X_SOURCE = 'https://x.com/naval/status/1002103360646823936';

  function xCapture(overrides: Partial<Capture> = {}): Capture {
    return {
      url: X_SOURCE,
      title: '@naval - How to Get Rich (without getting lucky):',
      site: 'x.com',
      author: 'Naval (@naval)',
      published: '2018-05-31T04:34:00.000Z',
      description: '',
      coverUrl: '',
      markdown: ['How to Get Rich', '![](https://pbs.twimg.com/media/A?format=jpg&name=large)', '第二条'].join('\n\n'),
      textLength: 30,
      kind: 'page',
      x: { form: 'thread', posts: 41, partial: null },
      ...overrides,
    };
  }

  it('带 x：frontmatter 写 medium: x、extract: full；图片照常下载并改写；已保存记录 medium 为 x；ClipSummary 带 x', async () => {
    const { fn, calls } = fakeFetch({ 'https://pbs.twimg.com/media/A?format=jpg&name=large': { type: 'image/jpeg' } });
    const deps = makeDeps(fn);
    const outcome = await saveClip({ capture: xCapture(), snapshot: false }, deps);
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    const id = '01JID000000000000000000001';
    expect(outcome.clip).toMatchObject({ medium: 'x', extract: 'full', imageCount: 1, imageFailures: 0, site: 'x.com' });
    expect(outcome.clip.x).toEqual({ form: 'thread', posts: 41, partial: null });
    expect(calls.map((c) => c.url)).toEqual(['https://pbs.twimg.com/media/A?format=jpg&name=large']);

    const md = library.text(outcome.clip.file) ?? '';
    const fm = frontmatterOf(md);
    expect(fm.medium).toBe('x');
    expect(fm.extract).toBe('full');
    expect(fm.title).toBe('@naval - How to Get Rich (without getting lucky):');
    expect(md.slice(md.indexOf('\n---\n') + 5)).toBe(
      [
        '',
        '# @naval - How to Get Rich (without getting lucky):',
        '',
        `[原文](${X_SOURCE})`,
        '',
        'How to Get Rich',
        '',
        `![](.assets/${id}/1.jpg)`,
        '',
        '第二条',
        '',
      ].join('\n'),
    );
    expect((await deps.index.get(X_SOURCE))?.medium).toBe('x');
  });

  it('partial 非 null：写 extract: partial，ClipSummary 的 extract 为 partial、x 原样传递，状态仍是 saved', async () => {
    const x = { form: 'thread' as const, posts: 50, partial: { limit: true, timeout: false, truncated: 2 } };
    const outcome = await saveClip({ capture: xCapture({ markdown: '正文', x }), snapshot: false }, makeDeps(fakeFetch({}).fn));
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(outcome.clip.extract).toBe('partial');
    expect(outcome.clip.medium).toBe('x');
    expect(outcome.clip.x).toEqual(x);
    const fm = frontmatterOf(library.text(outcome.clip.file) ?? '');
    expect(fm.extract).toBe('partial');
    expect(fm.medium).toBe('x');
  });

  it('长文带 heading：正文一级标题是长文标题，frontmatter 的 title 仍带 @handle 前缀', async () => {
    const capture = xCapture({
      url: 'https://x.com/0xCodila/status/2100984487802708306',
      title: '@0xCodila - Jev Engineering',
      markdown: '## 01\\. 小标题\n\n正文',
      x: { form: 'article', posts: 1, partial: null, heading: 'Jev Engineering' },
    });
    const outcome = await saveClip({ capture, snapshot: false }, makeDeps(fakeFetch({}).fn));
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    const md = library.text(outcome.clip.file) ?? '';
    expect(frontmatterOf(md).title).toBe('@0xCodila - Jev Engineering');
    const body = md.slice(md.indexOf('\n---\n') + 5);
    expect(body.startsWith('\n# Jev Engineering\n\n[原文](https://x.com/0xCodila/status/2100984487802708306)\n\n## 01')).toBe(true);
    expect(body).not.toContain('# @0xCodila');
  });

  it('不带 x 的页面采集照旧是 medium: web，ClipSummary 没有 x', async () => {
    const outcome = await saveClip({ capture: articleCapture({ markdown: '正文' }), snapshot: false }, makeDeps(fakeFetch({}).fn));
    expect(outcome.state === 'saved' && outcome.clip.medium).toBe('web');
    expect(outcome.state === 'saved' && 'x' in outcome.clip).toBe(false);
  });

  it('X 页面退化为书签（markdown 为 null、不带 x）：照旧 medium: link，extract: fallback', async () => {
    const outcome = await saveClip({ capture: xCapture({ markdown: null, x: undefined }), snapshot: false }, makeDeps(fakeFetch({}).fn));
    expect(outcome.state).toBe('fallback');
    expect(outcome.state === 'fallback' && outcome.clip.medium).toBe('link');
  });
});

describe('captureLink', () => {
  it('抓到目标页：解析元数据，fetched 为 true，存成 extract: full 的书签剪藏', async () => {
    const html = `<html><head><title>目标页</title><meta property="og:description" content="目标描述">
      <meta property="og:image" content="/cover.png"></head></html>`;
    const { fn } = fakeFetch({
      'https://target.example.com/a': { type: 'text/html; charset=utf-8', body: html },
      'https://target.example.com/cover.png': { type: 'image/png' },
    });
    const capture = await captureLink('https://target.example.com/a', '链接文字', fn);
    expect(capture).toMatchObject({
      kind: 'link',
      fetched: true,
      title: '目标页',
      description: '目标描述',
      coverUrl: 'https://target.example.com/cover.png',
      markdown: null,
    });
    const outcome = await saveClip({ capture, snapshot: false }, makeDeps(fn));
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(outcome.clip.extract).toBe('full');
    expect(outcome.clip.medium).toBe('link');
    expect(frontmatterOf(library.text(outcome.clip.file) ?? '').extract).toBe('full');
  });

  it('抓取失败或不是 HTML：只记 URL 和链接文字，存成 extract: partial', async () => {
    const { fn } = fakeFetch({ 'https://target.example.com/file.pdf': { type: 'application/pdf' } });
    const failed = await captureLink('https://target.example.com/gone', '链接文字', fn);
    expect(failed).toMatchObject({ kind: 'link', fetched: false, title: '链接文字', description: '' });
    const pdf = await captureLink('https://target.example.com/file.pdf', '', fn);
    expect(pdf.title).toBe('https://target.example.com/file.pdf');

    const outcome = await saveClip({ capture: failed, snapshot: false }, makeDeps(fn));
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(outcome.clip.extract).toBe('partial');
    const md = library.text('链接文字.md') ?? '';
    expect(frontmatterOf(md).extract).toBe('partial');
    expect(md.slice(md.indexOf('\n---\n') + 5)).toBe('\n[链接文字](https://target.example.com/gone)\n');
  });
});

// ALAG-17 S3：图片边读边计数、单次剪藏附件总预算、链接页 HTML 字节上限
describe('saveClip：附件大小上限与总预算', () => {
  const MB = 1024 * 1024;
  const ID = '01JID000000000000000000001';

  /** 一个地址的流式假响应：count 块、每块 chunkBytes 字节；记录是否被取消。 */
  interface StreamRoute {
    type: string;
    chunkBytes: number;
    count: number;
    /** 带 content-length（= chunkBytes × count）。 */
    withLength?: boolean;
  }

  /** 假 fetch：响应体是按需拉取的流（highWaterMark 0），记录请求、返回的 Response 与流的取消状态。 */
  function streamFetch(routes: Record<string, StreamRoute>) {
    const calls: Array<{ url: string; res?: Response; state: { pulled: number; cancelled: boolean } }> = [];
    const fn: FetchLike = async (url) => {
      const route = routes[url];
      const state = { pulled: 0, cancelled: false };
      const call: (typeof calls)[number] = { url, state };
      calls.push(call);
      if (!route) throw new TypeError('Failed to fetch');
      const chunk = new Uint8Array(route.chunkBytes);
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (state.pulled >= route.count) {
              controller.close();
              return;
            }
            state.pulled++;
            controller.enqueue(chunk);
          },
          cancel() {
            state.cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      const headers = new Headers({ 'content-type': route.type });
      if (route.withLength) headers.set('content-length', String(route.chunkBytes * route.count));
      call.res = new Response(body, { headers });
      return call.res;
    };
    return { fn, calls };
  }

  it('一张没有 content-length 的 24MB 图片：边读边计数，超过 20MB 取消读取；文章照常保存，该图保留远程地址', async () => {
    const BIG = 'https://img.example.com/big.jpg';
    const { fn, calls } = streamFetch({ [BIG]: { type: 'image/jpeg', chunkBytes: MB, count: 24 } });
    const capture = articleCapture({ markdown: `第一段。\n\n![大图](${BIG})` });
    const outcome = await saveClip({ capture, snapshot: false }, makeDeps(fn));
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(outcome.clip.imageCount).toBe(0);
    expect(outcome.clip.imageFailures).toBe(1);
    expect(library.text(outcome.clip.file) ?? '').toContain(`![大图](${BIG})`);
    expect([...library.files.keys()].filter((p) => p.startsWith('.assets/'))).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.state.cancelled).toBe(true);
    expect(calls[0]?.state.pulled).toBeLessThanOrEqual(21);
  });

  it('附件总预算 3MB、4 张各 1MB（带 content-length）：存 3 张，跳过的一张保留远程地址、没有读响应体', async () => {
    const urls = [1, 2, 3, 4].map((n) => `https://img.example.com/${n}.png`);
    const { fn, calls } = streamFetch(Object.fromEntries(urls.map((u) => [u, { type: 'image/png', chunkBytes: MB, count: 1, withLength: true }])));
    const capture = articleCapture({ markdown: urls.map((u, i) => `![图${i + 1}](${u})`).join('\n\n') });
    const outcome = await saveClip({ capture, snapshot: false }, makeDeps(fn, { imageTotalMaxBytes: 3 * MB }));
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(outcome.clip.imageCount).toBe(3);
    expect(outcome.clip.imageFailures).toBe(1);
    const md = library.text(outcome.clip.file) ?? '';
    const skipped = urls.filter((u) => md.includes(`](${u})`));
    expect(skipped).toHaveLength(1);
    expect([...library.files.keys()].filter((p) => p.startsWith(`.assets/${ID}/`))).toHaveLength(3);
    // 被跳过的图片：没发请求，或发了但没读响应体
    const skippedCalls = calls.filter((c) => c.url === skipped[0]);
    expect(skippedCalls.every((c) => c.res?.bodyUsed === false && c.state.pulled === 0)).toBe(true);
  });

  // codex review 第 1 轮：gzip/br 响应的 content-length 是压缩长度，流已解压，不能当读取上限；预算按实际字节扣
  it('gzip 压缩的 SVG（content-length 139、实际 14046 字节）：正常保存，预算按实际字节扣', async () => {
    const SVG = 'https://img.example.com/logo.svg';
    const PNG = 'https://img.example.com/after.png';
    const svgBytes = 14_046;
    const pngBytes = 1000;
    // SVG 读完（流关闭、downloadImage 修正完预算）之后才放出第二张图的响应，让两张图的预算判断有先后
    let svgDone!: () => void;
    const afterSvg = new Promise<void>((resolve) => (svgDone = resolve));
    const calls: string[] = [];
    const fn: FetchLike = async (url) => {
      calls.push(url);
      if (url === SVG) {
        let pulls = 0;
        const body = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (pulls++ === 0) {
                controller.enqueue(new Uint8Array(svgBytes));
                return;
              }
              controller.close();
              setTimeout(svgDone, 0);
            },
            // 被判超限取消时也放行，回归时以断言失败而不是超时暴露
            cancel() {
              setTimeout(svgDone, 0);
            },
          },
          { highWaterMark: 0 },
        );
        return new Response(body, { headers: { 'content-type': 'image/svg+xml', 'content-encoding': 'gzip', 'content-length': '139' } });
      }
      if (url === PNG) {
        await afterSvg;
        return new Response(new Uint8Array(pngBytes), { headers: { 'content-type': 'image/png', 'content-length': String(pngBytes) } });
      }
      throw new TypeError('Failed to fetch');
    };
    const capture = articleCapture({ markdown: `![标志](${SVG})\n\n![后一张](${PNG})` });
    // 预算 = SVG 实际字节 + 500：按实际字节扣后剩 500，放不下 1000 字节的第二张；若只扣 139 则两张都能存
    const outcome = await saveClip({ capture, snapshot: false }, makeDeps(fn, { imageTotalMaxBytes: svgBytes + 500 }));
    expect(outcome.state).toBe('saved');
    if (outcome.state !== 'saved') return;
    expect(calls).toEqual([SVG, PNG]);
    expect(outcome.clip.imageCount).toBe(1);
    expect(outcome.clip.imageFailures).toBe(1);
    expect((library.files.get(`.assets/${ID}/1.svg`) as Uint8Array).byteLength).toBe(svgBytes);
    const md = library.text(outcome.clip.file) ?? '';
    expect(md).toContain(`![标志](.assets/${ID}/1.svg)`);
    expect(md).toContain(`![后一张](${PNG})`);
  });

  it('链接目标页超过 4MB：按抓取失败处理，返回 partial（fetched: false），不抛错', async () => {
    const { fn } = fakeFetch({ 'https://target.example.com/huge': { type: 'text/html; charset=utf-8', body: `<title>大页</title>${'x'.repeat(4 * MB)}` } });
    const capture = await captureLink('https://target.example.com/huge', '链接文字', fn);
    expect(capture).toMatchObject({ kind: 'link', fetched: false, title: '链接文字', description: '' });
  });
});
