// 摘录剪藏的写法（ALAG-4 brief B §5）：同一页面的摘录追加进同一个 `摘录 - 页面标题.md`。
// 加锁、暂存、清理新建文件、提交已保存记录仍由 saveClipLocked 管；这里只决定追加还是新建、拼出文件内容。
import { frontmatterId } from './applyEdits';
import type { WriteCtx } from './saveClip';
import { canonicalizeUrl } from '@/core/canonical';
import { clipBaseName, sameFileName, uniqueFileName } from '@/core/filename';
import { siteFromUrl } from '@/core/frontmatter';
import { createQuoteOps } from '@/io/quoteOps';
import { appendQuoteEntry, buildQuoteFile, countQuoteEntries, quoteAnchor, quoteEntryText } from '@/core/quote';
import { t } from '@/shared/i18n';
import type { Capture, ClipSummary, SavedEntry } from '@/shared/types';

/** 摘录文件记录在已保存记录里的键前缀：`quote:` + 规范化页面地址（页面保存的查重键不带前缀，两者不冲突）。 */
export const QUOTE_KEY_PREFIX = 'quote:';

export function quoteIndexKey(pageUrl: string): string {
  return `${QUOTE_KEY_PREFIX}${canonicalizeUrl(pageUrl)}`;
}

export interface QuoteWriteResult {
  clip: ClipSummary;
  /** 新建文件时要写的摘录文件记录；追加时为 null（记录不变）。 */
  record: SavedEntry | null;
  /**
   * 登记幂等记录（opId → clip）。必须在已保存记录提交成功之后由 saveClipLocked 调用：
   * 先登记的话，提交失败、新文件被回滚后，重试会命中登记直接报“已保存”，文件和记录却都是空的（codex review 第 4 轮）。
   */
  commitOp: () => Promise<void>;
}

/**
 * 写一条摘录。读 `quote:<地址>` 的记录：记录存在、剪藏库根目录里有这个文件、且文件 frontmatter 的 id 等于记录 id → 追加；
 * 否则新建（记录存在但文件不在或 id 不符时 recreated）。新建经 ctx.write 写（出错时由 saveClipLocked 删掉）；
 * 追加直接写回原文件，不登记清理（写失败时原内容不变，也不能被清理删掉）。
 */
export async function writeQuoteClip(ctx: WriteCtx, capture: Capture, key: string, title: string): Promise<QuoteWriteResult> {
  const quote = capture.quote;
  if (!quote) throw new Error(t('error_quoteInfoMissing'));
  const { library, index } = ctx.deps;
  const source = canonicalizeUrl(capture.url);
  const link = quote.fragmentUrl ?? capture.url;
  const fragment = quote.fragmentUrl !== null;

  // 暂存补写的幂等：同一个 opId 已经落盘过（如落盘后出队失败），不读不写文件，直接返回当时那一条
  const quoteOps = ctx.deps.quoteOps ?? createQuoteOps();
  const opId = quote.opId;
  if (opId !== undefined) {
    const done = await quoteOps.get(opId);
    if (done) return { clip: done, record: null, commitOp: async () => undefined };
  }
  // 由 saveClipLocked 在提交成功后调用；记表失败只打日志，不让本次保存失败
  const remember = (result: Omit<QuoteWriteResult, 'commitOp'>): QuoteWriteResult => ({
    ...result,
    commitOp: async () => {
      if (opId !== undefined) await quoteOps.put(opId, result.clip).catch((err: unknown) => console.warn('[Alayo Get] 记录摘录操作失败', err));
    },
  });

  const previous = await index.get(key);
  const names = await library.listRoot();
  let existing: { file: string; md: string; id: string } | null = null;
  if (previous) {
    const file = names.find((name) => sameFileName(name, previous.file));
    if (file !== undefined) {
      const md = await library.readText(file);
      if (frontmatterId(md) === previous.id) existing = { file, md, id: previous.id };
    }
  }

  ctx.progress({ phase: 'write' });
  const summary = (file: string, fileId: string, entry: number, anchor: string, recreated: boolean): ClipSummary => ({
    id: ctx.id,
    file,
    title,
    medium: 'quote',
    site: siteFromUrl(source),
    source,
    extract: 'full',
    imageCount: 0,
    imageFailures: 0,
    tags: [],
    note: '',
    savedAt: quote.selectedAt,
    quote: { fileId, entry, anchor, fragment, recreated },
  });

  if (existing) {
    const anchor = quoteAnchor(quote.selectedAt, link, existing.md);
    const next = appendQuoteEntry(existing.md, quoteEntryText(quote.markdown, anchor));
    await library.write(existing.file, next);
    return remember({ clip: summary(existing.file, existing.id, countQuoteEntries(next), anchor, false), record: null });
  }

  const fileId = ctx.deps.newId();
  const anchor = quoteAnchor(quote.selectedAt, link, '');
  const md = buildQuoteFile({ id: fileId, source, title, captured: new Date(quote.selectedAt), firstEntry: quoteEntryText(quote.markdown, anchor) });
  const file = uniqueFileName(clipBaseName(t('file_quotesTitle', title)), names);
  await ctx.write(file, md);
  const record: SavedEntry = { id: fileId, file, title, medium: 'quote', source, savedAt: quote.selectedAt, tags: [] };
  return remember({ clip: summary(file, fileId, countQuoteEntries(md), anchor, previous !== undefined), record });
}
