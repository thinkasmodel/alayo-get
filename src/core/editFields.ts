// 可改字段（标题、标签、批注）的比较（纯函数）。写回（src/sw/applyEdits.ts）与面板表单合并（src/ui/panel/merge.ts）共用（ALAG-20）。
import type { EditFields } from '@/shared/types';

/** 比较的基准：剪藏信息或面板表单里的三个字段。 */
export type FieldsBase = { title: string; tags: string[]; note: string };

/** 面板表单的三个字段（全量）。面板合并（src/ui/panel/merge.ts）与 service worker 的基线登记共用。 */
export type FormFields = Required<EditFields>;

/** 剪藏信息里的三个字段（复制标签数组）。 */
export function fieldsOf(clip: FieldsBase): FormFields {
  return { title: clip.title, tags: [...clip.tags], note: clip.note };
}

/** 两组标签是否相同（顺序也要相同）。 */
export function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

/** 只留下与已存内容不同的字段。 */
export function changedFields(clip: FieldsBase, fields: EditFields): EditFields {
  const changes: EditFields = {};
  if (fields.title !== undefined && fields.title !== clip.title) changes.title = fields.title;
  if (fields.tags !== undefined && !sameTags(fields.tags, clip.tags)) changes.tags = [...fields.tags];
  if (fields.note !== undefined && fields.note !== clip.note) changes.note = fields.note;
  return changes;
}

export function hasChanges(clip: FieldsBase, fields: EditFields): boolean {
  return Object.keys(changedFields(clip, fields)).length > 0;
}
