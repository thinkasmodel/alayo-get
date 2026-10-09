// 面板表单与新状态合并（ALAG-20 codex review 第 5 轮）：本地改动叠到新基线上，没改的字段取新值。
import { describe, expect, it } from 'vitest';
import { mergeIncoming, type FormFields } from './merge';

const base: FormFields = { title: '文章', tags: ['设计'], note: '旧批注 A' };
const incoming: FormFields = { title: '文章', tags: ['设计'], note: '恢复的批注 B' };

describe('mergeIncoming', () => {
  it('没有本地改动：合并结果等于新值，localEdits 为空', () => {
    expect(mergeIncoming(base, { ...base, tags: [...base.tags] }, incoming)).toEqual({ merged: incoming, localEdits: {} });
  });

  it('本地改了标签：标签取本地的，批注取新值', () => {
    const { merged, localEdits } = mergeIncoming(base, { ...base, tags: ['设计', '读书'] }, incoming);
    expect(merged).toEqual({ title: '文章', tags: ['设计', '读书'], note: '恢复的批注 B' });
    expect(localEdits).toEqual({ tags: ['设计', '读书'] });
  });

  it('本地改了批注：批注取本地的（用户的输入优先）', () => {
    const { merged, localEdits } = mergeIncoming(base, { ...base, note: '面板里新写的' }, incoming);
    expect(merged.note).toBe('面板里新写的');
    expect(localEdits).toEqual({ note: '面板里新写的' });
  });

  it('没有上一基线（首次进入）或没有本地表单：不叠加', () => {
    const local: FormFields = { ...base, tags: ['别的'] };
    expect(mergeIncoming(null, local, incoming)).toEqual({ merged: incoming, localEdits: {} });
    expect(mergeIncoming(base, null, incoming)).toEqual({ merged: incoming, localEdits: {} });
  });

  it('不改动传入的对象', () => {
    const local: FormFields = { ...base, tags: ['设计', '读书'] };
    const snapshot = structuredClone({ base, local, incoming });
    mergeIncoming(base, local, incoming);
    expect({ base, local, incoming }).toEqual(snapshot);
  });
});
