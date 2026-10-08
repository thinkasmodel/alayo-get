// 最近保存的剪藏：按 id 找回（页面提示写批注、面板断线重连）并写回修改。原在 background.ts，
// 摘录剪藏（ALAG-4）要多查一层 storage.session 的摘录记录，抽到这里以便在 node 环境里测试。
import { readEditableFields, siteFromUrl } from '@/core/frontmatter';
import { isMediaKind, mediaMetaPath, parseMediaMeta } from '@/core/media';
import { readQuoteNote } from '@/core/quote';
import type { Library } from '@/io/library';
import type { QuoteEntries } from '@/io/quoteEntries';
import type { QuoteOps } from '@/io/quoteOps';
import type { SavedIndex } from '@/io/savedIndex';
import type { ClipSummary, EditFields } from '@/shared/types';
import { applyEdits, frontmatterId, isMediaClip } from './applyEdits';
import type { Lock } from './lock';

export const RECENT_LIMIT = 50;

export interface ClipBookDeps {
  index: SavedIndex;
  /** 每条摘录的记录（storage.session）。 */
  quotes: QuoteEntries;
  /** 已落盘的摘录操作（storage.local）；摘录记录缺失时（会话写入失败）按摘录 id 从这里找回。 */
  quoteOps?: QuoteOps;
  /** 找不到剪藏当初所在的库时用的剪藏库（生产为 pinnedLibrary）。 */
  library: () => Library;
  /** 剪藏库互斥，缺省用 service worker 共用的 libraryLock。 */
  lock?: Lock;
}

export interface ClipBook {
  /** 记住一条剪藏和它所在的剪藏库；摘录还写进 storage.session 的摘录记录。 */
  remember(clip: ClipSummary, library: Library): Promise<void>;
  /** 按 id 找回：先查内存，再查摘录记录，再查已保存记录；按文件里的实际内容刷新（摘录除外）。 */
  findClip(clipId: string): Promise<ClipSummary | undefined>;
  /** 把修改写回这条剪藏当初所在的库，并记住修改后的剪藏信息。 */
  editClip(clip: ClipSummary, fields: EditFields): Promise<ClipSummary>;
}

export function createClipBook(deps: ClipBookDeps): ClipBook {
  /** 最近保存的剪藏和它所在的剪藏库（页面提示写批注、面板关闭写回时按 id 找回）。 */
  const recent = new Map<string, { clip: ClipSummary; library: Library }>();

  const remember = async (clip: ClipSummary, library: Library): Promise<void> => {
    recent.delete(clip.id);
    recent.set(clip.id, { clip, library });
    while (recent.size > RECENT_LIMIT) {
      const oldest = recent.keys().next().value;
      if (oldest === undefined) break;
      recent.delete(oldest);
    }
    // 摘录：后台被终止后写批注还要找回 anchor 和这一条当前的批注
    if (clip.quote) await deps.quotes.put(clip);
  };

  /**
   * 用文件里实际的标题、标签、批注刷新剪藏信息；读不到文件时原样返回。
   * 媒体剪藏不读媒体文件，读 `.meta/<id>.json` 取标签、批注、大小（ALAG-4）。
   * 摘录不展开 frontmatter：摘录文件的 note 永远是空串，展开会把这一条的批注覆盖成空（ALAG-4 brief B §4）；
   * 摘录的批注以文件里这一条 anchor 之后的批注区为准（记录可能比文件旧，如文件写成功、会话写失败）。
   */
  const withFileFields = async (clip: ClipSummary, library: Library): Promise<ClipSummary> => {
    if (clip.quote) return withQuoteNote(clip, library);
    try {
      if (isMediaClip(clip)) {
        const meta = parseMediaMeta(await library.readText(mediaMetaPath(clip.id)));
        if (meta.id !== clip.id) return clip;
        return {
          ...clip,
          tags: meta.tags,
          note: meta.note,
          site: meta.site || clip.site,
          media: { kind: clip.media?.kind ?? meta.medium, bytes: meta.bytes },
        };
      }
      return { ...clip, ...readEditableFields(await library.readText(clip.file)) };
    } catch (err) {
      console.debug('[Alayo Get] 读取剪藏文件失败，沿用缓存的剪藏信息', clip.file, err);
      return clip;
    }
  };

  /** 摘录：读摘录文件，id 与记录一致且 anchor 唯一时用文件里的批注覆盖；读失败、id 不符、找不到 anchor 时沿用记录。 */
  const withQuoteNote = async (clip: ClipSummary, library: Library): Promise<ClipSummary> => {
    const quote = clip.quote;
    if (!quote) return clip;
    try {
      const md = await library.readText(clip.file);
      if (frontmatterId(md) !== quote.fileId) return clip;
      const note = readQuoteNote(md, quote.anchor);
      return note === null ? clip : { ...clip, note };
    } catch (err) {
      console.debug('[Alayo Get] 读取摘录文件失败，沿用记录里的批注', clip.file, err);
      return clip;
    }
  };

  const findClip = async (clipId: string): Promise<ClipSummary | undefined> => {
    const hit = recent.get(clipId);
    if (hit) return withFileFields(hit.clip, hit.library);
    // 摘录：后台重启后从 storage.session 的摘录记录找回（批注以记录里这一条的值为准）
    const quote = await deps.quotes.get(clipId).catch((err: unknown) => {
      console.warn('[Alayo Get] 读取摘录记录失败', err);
      return undefined;
    });
    if (quote) return withQuoteNote(quote, deps.library());
    // 摘录记录缺失（首次写 storage.session 失败）：从已落盘的摘录操作里按摘录 id 找回（codex review 第 5 轮）
    const applied = await deps.quoteOps?.findByClipId(clipId).catch((err: unknown) => {
      console.warn('[Alayo Get] 读取摘录操作记录失败', err);
      return undefined;
    });
    if (applied) return withQuoteNote(applied, deps.library());
    // service worker 重启后内存记录没了，从已保存记录里找回，再按文件里的实际内容刷新（codex review 加审轮）。
    const entry = Object.values(await deps.index.all()).find((e) => e.id === clipId);
    if (!entry) return undefined;
    // 媒体剪藏：medium 是媒体类别、文件不是 .md（video、audio 也可能是流媒体剪藏的 .md）
    const media = isMediaKind(entry.medium) && !/\.md$/i.test(entry.file) ? { media: { kind: entry.medium, bytes: 0 } } : {};
    return withFileFields(
      {
        ...entry,
        site: siteFromUrl(entry.source),
        // 已保存记录里没有抽取状态：文章剪藏（web、x）按 full，书签按 fallback；X 剪藏的部分保存提示在这里会丢
        extract: entry.medium === 'link' ? 'fallback' : 'full',
        imageCount: 0,
        imageFailures: 0,
        note: '',
        ...media,
      },
      deps.library(),
    );
  };

  const editClip = async (clip: ClipSummary, fields: EditFields): Promise<ClipSummary> => {
    // 写回到这条剪藏当初所在的库；applyEdits 还会核对文件 id，不是这条剪藏就拒绝修改
    const library = recent.get(clip.id)?.library ?? deps.library();
    const next = await applyEdits(clip, fields, { library, index: deps.index, lock: deps.lock });
    // 摘录：这一条的批注同步写进摘录记录（下一次 findClip 以它判断有没有改动）
    await remember(next, library);
    return next;
  };

  return { remember, findClip, editClip };
}
