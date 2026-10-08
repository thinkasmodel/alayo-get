// 面板或页面提示的修改写回：改 frontmatter 对应行；改了标题就同步正文标题行并改文件名（不用 move()，先写新文件再删旧文件）。
import { updateDisplayedTitle } from '@/core/document';
import { clipBaseName, sameFileName, uniqueFileName } from '@/core/filename';
import { readEditableFields, updateFrontmatter } from '@/core/frontmatter';
import { isMediaKind, mediaMetaPath, parseMediaMeta, serializeMediaMeta } from '@/core/media';
import { replaceQuoteNote } from '@/core/quote';
import type { Library } from '@/io/library';
import type { SavedIndex } from '@/io/savedIndex';
import { t } from '@/shared/i18n';
import type { ClipSummary, EditFields } from '@/shared/types';
import { libraryLock, type Lock } from './lock';

/** applyEdits 需要的剪藏信息。media、medium 用来认出媒体剪藏，quote 用来认出摘录剪藏的一条（ALAG-4）。 */
export type ClipRef = Pick<ClipSummary, 'id' | 'file' | 'source' | 'title' | 'tags' | 'note'> & Partial<Pick<ClipSummary, 'media' | 'medium' | 'quote'>>;

/**
 * 媒体剪藏：带 media，或 medium 是媒体类别且文件不是 `.md`
 * （video、audio 也可能是流媒体剪藏，那是 `.md`；service worker 重启后重建的剪藏信息里可能没有 media）。
 */
export function isMediaClip(clip: Pick<ClipRef, 'file' | 'media' | 'medium'>): boolean {
  if (clip.media) return true;
  return isMediaKind(clip.medium) && !/\.md$/i.test(clip.file);
}

/** 文件不是这条剪藏时拒绝修改的错误（name 为 ClipMismatchError）；进入编辑态前的核对也用它（ALAG-20）。 */
export function mismatch(message: string): Error {
  const err = new Error(message);
  err.name = 'ClipMismatchError';
  return err;
}

export interface EditDeps {
  library: Library;
  index: SavedIndex;
  /** 剪藏库互斥，缺省用 service worker 共用的 libraryLock（与 saveClip 同一把）。 */
  lock?: Lock;
}

/** 读出 frontmatter 里 id 那一行的值；没有返回 null。摘录剪藏追加前核对文件也用它（ALAG-4）。 */
export function frontmatterId(md: string): string | null {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1];
  const raw = block ? /^id: (.*)$/m.exec(block)?.[1] : undefined;
  if (raw === undefined) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' ? value : null;
  } catch {
    return raw.trim();
  }
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

/**
 * 文件已是目标内容时，补齐已保存记录：上一次写回可能文件写成功、提交记录失败，重试时文件已无改动，
 * 不补就永远停在旧值（codex review 合并前复审）。记录已被更新的快照覆盖时不动；提交失败照常抛出。
 */
async function reconcileIndex(clip: ClipRef, actual: ClipRef, index: SavedIndex): Promise<void> {
  const entry = await index.get(clip.source);
  if (entry?.id !== clip.id) return;
  if (entry.file === clip.file && entry.title === actual.title && sameTags(entry.tags, actual.tags)) return;
  await index.updateById(clip.source, clip.id, { file: clip.file, title: actual.title, tags: actual.tags });
}

/** 只留下与已存内容不同的字段。 */
export function changedFields(clip: ClipRef, fields: EditFields): EditFields {
  const changes: EditFields = {};
  if (fields.title !== undefined && fields.title !== clip.title) changes.title = fields.title;
  if (fields.tags !== undefined && !sameTags(fields.tags, clip.tags)) changes.tags = [...fields.tags];
  if (fields.note !== undefined && fields.note !== clip.note) changes.note = fields.note;
  return changes;
}

export function hasChanges(clip: ClipRef, fields: EditFields): boolean {
  return Object.keys(changedFields(clip, fields)).length > 0;
}

/**
 * 把修改写回剪藏文件。字段没有变化时不写文件；只在已保存记录与文件不一致时补齐记录。
 * 改标题时：新文件名与当前文件名（不分大小写）相同就原地写；否则先写新文件名，成功后删旧文件，并更新已保存记录的 file。
 * 改标题时，正文里显示标题的那一行（`# 标题` / `[标题](出处)`）仍是当初生成的样子才同步改，用户改过的不动。
 * 改名顺序：写新文件 → 提交已保存记录 → 删旧文件。记录提交失败时旧文件还在；删旧文件失败只记日志。
 */
export async function applyEdits<T extends ClipRef>(clip: T, fields: EditFields, deps: EditDeps): Promise<T> {
  const lock = deps.lock ?? libraryLock;
  return lock(() => applyEditsLocked(clip, fields, deps));
}

/**
 * 媒体剪藏的修改（ALAG-4）：媒体文件本身不动、不改名；读 `.meta/<id>.json`、核对 id，只改 tags、note（忽略 title），
 * 写回侧档；已保存记录只更新 tags。
 */
async function applyMediaEditsLocked<T extends ClipRef>(clip: T, fields: EditFields, deps: EditDeps): Promise<T> {
  // 媒体文件本身被移走时不算写成：只改侧档会让写回“成功”、草稿被清掉（codex review ALAG-20 第 3 轮）
  if (!(await deps.library.exists(clip.file))) {
    const err = new Error(t('error_clipNotFound'));
    err.name = 'NotFoundError';
    throw err;
  }
  const path = mediaMetaPath(clip.id);
  const meta = parseMediaMeta(await deps.library.readText(path));
  if (meta.id !== clip.id) throw mismatch(t('error_sidecarMismatch', [path, clip.id, meta.id || t('error_idNone')]));
  // 以侧档里实际的值为准判断有没有改动
  const actual: T = { ...clip, tags: meta.tags, note: meta.note };
  // 媒体剪藏不改标题：面板照常发三个字段，title 忽略
  const editable: EditFields = {};
  if (fields.tags !== undefined) editable.tags = fields.tags;
  if (fields.note !== undefined) editable.note = fields.note;
  const changes = changedFields(actual, editable);
  if (Object.keys(changes).length === 0) {
    const entry = await deps.index.get(clip.source);
    if (entry?.id === clip.id && !sameTags(entry.tags, actual.tags)) await deps.index.updateById(clip.source, clip.id, { tags: actual.tags });
    return sameTags(clip.tags, actual.tags) && clip.note === actual.note ? clip : actual;
  }
  const next: T = { ...actual, ...changes };
  await deps.library.write(path, serializeMediaMeta({ ...meta, tags: next.tags, note: next.note }));
  await deps.index.updateById(clip.source, clip.id, { tags: next.tags });
  return next;
}

/**
 * 摘录剪藏一条的批注（ALAG-4 brief B §6）：只处理 note，title、tags 忽略（frontmatter 不动）。
 * 核对文件 frontmatter id 等于 quote.fileId，按 anchor 行定位这一条，改写它下面的批注区后整文件写回；已保存记录不变。
 * 文件已是目标内容时不写。
 */
async function applyQuoteEditsLocked<T extends ClipRef>(clip: T, fields: EditFields, deps: EditDeps): Promise<T> {
  const quote = clip.quote;
  if (!quote || fields.note === undefined) return clip;
  const md = await deps.library.readText(clip.file);
  const fileId = frontmatterId(md);
  if (fileId !== quote.fileId) throw mismatch(t('error_quoteFileMismatch', [clip.file, quote.fileId, fileId ?? t('error_idNone')]));
  const updated = replaceQuoteNote(md, quote.anchor, fields.note);
  if (updated !== md) await deps.library.write(clip.file, updated);
  return clip.note === fields.note ? clip : { ...clip, note: fields.note };
}

async function applyEditsLocked<T extends ClipRef>(clip: T, fields: EditFields, deps: EditDeps): Promise<T> {
  if (Object.keys(fields).length === 0) return clip;
  if (clip.quote) return applyQuoteEditsLocked(clip, fields, deps);
  if (isMediaClip(clip)) return applyMediaEditsLocked(clip, fields, deps);

  const md = await deps.library.readText(clip.file);
  // 只改属于这条剪藏的文件：文件里的 id 必须与剪藏一致（剪藏库被更换、同名文件被替换时拒绝修改）。
  const fileId = frontmatterId(md);
  if (fileId !== clip.id) throw mismatch(t('error_clipFileMismatch', [clip.file, clip.id, fileId ?? t('error_idNone')]));
  // 以文件里实际的值为准判断有没有改动：缓存的剪藏信息可能落后于文件（部分写入失败、后台重启后的缺省值）。
  const fileFields = readEditableFields(md);
  const actual: T = { ...clip, ...fileFields };
  const changes = changedFields(actual, fields);
  // 没有改动：缓存与文件一致就原样返回，否则返回按文件刷新后的剪藏信息
  if (Object.keys(changes).length === 0) {
    await reconcileIndex(clip, actual, deps.index);
    return hasChanges(clip, fileFields) ? actual : clip;
  }
  let updated = updateFrontmatter(md, changes);
  if (changes.title !== undefined) {
    updated = updateDisplayedTitle(updated, actual.title, changes.title, clip.source);
  }

  let file = clip.file;
  if (changes.title !== undefined) {
    const base = clipBaseName(changes.title);
    if (!sameFileName(`${base}.md`, clip.file)) {
      const others = (await deps.library.listRoot()).filter((name) => !sameFileName(name, clip.file));
      const candidate = uniqueFileName(base, others);
      if (!sameFileName(candidate, clip.file)) file = candidate;
    }
  }

  await deps.library.write(file, updated);

  const next: T = { ...actual, ...changes, file };
  try {
    await deps.index.updateById(clip.source, clip.id, { file, title: next.title, tags: next.tags });
  } catch (err) {
    // 记录没提交成功：删掉本次新写的文件，旧文件原样保留，重试不会留下同 id 的副本（codex review 第 5 轮）。
    if (file !== clip.file) {
      await deps.library.remove(file).catch((cleanupErr) => console.warn('[Alayo Get] 清理改名新文件失败', file, cleanupErr));
    }
    throw err;
  }

  if (file !== clip.file) {
    try {
      await deps.library.remove(clip.file);
    } catch (err) {
      console.warn('[Alayo Get] 改名后删除旧文件失败，旧文件留在剪藏库里', clip.file, err);
    }
  }
  return next;
}
