// 保存编排：规范化出处 → 查重 → 查授权（未授权暂存）→ 下载图片、写附件、写 .md、写已保存记录。
// 媒体剪藏、流媒体剪藏与摘录剪藏（ALAG-4）的写法在 saveMedia.ts、saveStream.ts、saveQuote.ts，查重、加锁、清理、提交记录仍只在这里。
// 依赖全部注入，便于在 node 环境里用 MemoryLibrary 和假 fetch 测试。
import { libraryLock, type Lock } from './lock';
import { saveMediaClip } from './saveMedia';
import { quoteIndexKey, writeQuoteClip } from './saveQuote';
import { writeStreamClip } from './saveStream';
import { canonicalizeUrl } from '@/core/canonical';
import { buildArticleMarkdown, buildBookmarkMarkdown } from '@/core/document';
import { clipBaseName, uniqueFileName } from '@/core/filename';
import { siteFromUrl } from '@/core/frontmatter';
import { assetPath, extFromContentType, planImages, rewriteImages } from '@/core/images';
import { DATA_URL_SESSION_LIMIT, isDataUrl, mediaKeyOf } from '@/core/media';
import { parseHtmlMeta } from '@/core/meta';
import { tagSuggestions } from '@/core/tags';
import type { Library } from '@/io/library';
import type { PendingQueue } from '@/io/pending';
import type { QuoteOps } from '@/io/quoteOps';
import type { SavedIndex } from '@/io/savedIndex';
import { t } from '@/shared/i18n';
import type {
  Capture,
  ClipSummary,
  ExtractState,
  Medium,
  PendingSave,
  Preview,
  SaveOutcome,
  SavedEntry,
  SavingProgress,
  SavingState,
  TagCount,
} from '@/shared/types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SaveDeps {
  library: Library;
  index: SavedIndex;
  pending: PendingQueue;
  fetch: FetchLike;
  now: () => Date;
  newId: () => string;
  onProgress?: (state: SavingState) => void;
  /** 剪藏库互斥，缺省用 service worker 共用的 libraryLock。 */
  lock?: Lock;
  /** 已落盘的摘录操作表，缺省用 browser.storage.local（摘录幂等，ALAG-4）。 */
  quoteOps?: QuoteOps;
}

export interface SaveOptions {
  /** 补写暂存条目时为 true：失去授权不重新入队，由 flushPending 保留原条目。 */
  fromPending?: boolean;
}

export const IMAGE_CONCURRENCY = 4;
export const IMAGE_TIMEOUT_MS = 15_000;
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const LINK_TIMEOUT_MS = 10_000;

type Shape =
  | { medium: 'web' }
  | { medium: 'x'; extract: 'full' | 'partial' }
  | { medium: 'link'; extract: ExtractState }
  | { medium: 'media' }
  | { medium: 'stream' }
  | { medium: 'quote' };

/** 剪藏形态：文章剪藏（通用 web，或 X 专门适配的 x）、书签剪藏（带抽取状态）、媒体剪藏、流媒体剪藏、摘录剪藏（ALAG-4）。 */
function shapeOf(capture: Capture): Shape {
  if (capture.kind === 'quote' && capture.quote) return { medium: 'quote' };
  if (capture.kind === 'media' && capture.media) return { medium: 'media' };
  if (capture.kind === 'stream' && capture.stream) return { medium: 'stream' };
  if (capture.kind === 'page' && capture.markdown !== null && capture.x) {
    return { medium: 'x', extract: capture.x.partial ? 'partial' : 'full' };
  }
  if (capture.kind === 'page' && capture.markdown !== null) return { medium: 'web' };
  if (capture.kind === 'link') return { medium: 'link', extract: capture.fetched ? 'full' : 'partial' };
  return { medium: 'link', extract: 'fallback' };
}

/**
 * 已保存记录的键：web、x、link、stream 用规范化的 capture.url；media 用规范化的媒体地址
 * （data: 地址用内容的 SHA-256，`data:sha256:<hex>`）。预览的 source、查重与提交记录都用它。
 * 摘录（ALAG-4）的摘录文件记录用 `quote:` + 规范化页面地址；它的预览 source 仍是页面地址。
 */
export async function indexKeyOf(capture: Capture): Promise<string> {
  if (capture.kind === 'quote' && capture.quote) return quoteIndexKey(capture.url);
  if (capture.kind === 'media' && capture.media) return mediaKeyOf(capture.media.url);
  return canonicalizeUrl(capture.url);
}

export async function previewOf(capture: Capture): Promise<Preview> {
  const shape = shapeOf(capture);
  const source = shape.medium === 'quote' ? canonicalizeUrl(capture.url) : await indexKeyOf(capture);
  let medium: Preview['medium'];
  if (shape.medium === 'media') medium = capture.media?.kind ?? 'image';
  else if (shape.medium === 'stream') medium = 'stream';
  else if (shape.medium === 'quote') medium = 'quote';
  // 文章与 X 剪藏按文章显示
  else medium = shape.medium === 'link' ? 'link' : 'web';
  return {
    title: capture.title.trim() || capture.media?.fileName.trim() || source,
    // 媒体剪藏的 site 取所在网页的域名，其余同出处
    site: siteFromUrl(canonicalizeUrl(capture.url)),
    source,
    medium,
  };
}

function errorInfo(err: unknown): { name: string; message: string } {
  if (err && typeof err === 'object' && 'name' in err && 'message' in err) {
    return { name: String((err as Error).name), message: String((err as Error).message) };
  }
  return { name: 'Error', message: String(err) };
}

/** 有名字的错误（返回给面板与页面提示的 error.name）。 */
export function namedError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

export interface Downloaded {
  data: Blob;
  ext: string;
}

/** 下载一张图片；失败、超时、超过 20MB、定不出扩展名都返回 null。 */
async function downloadImage(fetchFn: FetchLike, url: string): Promise<Downloaded | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { credentials: 'omit', signal: controller.signal });
    if (!res.ok) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
      controller.abort();
      return null;
    }
    const contentType = res.headers.get('content-type');
    const ext = extFromContentType(contentType, url);
    if (!ext) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > IMAGE_MAX_BYTES) return null;
    return { data: new Blob([buf], { type: contentType ?? '' }), ext };
  } catch (err) {
    console.warn('[Alayo Get] 图片下载失败，保留远程地址', url, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 标签建议读取失败时降级为空，不影响保存结果。 */
async function safeTagSuggestions(index: SavedIndex): Promise<TagCount[]> {
  try {
    return tagSuggestions(await index.all(), '');
  } catch (err) {
    console.warn('[Alayo Get] 读取标签建议失败', err);
    return [];
  }
}

/**
 * 以固定并发跑任务，结果按输入顺序返回。
 * 任一任务抛错后不再分派新任务，等在途任务全部结束后再以第一个错误拒绝——
 * 这样调用方清理文件、释放锁之后，不会再有迟到的写入（codex review 第 4 轮）。
 */
async function runPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async () => {
    while (failure === null && next < items.length) {
      const i = next++;
      try {
        results[i] = await task(items[i] as T);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure !== null) throw (failure as { error: unknown }).error;
  return results;
}

/** 一次保存的写入上下文：媒体剪藏、流媒体剪藏的写法（saveMedia.ts、saveStream.ts）经它写文件，清理与提交仍由 saveClipLocked 管。 */
export interface WriteCtx {
  deps: SaveDeps;
  id: string;
  captured: Date;
  /** 写一个文件，并登记到本次保存的清理清单。 */
  write: (path: string, data: Blob | string) => Promise<void>;
  progress: (p: SavingProgress) => void;
  downloadImage: (url: string) => Promise<Downloaded | null>;
}

/** 一种形态写完后的结果，由 saveClipLocked 提交已保存记录、拼 ClipSummary。 */
export interface ClipResult {
  file: string;
  title: string;
  medium: Medium;
  extract: ExtractState;
  imageCount: number;
  imageFailures: number;
  /** 缺省取预览的 site。 */
  site?: string;
  extra?: Pick<ClipSummary, 'x' | 'media' | 'stream'>;
}

/** 文章剪藏（通用 web 或 X）：下载正文图片、改写成本地路径、写 .md。 */
async function writeArticle(ctx: WriteCtx, capture: Capture, title: string, medium: 'web' | 'x', extract: 'full' | 'partial'): Promise<ClipResult> {
  const source = canonicalizeUrl(capture.url);
  const body = capture.markdown ?? '';
  const plan = planImages(body);
  const local = new Map<string, string>();
  let imageCount = 0;
  let imageFailures = 0;
  let done = 0;
  ctx.progress({ phase: 'images', done, total: plan.length });
  await runPool(plan, IMAGE_CONCURRENCY, async (img) => {
    const got = await ctx.downloadImage(img.url);
    if (got) {
      const path = assetPath(ctx.id, img.index, got.ext);
      await ctx.write(path, got.data);
      local.set(img.url, path);
      imageCount++;
    } else {
      imageFailures++;
    }
    done++;
    ctx.progress({ phase: 'images', done, total: plan.length });
  });
  ctx.progress({ phase: 'write' });
  const markdown = buildArticleMarkdown({
    frontmatter: {
      id: ctx.id,
      source,
      title,
      author: capture.author,
      published: capture.published,
      captured: ctx.captured,
      tags: [],
      note: '',
    },
    body: rewriteImages(body, local),
    medium,
    extract,
    heading: medium === 'x' ? capture.x?.heading : undefined,
  });
  // 附件都写完后再写 .md
  const file = uniqueFileName(clipBaseName(title), await ctx.deps.library.listRoot());
  await ctx.write(file, markdown);
  return {
    file,
    title,
    medium,
    extract,
    imageCount,
    imageFailures,
    extra: medium === 'x' && capture.x ? { x: capture.x } : undefined,
  };
}

/** 书签剪藏：下载封面（可无）、写 .md。source 是 frontmatter 的出处（已规范化）。 */
async function writeBookmark(
  ctx: WriteCtx,
  fields: { source: string; title: string; author: string; published: string; description: string; coverUrl: string },
  extract: ExtractState,
): Promise<ClipResult> {
  let imageCount = 0;
  let imageFailures = 0;
  let coverPath = '';
  if (/^https?:\/\//i.test(fields.coverUrl)) {
    ctx.progress({ phase: 'images', done: 0, total: 1 });
    const got = await ctx.downloadImage(fields.coverUrl);
    if (got) {
      coverPath = assetPath(ctx.id, 'cover', got.ext);
      await ctx.write(coverPath, got.data);
      imageCount++;
    } else {
      imageFailures++;
    }
    ctx.progress({ phase: 'images', done: 1, total: 1 });
  }
  ctx.progress({ phase: 'write' });
  const markdown = buildBookmarkMarkdown({
    frontmatter: {
      id: ctx.id,
      source: fields.source,
      title: fields.title,
      author: fields.author,
      published: fields.published,
      captured: ctx.captured,
      tags: [],
      note: '',
      extract,
    },
    description: fields.description,
    coverPath,
  });
  const file = uniqueFileName(clipBaseName(fields.title), await ctx.deps.library.listRoot());
  await ctx.write(file, markdown);
  return { file, title: fields.title, medium: 'link', extract, imageCount, imageFailures };
}

/** data: 地址太长，不能进 chrome.storage.session（暂存队列、页面提示重放记录）。 */
export function tooLargeForSession(capture: Capture): boolean {
  const url = capture.media?.url ?? '';
  return isDataUrl(url) && url.length > DATA_URL_SESSION_LIMIT;
}

/**
 * 保存一个剪藏。返回 SaveOutcome；任何一步出错都返回 failed（带错误名和消息），不抛出。
 * snapshot 为 true 时跳过查重，另存一份新快照。
 */
export async function saveClip(request: PendingSave, deps: SaveDeps, options: SaveOptions = {}): Promise<SaveOutcome> {
  const lock = deps.lock ?? libraryLock;
  return lock(() => saveClipLocked(request, deps, options));
}

async function saveClipLocked(request: PendingSave, deps: SaveDeps, options: SaveOptions): Promise<SaveOutcome> {
  const { capture, snapshot } = request;
  let preview: Preview = {
    title: capture.title.trim() || capture.url,
    site: '',
    source: capture.url,
    medium: 'web',
  };
  // 本次保存写下的文件；中途出错时删掉，让重试从干净状态开始，不留下未登记的剪藏（codex review 第 3 轮）。
  const written: string[] = [];
  // 写之前就登记：写到一半失败时，已被创建的目标文件也会被清掉。本次的路径都是新的（新 id、唯一文件名）。
  let committed = false;
  const write = async (path: string, data: Blob | string) => {
    written.push(path);
    await deps.library.write(path, data);
  };

  try {
    preview = await previewOf(capture);
    const shape = shapeOf(capture);
    // 摘录的键带 `quote:` 前缀，与预览的 source（页面地址）不同；其余形态两者相同
    const key = shape.medium === 'quote' ? await indexKeyOf(capture) : preview.source;
    const progress = (p: SavingProgress) => deps.onProgress?.({ state: 'saving', preview, progress: p });

    // 2. 查已保存记录（摘录不查重：同一段文字再摘一次就再追加一条）
    if (!snapshot && shape.medium !== 'quote') {
      const previous = await deps.index.get(key);
      if (previous) return { state: 'duplicate', preview, previous };
    }

    // 3. 查剪藏库授权；未授权或未选剪藏库 → 暂存
    const permission = await deps.library.permission();
    if (permission !== 'granted') {
      // 太长的 data: 图片放不进 storage.session（ALAG-4 §3a）：不暂存，请用户授权后重新保存
      if (tooLargeForSession(capture)) {
        return {
          state: 'failed',
          preview,
          error: { name: 'DataUrlTooLarge', message: t('error_dataUrlTooLarge') },
        };
      }
      if (!options.fromPending) await deps.pending.push({ capture, snapshot });
      return { state: 'needs-permission', preview };
    }

    // 4. 写入
    const ctx: WriteCtx = {
      deps,
      id: deps.newId(),
      captured: deps.now(),
      write,
      progress,
      downloadImage: (url) => downloadImage(deps.fetch, url),
    };
    const title = preview.title;
    let result: ClipResult;

    if (shape.medium === 'quote') {
      // 摘录：追加或新建摘录文件；新建时提交摘录文件记录（覆盖旧记录），追加时记录不变
      const quote = await writeQuoteClip(ctx, capture, key, title);
      if (quote.record) await deps.index.put(key, quote.record);
      committed = true;
      // 提交成功后才登记幂等记录（codex review 第 4 轮）
      await quote.commitOp();
      return { state: 'saved', clip: quote.clip, tagSuggestions: await safeTagSuggestions(deps.index) };
    }

    if (shape.medium === 'web' || shape.medium === 'x') {
      result = await writeArticle(ctx, capture, title, shape.medium, shape.medium === 'x' ? shape.extract : 'full');
    } else if (shape.medium === 'stream') {
      result = await writeStreamClip(ctx, capture);
    } else if (shape.medium === 'media') {
      const media = await saveMediaClip(ctx, capture);
      if (media.kind === 'saved') result = media.result;
      else if (media.kind === 'stream') result = await writeStreamClip(ctx, media.capture);
      else {
        // 图片、PDF 超过 100MB：退回书签剪藏，标题用页面标题，出处记媒体地址（与已保存记录的键一致）
        result = await writeBookmark(
          ctx,
          { source: key, title, author: '', published: '', description: '', coverUrl: '' },
          'partial',
        );
      }
    } else {
      result = await writeBookmark(
        ctx,
        {
          source: canonicalizeUrl(capture.url),
          title,
          author: capture.author,
          published: capture.published,
          description: capture.description,
          coverUrl: capture.coverUrl,
        },
        shape.extract,
      );
    }

    const savedAt = ctx.captured.toISOString();
    const entry: SavedEntry = { id: ctx.id, file: result.file, title: result.title, medium: result.medium, source: key, savedAt, tags: [] };
    await deps.index.put(key, entry);
    // 已保存记录提交成功：此后任何异常都不得回滚文件，否则会留下指向空处的记录。
    committed = true;

    // 5. 结果
    const clip: ClipSummary = {
      id: ctx.id,
      file: result.file,
      title: result.title,
      medium: result.medium,
      site: result.site ?? preview.site,
      source: key,
      extract: result.extract,
      imageCount: result.imageCount,
      imageFailures: result.imageFailures,
      tags: [],
      note: '',
      savedAt,
      ...result.extra,
    };
    return {
      state: result.extract === 'fallback' ? 'fallback' : 'saved',
      clip,
      tagSuggestions: await safeTagSuggestions(deps.index),
    };
  } catch (err) {
    // 6. 任一步出错 → failed，带错误名与消息
    console.error('[Alayo Get] 保存失败', err);
    for (const path of committed ? [] : written.reverse()) {
      try {
        await deps.library.remove(path);
      } catch (cleanupErr) {
        console.warn('[Alayo Get] 清理未完成的保存失败', path, cleanupErr);
      }
    }
    return { state: 'failed', preview, error: errorInfo(err) };
  }
}

/**
 * 右键保存链接：service worker 抓目标页（10 秒超时），只解析 text/html 响应。
 * 抓取失败时只记 URL 和链接文字（fetched: false → extract: partial）。
 */
export async function captureLink(linkUrl: string, linkText: string, fetchFn: FetchLike): Promise<Capture> {
  const fallbackTitle = linkText.trim() || linkUrl;
  const partial: Capture = {
    url: linkUrl,
    title: fallbackTitle,
    site: '',
    author: '',
    published: '',
    description: '',
    coverUrl: '',
    markdown: null,
    textLength: 0,
    kind: 'link',
    fetched: false,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
  try {
    const res = await fetchFn(linkUrl, { signal: controller.signal });
    if (!res.ok) return partial;
    if (!(res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return partial;
    const html = await res.text();
    const meta = parseHtmlMeta(html, res.url || linkUrl);
    return {
      ...partial,
      title: meta.title || fallbackTitle,
      site: meta.siteName,
      author: meta.author,
      published: meta.published,
      description: meta.description,
      coverUrl: meta.image,
      fetched: true,
    };
  } catch (err) {
    console.warn('[Alayo Get] 抓取链接目标页失败，只记 URL 和链接文字', linkUrl, err);
    return partial;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 授权后补写：逐条保存暂存队列（取调用时的快照，不循环到队列空）。
 * 写完（saved / fallback / duplicate）从队列移除；failed 留在队列里等下次补写；
 * 补写中途又失去授权时停止，原条目留在队列里（不重新入队，避免满队列时挤掉别的条目）。
 * 每条结束都回调 onOutcome（用于更新角标）。
 */
export async function flushPending(deps: SaveDeps, onOutcome?: (outcome: SaveOutcome) => void): Promise<void> {
  if ((await deps.library.permission()) !== 'granted') return;
  const items = await deps.pending.list();
  for (const item of items) {
    const outcome = await saveClip(item, deps, { fromPending: true });
    if (outcome.state === 'saved' || outcome.state === 'fallback' || outcome.state === 'duplicate') {
      await deps.pending.remove(item);
    }
    onOutcome?.(outcome);
    if (outcome.state === 'needs-permission') break;
  }
}
