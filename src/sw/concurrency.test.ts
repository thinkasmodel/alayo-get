// codex review ALAG-2A 第 1 轮三条 finding 的回归测试：并发保存、满队列补写失去授权、改名的提交顺序。
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { emitFrontmatter } from '@/core/frontmatter';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createPendingQueue, PENDING_LIMIT } from '@/io/pending';
import { createSavedIndex, type SavedIndex } from '@/io/savedIndex';
import type { Capture, ClipSummary } from '@/shared/types';
import { applyEdits } from './applyEdits';
import { flushPending, saveClip, type SaveDeps } from './saveClip';

function capture(url: string, title: string): Capture {
  return {
    url,
    title,
    site: '',
    author: '',
    published: '',
    description: '',
    coverUrl: '',
    markdown: `${title} 的正文。`.repeat(20),
    textLength: 400,
    kind: 'page',
  };
}

let library: MemoryLibrary;
let seq: number;

function deps(extra: Partial<SaveDeps> = {}): SaveDeps {
  return {
    library,
    index: createSavedIndex(),
    pending: createPendingQueue(),
    fetch: async () => {
      throw new TypeError('no network in test');
    },
    now: () => new Date('2026-10-06T03:00:00.000Z'),
    newId: () => `01JCONC00000000000000000${String(++seq).padStart(2, '0')}`,
    ...extra,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  seq = 0;
});

describe('并发保存', () => {
  it('不同出处、相同标题同时保存：写出两个不同的文件，各自的已保存记录指向自己的文件', async () => {
    // 列目录后稍等一下，让没有互斥时两次保存都先列完目录、再写同一个文件名。
    const realList = library.listRoot.bind(library);
    library.listRoot = async () => {
      const names = await realList();
      await new Promise((resolve) => setTimeout(resolve, 5));
      return names;
    };
    const d = deps();
    const [a, b] = await Promise.all([
      saveClip({ capture: capture('https://a.example.com/x', '同名标题'), snapshot: false }, d),
      saveClip({ capture: capture('https://b.example.com/y', '同名标题'), snapshot: false }, d),
    ]);
    expect(a.state).toBe('saved');
    expect(b.state).toBe('saved');
    const files = [...library.files.keys()].filter((p) => p.endsWith('.md')).sort();
    expect(files).toEqual(['同名标题 (2).md', '同名标题.md']);
    const all = await d.index.all();
    expect(new Set(Object.values(all).map((e) => e.file)).size).toBe(2);
  });

  it('同一出处同时保存两次：一次 saved，一次 duplicate，只写一个 .md', async () => {
    const d = deps();
    const outcomes = await Promise.all([
      saveClip({ capture: capture('https://a.example.com/x', '一篇'), snapshot: false }, d),
      saveClip({ capture: capture('https://a.example.com/x', '一篇'), snapshot: false }, d),
    ]);
    expect(outcomes.map((o) => o.state).sort()).toEqual(['duplicate', 'saved']);
    expect([...library.files.keys()].filter((p) => p.endsWith('.md'))).toEqual(['一篇.md']);
  });
});

describe('提交失败后的重试', () => {
  it('已保存记录写入失败：本次写下的文件全部清掉，重试只留下一份（codex review 第 3 轮）', async () => {
    const d = deps();
    const realPut = d.index.put.bind(d.index);
    let failOnce = true;
    d.index.put = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      return realPut(...args);
    };
    const req = { capture: capture('https://a.example.com/x', 'Article'), snapshot: false };
    const first = await saveClip(req, d);
    expect(first.state).toBe('failed');
    expect([...library.files.keys()]).toEqual([]);

    const second = await saveClip(req, d);
    expect(second.state).toBe('saved');
    expect([...library.files.keys()].filter((p) => p.endsWith('.md'))).toEqual(['Article.md']);
  });
});

describe('满队列补写', () => {
  it('补写途中失去授权：原条目留在队列里，队列条数不变，没有条目丢失', async () => {
    const d = deps();
    for (let i = 0; i < PENDING_LIMIT; i++) {
      await d.pending.push({ capture: capture(`https://q.example.com/${i}`, `第 ${i} 篇`), snapshot: false });
    }
    const before = await d.pending.list();
    // flushPending 自己的权限检查通过，随后第一条保存时权限变为 prompt。
    let calls = 0;
    library.permission = async () => (++calls === 1 ? 'granted' : 'prompt');

    await flushPending(d);

    const after = await d.pending.list();
    expect(after).toHaveLength(PENDING_LIMIT);
    expect(after).toEqual(before);
    expect([...library.files.keys()]).toEqual([]);
  });
});

describe('改名的提交顺序', () => {
  const SOURCE = 'https://example.com/post';
  const ID = '01JCONCEDIT000000000000001';
  const clip: ClipSummary = {
    id: ID,
    file: '旧标题.md',
    title: '旧标题',
    medium: 'web',
    site: 'example.com',
    source: SOURCE,
    extract: 'full',
    imageCount: 0,
    imageFailures: 0,
    tags: [],
    note: '',
    savedAt: '2026-10-06T00:00:00.000Z',
  };
  let index: SavedIndex;

  beforeEach(async () => {
    index = createSavedIndex();
    library.files.set(
      '旧标题.md',
      emitFrontmatter({
        id: ID,
        source: SOURCE,
        medium: 'web',
        title: '旧标题',
        author: '',
        published: '',
        captured: new Date('2026-10-06T00:00:00Z'),
        tags: [],
        note: '',
        extract: 'full',
      }) + `\n# 旧标题\n\n[原文](${SOURCE})\n\n正文。\n`,
    );
    await index.put(SOURCE, { id: ID, file: '旧标题.md', title: '旧标题', medium: 'web', source: SOURCE, savedAt: clip.savedAt, tags: [] });
  });

  it('已保存记录提交失败：旧文件仍在，调用方拿到错误', async () => {
    const failing: SavedIndex = {
      ...index,
      updateById: async () => {
        throw new Error('QUOTA_BYTES quota exceeded');
      },
    };
    await expect(applyEdits(clip, { title: '新标题' }, { library, index: failing })).rejects.toThrow('quota');
    expect(library.files.has('旧标题.md')).toBe(true);
    expect((await index.get(SOURCE))?.file).toBe('旧标题.md');
  });

  it('删除旧文件失败：修改照常生效，已保存记录指向新文件', async () => {
    const realRemove = library.remove.bind(library);
    library.remove = async (path: string) => {
      if (path === '旧标题.md') throw new Error('remove failed');
      return realRemove(path);
    };
    const next = await applyEdits(clip, { title: '新标题' }, { library, index });
    expect(next.file).toBe('新标题.md');
    expect(library.files.has('新标题.md')).toBe(true);
    expect((await index.get(SOURCE))?.file).toBe('新标题.md');
  });

  it('改名时记录提交失败：删掉新文件、保留旧文件，重试后只有一份（codex review 第 5 轮）', async () => {
    const realUpdate = index.updateById.bind(index);
    let failOnce = true;
    const flaky: SavedIndex = {
      ...index,
      updateById: async (...args) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('QUOTA_BYTES quota exceeded');
        }
        return realUpdate(...args);
      },
    };
    await expect(applyEdits(clip, { title: '新标题' }, { library, index: flaky })).rejects.toThrow('quota');
    expect([...library.files.keys()].sort()).toEqual(['旧标题.md']);
    await applyEdits(clip, { title: '新标题' }, { library, index: flaky });
    expect([...library.files.keys()].sort()).toEqual(['新标题.md']);
  });

  it('先提交已保存记录，再删旧文件', async () => {
    const order: string[] = [];
    const tracked: SavedIndex = {
      ...index,
      updateById: async (...args) => {
        order.push('index');
        return index.updateById(...args);
      },
    };
    const realRemove = library.remove.bind(library);
    library.remove = async (path: string) => {
      order.push('remove');
      return realRemove(path);
    };
    await applyEdits(clip, { title: '新标题' }, { library, index: tracked });
    expect(order).toEqual(['index', 'remove']);
  });
});
