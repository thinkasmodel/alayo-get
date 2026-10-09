// 批注草稿文件（ALAG-20）：面板关闭时写回失败的修改，用户点「存为草稿文件」后写进剪藏库根目录。
// 纯函数，node 环境测试。草稿文件没有 frontmatter，不是剪藏、不登记进已保存记录。
import { t } from '@/shared/i18n';
import type { LostEdit } from '@/shared/types';
import { linkDestination } from './document';
import { uniqueFileName } from './filename';
import { quoteTimestamp } from './quote';

/**
 * 写回失败的原因分类：文件不在（missing）、原路径已是另一个文件（replaced）、
 * 摘录文件里找不到这一条（entry-missing）、其他错误（other）。
 */
export function lostEditReason(error: { name: string }): 'missing' | 'replaced' | 'entry-missing' | 'other' {
  if (error.name === 'NotFoundError') return 'missing';
  if (error.name === 'ClipMismatchError') return 'replaced';
  if (error.name === 'QuoteEntryNotFound') return 'entry-missing';
  return 'other';
}

/** 去掉文件名最后一个扩展名：`摘录 - 慢思考.md` → `摘录 - 慢思考`，`x.pdf` → `x`；没有扩展名原样返回。 */
export function lostEditFileStem(file: string): string {
  return file.replace(/(?<=.)\.[^./]+$/, '');
}

/** 草稿文件名 `批注草稿 - <原文件名去扩展名>.md`；与剪藏库根目录已有文件重名时加 ` (2)`、` (3)`……。 */
export function lostEditFileName(edit: LostEdit, existing: Iterable<string>): string {
  return uniqueFileName(`${t('file_noteDraft')} - ${lostEditFileStem(edit.clip.file)}`, existing);
}

function reasonText(edit: LostEdit): string {
  switch (lostEditReason(edit.error)) {
    case 'missing':
      return t('file_noteDraftReasonMissing');
    case 'replaced':
      return t('file_noteDraftReasonReplaced');
    case 'entry-missing':
      return t('file_noteDraftReasonEntryMissing');
    case 'other':
      return edit.error.name;
  }
}

/** 一段：标题行下面紧接内容；内容为空（如清空了批注）时只有标题行。 */
function section(heading: string, value: string): string {
  return value === '' ? `## ${heading}` : `## ${heading}\n${value}`;
}

/**
 * 草稿文件的 Markdown：标题、说明（何时、哪个文件、为什么没写进去）、原文链接，然后只列改过的字段
 * （标题 / 标签 / 批注，按这个顺序）。摘录剪藏的批注前先写一行「第 N 条」。段落之间空一行，以单个换行结尾。
 */
export function buildLostEditFile(edit: LostEdit): string {
  const { clip, fields } = edit;
  const parts: string[] = [
    `# ${t('file_noteDraft')} - ${lostEditFileStem(clip.file)}`,
    t('file_noteDraftIntro', [quoteTimestamp(edit.at), clip.file, reasonText(edit)]),
    `[${t('file_source')}](${linkDestination(clip.source)})`,
  ];
  if (fields.title !== undefined) parts.push(section(t('panel_title'), fields.title));
  if (fields.tags !== undefined) parts.push(section(t('panel_tags'), fields.tags.join(t('panel_tagJoin'))));
  if (fields.note !== undefined) {
    const note = clip.quote ? [t('file_noteDraftQuoteEntry', String(clip.quote.entry)), fields.note].filter((s) => s !== '').join('\n\n') : fields.note;
    parts.push(section(t('ui_note'), note));
  }
  return parts.join('\n\n').replace(/\s+$/, '') + '\n';
}
