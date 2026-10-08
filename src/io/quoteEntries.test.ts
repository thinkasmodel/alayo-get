import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ClipSummary } from '@/shared/types';
import { createQuoteEntries, QUOTE_ENTRIES_LIMIT } from './quoteEntries';

const entry = (id: string, note = ''): ClipSummary => ({
  id,
  file: '摘录 - 页面.md',
  title: '页面',
  medium: 'quote',
  site: 'example.com',
  source: 'https://example.com/',
  extract: 'full',
  imageCount: 0,
  imageFailures: 0,
  tags: [],
  note,
  savedAt: '2026-10-07T08:31:00.000Z',
  quote: { fileId: 'F', entry: 1, anchor: `2026-10-07 16:31 · [跳回原文](https://example.com/#${id})`, fragment: true, recreated: false },
});

beforeEach(() => fakeBrowser.reset());

describe('每条摘录的记录', () => {
  it('新建一个实例（模拟后台重启）后仍能按摘录 id 取回；再写同一 id 覆盖批注', async () => {
    await createQuoteEntries().put(entry('q1'));
    expect((await createQuoteEntries().get('q1'))?.quote?.anchor).toContain('#q1');
    await createQuoteEntries().put(entry('q1', 'abc'));
    expect((await createQuoteEntries().get('q1'))?.note).toBe('abc');
  });

  it(`最多保留 ${QUOTE_ENTRIES_LIMIT} 条，超出丢最早的`, async () => {
    const store = createQuoteEntries();
    for (let i = 0; i <= QUOTE_ENTRIES_LIMIT; i++) await store.put(entry(`q${i}`));
    expect(await store.get('q0')).toBeUndefined();
    expect((await store.get(`q${QUOTE_ENTRIES_LIMIT}`))?.id).toBe(`q${QUOTE_ENTRIES_LIMIT}`);
  });
});
