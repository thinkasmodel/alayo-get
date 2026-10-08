// 摘录剪藏跨语言保存（ALAG-7 brief A §5、§8）：文件名前缀取保存时的语言；换语言后同一页面的新摘录追加进原文件，旧条目照常改批注。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useLocale } from '../../tests/setup/i18n';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createPendingQueue } from '@/io/pending';
import { createSavedIndex, type SavedIndex } from '@/io/savedIndex';
import type { Capture, ClipSummary, SaveOutcome } from '@/shared/types';
import { applyEdits } from './applyEdits';
import { quoteCapture } from './route';
import { saveClip, type SaveDeps } from './saveClip';

vi.stubEnv('TZ', 'Asia/Shanghai');

const PAGE = 'https://example.com/thinking-fast-and-slow';
const TITLE = 'Thinking, Fast and Slow notes';
const T1 = '2026-10-07T08:31:00.000Z';
const T2 = '2026-10-07T08:35:00.000Z';
const T3 = '2026-10-07T08:40:00.000Z';

let library: MemoryLibrary;
let index: SavedIndex;
let ids: string[];

function makeDeps(): SaveDeps {
  return {
    library,
    index,
    pending: createPendingQueue(),
    fetch: async () => {
      throw new Error('摘录不该发请求');
    },
    now: () => new Date('2026-10-08T01:00:00.000Z'),
    newId: () => {
      const id = ids.shift();
      if (!id) throw new Error('测试 id 用完了');
      return id;
    },
  };
}

const capture = (markdown: string, selectedAt: string): Capture =>
  quoteCapture(PAGE, TITLE, { markdown, fragmentUrl: `${PAGE}#:~:text=${encodeURIComponent(markdown.slice(0, 6))}`, selectedAt });

async function save(markdown: string, selectedAt: string): Promise<ClipSummary> {
  const outcome: SaveOutcome = await saveClip({ capture: capture(markdown, selectedAt), snapshot: false }, makeDeps());
  if (outcome.state !== 'saved') throw new Error(`没有存成功：${JSON.stringify(outcome)}`);
  return outcome.clip;
}

beforeEach(() => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  index = createSavedIndex();
  ids = ['01JQE0000000000000000000E1', '01JQF0000000000000000000F1', '01JQE0000000000000000000E2', '01JQE0000000000000000000E3'];
});

describe('摘录文件名前缀取保存时的语言', () => {
  it('英文：Quotes - {title}.md', async () => {
    useLocale('en');
    const clip = await save('System 1 operates automatically.', T1);
    expect(clip.file).toBe(`Quotes - ${TITLE}.md`);
    expect([...library.files.keys()]).toEqual([`Quotes - ${TITLE}.md`]);
    expect(library.text(clip.file)).toContain(`# Quotes - ${TITLE}\n\n[Source](${PAGE})`);
  });
});

describe('跨语言追加与改批注（验收第 4 条）', () => {
  it('中文存两条 → 英文存第三条：追加进原中文文件，entry 为 3；改旧条目批注成功，英文条目不受影响', async () => {
    const c1 = await save('System 1 operates automatically.', T1);
    const c2 = await save('Nothing in life is as important.', T2);
    const zhFile = `摘录 - ${TITLE}.md`;
    expect([c1.file, c2.file]).toEqual([zhFile, zhFile]);

    useLocale('en');
    const c3 = await save('The focusing illusion.', T3);
    expect(c3.file).toBe(zhFile);
    expect(c3.quote).toMatchObject({ entry: 3, recreated: false });
    expect(c3.quote?.anchor).toContain('[Jump to source](');
    expect([...library.files.keys()]).toEqual([zhFile]);

    const deps = { library, index };
    await applyEdits(c1, { note: 'Note on the first entry' }, deps);
    const md = library.text(zhFile) ?? '';
    expect(md).toContain(`${c1.quote?.anchor}\n\nNote on the first entry\n\n> Nothing in life`);
    expect(md.endsWith(`> The focusing illusion.\n\n${c3.quote?.anchor}\n`)).toBe(true);

    await applyEdits(c3, { note: 'Note on the English entry' }, deps);
    const md2 = library.text(zhFile) ?? '';
    expect(md2).toContain(`${c1.quote?.anchor}\n\nNote on the first entry\n\n> Nothing in life`);
    expect(md2.endsWith(`${c3.quote?.anchor}\n\nNote on the English entry\n`)).toBe(true);
  });

  it('英文存两条 → 中文存第三条：追加进原英文文件，entry 为 3；改旧条目批注成功，中文条目不受影响', async () => {
    useLocale('en');
    const c1 = await save('System 1 operates automatically.', T1);
    await save('Nothing in life is as important.', T2);
    const enFile = `Quotes - ${TITLE}.md`;
    expect(c1.file).toBe(enFile);

    useLocale('zh_CN');
    const c3 = await save('聚焦错觉。', T3);
    expect(c3.file).toBe(enFile);
    expect(c3.quote).toMatchObject({ entry: 3, recreated: false });
    expect(c3.quote?.anchor).toContain('[跳回原文](');

    const deps = { library, index };
    await applyEdits(c1, { note: '第一条的批注' }, deps);
    const md = library.text(enFile) ?? '';
    expect(md).toContain(`${c1.quote?.anchor}\n\n第一条的批注\n\n> Nothing in life`);
    expect(md.endsWith(`> 聚焦错觉。\n\n${c3.quote?.anchor}\n`)).toBe(true);
  });
});
