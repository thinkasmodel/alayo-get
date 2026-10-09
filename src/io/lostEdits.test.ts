// 写回失败留下的草稿（ALAG-20）：顺序、原位更新、删除、封顶 10 条、并发不互相覆盖。
import { describe, expect, it } from 'vitest';
import type { ClipSummary, LostEdit } from '@/shared/types';
import { createLostEdits, LOST_EDITS_KEY, LOST_EDITS_LIMIT } from './lostEdits';

/** 复制语义的内存 storage.local：读写都深拷贝，每次调用先让出一轮宏任务，使并发操作真正交错。 */
function memoryArea() {
  const data = new Map<string, unknown>();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const area = {
    get: async (key?: string | string[] | Record<string, unknown> | null) => {
      await tick();
      const k = key as string;
      return data.has(k) ? { [k]: structuredClone(data.get(k)) } : {};
    },
    set: async (items: Record<string, unknown>) => {
      await tick();
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
    },
  };
  return { area: area as unknown as Parameters<typeof createLostEdits>[0], data };
}

const clip: ClipSummary = {
  id: '01JLOST',
  file: '文章.md',
  title: '文章',
  medium: 'web',
  site: 'example.com',
  source: 'https://example.com/a',
  extract: 'full',
  imageCount: 0,
  imageFailures: 0,
  tags: [],
  note: '',
  savedAt: '2026-10-08T00:00:00.000Z',
};

const edit = (id: string, note = id): LostEdit => ({
  id,
  clip,
  fields: { note },
  error: { name: 'NotFoundError', message: 'gone' },
  at: `2026-10-08T00:00:${id.padStart(2, '0')}.000Z`,
});

describe('写回失败的草稿（storage.local）', () => {
  it('add 后 list 按插入顺序；存在 lostEdits 键下', async () => {
    const { area, data } = memoryArea();
    const store = createLostEdits(area);
    await store.add(edit('1'));
    await store.add(edit('2'));
    expect((await store.list()).map((e) => e.id)).toEqual(['1', '2']);
    expect((data.get(LOST_EDITS_KEY) as LostEdit[]).map((e) => e.id)).toEqual(['1', '2']);
  });

  it('空存储 list 为空数组', async () => {
    expect(await createLostEdits(memoryArea().area).list()).toEqual([]);
  });

  it('update 按 id 原位替换；没有这条（已删掉）时不做任何事，不复活', async () => {
    const store = createLostEdits(memoryArea().area);
    await store.add(edit('1'));
    await store.add(edit('2'));
    await store.add(edit('3'));
    await store.update({ ...edit('2'), error: { name: 'NotAllowedError', message: 'denied' } });
    const list = await store.list();
    expect(list.map((e) => e.id)).toEqual(['1', '2', '3']);
    expect(list[1]?.error.name).toBe('NotAllowedError');
    await store.update(edit('4'));
    expect((await store.list()).map((e) => e.id)).toEqual(['1', '2', '3']);
    await store.remove('1');
    await store.update({ ...edit('1'), error: { name: 'NotAllowedError', message: 'late' } });
    expect((await store.list()).map((e) => e.id)).toEqual(['2', '3']);
  });

  it('remove 删掉这一条，其余不动；不存在的 id 不报错', async () => {
    const store = createLostEdits(memoryArea().area);
    await store.add(edit('1'));
    await store.add(edit('2'));
    await store.remove('1');
    await store.remove('nope');
    expect((await store.list()).map((e) => e.id)).toEqual(['2']);
  });

  it(`第 ${LOST_EDITS_LIMIT + 1} 条丢最早的`, async () => {
    const store = createLostEdits(memoryArea().area);
    for (let i = 1; i <= LOST_EDITS_LIMIT + 1; i++) await store.add(edit(String(i)));
    const ids = (await store.list()).map((e) => e.id);
    expect(ids).toHaveLength(LOST_EDITS_LIMIT);
    expect(ids[0]).toBe('2');
    expect(ids.at(-1)).toBe(String(LOST_EDITS_LIMIT + 1));
  });

  it('并发 add 不互相覆盖', async () => {
    const store = createLostEdits(memoryArea().area);
    await Promise.all([store.add(edit('1')), store.add(edit('2')), store.add(edit('3'))]);
    expect((await store.list()).map((e) => e.id)).toEqual(['1', '2', '3']);
  });
});
