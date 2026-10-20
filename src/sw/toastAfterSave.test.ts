import { describe, expect, it, vi } from 'vitest';
import type { Capture, ClipSummary, SaveOutcome } from '@/shared/types';
import { createToastAfterSave } from './toastAfterSave';

const clip: ClipSummary = {
  id: '01JTOASTSAVE',
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
  savedAt: '2026-10-20T00:00:00.000Z',
};
const saved: SaveOutcome = { state: 'saved', clip, tagSuggestions: [] };
const duplicate: SaveOutcome = {
  state: 'duplicate',
  preview: { title: clip.title, site: clip.site, source: clip.source, medium: 'web' },
  previous: { id: 'OLD', file: '文章.md', title: clip.title, medium: 'web', source: clip.source, savedAt: '2026-10-01T00:00:00.000Z', tags: [] },
};
const capture: Capture = {
  url: clip.source,
  title: clip.title,
  site: '',
  author: '',
  published: '',
  description: '',
  coverUrl: '',
  markdown: '正文',
  textLength: 2,
  kind: 'page',
};

function makeDeps(hasTranslation: boolean, events: string[] = []) {
  const sendToast = vi.fn(async (...args: Parameters<Parameters<typeof createToastAfterSave>[0]['sendToast']>) => {
    events.push(`toast:${String(args[0])}:${args[1].state}`);
  });
  const showTranslationInTab = vi.fn((clipId: string, tabId: number) => {
    events.push(`translation:${clipId}:${tabId}`);
  });
  return { sendToast, hasTranslation: vi.fn(() => hasTranslation), showTranslationInTab, events };
}

describe('createToastAfterSave', () => {
  it('saved 且有翻译任务：先发保存提示，再 showTranslationInTab', async () => {
    const events: string[] = [];
    const deps = makeDeps(true, events);
    const toastAfterSave = createToastAfterSave(deps);
    await toastAfterSave(7, saved, capture);
    expect(deps.sendToast).toHaveBeenCalledWith(7, saved, capture);
    expect(deps.hasTranslation).toHaveBeenCalledWith(clip.id);
    expect(deps.showTranslationInTab).toHaveBeenCalledWith(clip.id, 7);
    expect(events).toEqual(['toast:7:saved', `translation:${clip.id}:7`]);
  });

  it('saved 但没有翻译任务：只发保存提示', async () => {
    const deps = makeDeps(false);
    await createToastAfterSave(deps)(7, saved, capture);
    expect(deps.sendToast).toHaveBeenCalledTimes(1);
    expect(deps.showTranslationInTab).not.toHaveBeenCalled();
  });

  it('非 saved 结果：即使有翻译任务也不接翻译行', async () => {
    const deps = makeDeps(true);
    await createToastAfterSave(deps)(7, duplicate, capture);
    expect(deps.sendToast).toHaveBeenCalledWith(7, duplicate, capture);
    expect(deps.hasTranslation).not.toHaveBeenCalled();
    expect(deps.showTranslationInTab).not.toHaveBeenCalled();
  });

  it('没有标签页 id：照旧发提示（sendToast 自己处理 undefined），不调 showTranslationInTab', async () => {
    const deps = makeDeps(true);
    await createToastAfterSave(deps)(undefined, saved);
    expect(deps.sendToast).toHaveBeenCalledWith(undefined, saved, undefined);
    expect(deps.showTranslationInTab).not.toHaveBeenCalled();
  });
});
