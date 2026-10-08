// 面板表单与 service worker 推来的新状态合并（ALAG-20 codex review 第 5 轮）。纯函数，node 环境测试。
import { changedFields } from '@/core/editFields';
import type { EditFields } from '@/shared/types';

export type FormFields = Required<EditFields>;

/**
 * 新 state 到达时：用户相对上一基线改过的字段叠到新 clip 上；返回合并后的表单值与是否有本地改动。
 * 没有上一基线或本地表单时不叠加（首次进入编辑态）。
 */
export function mergeIncoming(prevBaseline: FormFields | null, local: FormFields | null, incoming: FormFields): { merged: FormFields; localEdits: EditFields } {
  const localEdits = prevBaseline && local ? changedFields(prevBaseline, local) : {};
  return { merged: { ...incoming, ...localEdits }, localEdits };
}
