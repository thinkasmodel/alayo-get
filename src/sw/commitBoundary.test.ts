// codex review ALAG-2A 第 4 轮：提交边界、图片任务失败后的迟到写入、FSA 新建文件写入失败的清理。
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { emitFrontmatter, readEditableFields } from '@/core/frontmatter';
import { FsaLibrary } from '@/io/library';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createPendingQueue } from '@/io/pending';
import { createSavedIndex } from '@/io/savedIndex';
import type { Capture } from '@/shared/types';
import { applyEdits } from './applyEdits';
import { saveClip, type FetchLike, type SaveDeps } from './saveClip';

const imageFetch: FetchLike = async () =>
  new Response('img', { status: 200, headers: { 'content-type': 'image/png' } });

function capture(markdown: string): Capture {
  return {
    url: 'https://a.example.com/x',
    title: 'Article',
    site: '',
    author: '',
    published: '',
    description: '',
    coverUrl: '',
    markdown,
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
    fetch: imageFetch,
    now: () => new Date('2026-10-06T04:00:00.000Z'),
    newId: () => `01JCOMMIT0000000000000000${++seq}`,
    ...extra,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  seq = 0;
});

describe('已保存记录提交之后', () => {
  it('读取标签建议失败：仍返回 saved，文件和记录都保留', async () => {
    const d = deps();
    d.index.all = async () => {
      throw new Error('storage read failed');
    };
    const outcome = await saveClip({ capture: capture('正文'), snapshot: false }, d);
    expect(outcome.state).toBe('saved');
    if (outcome.state === 'saved') expect(outcome.tagSuggestions).toEqual([]);
    expect(library.files.has('Article.md')).toBe(true);
    expect((await d.index.get('https://a.example.com/x'))?.file).toBe('Article.md');
  });
});

describe('图片写入失败', () => {
  it('一张图写入失败、另一张写入较慢：saveClip 返回之后不再有任何写入，文件全部清掉', async () => {
    const md = ['![a](https://img.example.com/a.png)', '![b](https://img.example.com/b.png)'].join('\n\n');
    const realWrite = library.write.bind(library);
    library.write = async (path, data) => {
      if (path.endsWith('/1.png')) throw new Error('disk full');
      if (path.endsWith('/2.png')) await new Promise((resolve) => setTimeout(resolve, 20));
      return realWrite(path, data);
    };
    const outcome = await saveClip({ capture: capture(md), snapshot: false }, deps());
    expect(outcome.state).toBe('failed');
    const opsAtReturn = library.ops.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(library.ops.length).toBe(opsAtReturn);
    expect([...library.files.keys()]).toEqual([]);
  });
});

/** 最小的 FSA 目录句柄假实现：能模拟 createWritable 失败。 */
function fakeDir(failCreateWritable: boolean) {
  const files = new Set<string>();
  const removed: string[] = [];
  const dir = {
    files,
    removed,
    queryPermission: async () => 'granted',
    getDirectoryHandle: async () => dir,
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!opts?.create) {
          const err = new Error('not found');
          err.name = 'NotFoundError';
          throw err;
        }
        files.add(name);
      }
      return {
        createWritable: async () => {
          if (failCreateWritable) throw new Error('createWritable failed');
          return { write: async () => {}, close: async () => {}, abort: async () => {} };
        },
      };
    },
    removeEntry: async (name: string) => {
      files.delete(name);
      removed.push(name);
    },
  };
  return dir;
}

describe('FsaLibrary 写入失败', () => {
  it('本次新建的文件写入失败：删掉这个空文件', async () => {
    const dir = fakeDir(true);
    const lib = new FsaLibrary(async () => dir as unknown as FileSystemDirectoryHandle);
    await expect(lib.write('Article.md', '正文')).rejects.toThrow('createWritable failed');
    expect(dir.files.has('Article.md')).toBe(false);
    expect(dir.removed).toEqual(['Article.md']);
  });

  it('原有文件写入失败：不删原文件', async () => {
    const dir = fakeDir(true);
    dir.files.add('Existing.md');
    const lib = new FsaLibrary(async () => dir as unknown as FileSystemDirectoryHandle);
    await expect(lib.write('Existing.md', '正文')).rejects.toThrow('createWritable failed');
    expect(dir.files.has('Existing.md')).toBe(true);
    expect(dir.removed).toEqual([]);
  });
});

describe('写回修改前核对文件 id（codex review 第 6 轮）', () => {
  it('同名文件属于另一条剪藏（例如剪藏库被更换）：拒绝修改，文件不动', async () => {
    const { applyEdits } = await import('./applyEdits');
    const { emitFrontmatter } = await import('@/core/frontmatter');
    const other =
      emitFrontmatter({
        id: '01JOTHERCLIP00000000000001',
        source: 'https://b.example.com/',
        medium: 'web',
        title: 'Article',
        author: '',
        published: '',
        captured: new Date('2026-10-06T00:00:00Z'),
        tags: [],
        note: '别人的批注',
        extract: 'full',
      }) + '\n# Article\n';
    library.files.set('Article.md', other);
    const clip = {
      id: '01JMINECLIP000000000000001',
      file: 'Article.md',
      source: 'https://a.example.com/x',
      title: 'Article',
      tags: [],
      note: '',
    };
    await expect(applyEdits(clip, { note: '我的批注' }, { library, index: createSavedIndex() })).rejects.toMatchObject({
      name: 'ClipMismatchError',
    });
    expect(library.text('Article.md')).toBe(other);
    expect(library.ops).toEqual([]);
  });
});

describe('以文件里的实际内容判断有没有改动（codex review 加审轮）', () => {
  const ID = '01JACTUAL00000000000000001';
  const file = (note: string) =>
    emitFrontmatter({
      id: ID,
      source: 'https://a.example.com/x',
      medium: 'web',
      title: 'Article',
      author: '',
      published: '',
      captured: new Date('2026-10-06T00:00:00Z'),
      tags: [],
      note,
      extract: 'full',
    }) + '\n# Article\n';
  const clip = (note: string) => ({ id: ID, file: 'Article.md', source: 'https://a.example.com/x', title: 'Article', tags: [] as string[], note });

  it('缓存说批注为空、文件里其实是 A：清空批注时照常写入', async () => {
    library.files.set('Article.md', file('A'));
    await applyEdits(clip(''), { note: '' }, { library, index: createSavedIndex() });
    expect(readEditableFields(library.text('Article.md') ?? '').note).toBe('');
  });

  it('缓存说批注是 A、文件里已经是空：不写', async () => {
    library.files.set('Article.md', file(''));
    await applyEdits(clip('A'), { note: '' }, { library, index: createSavedIndex() });
    expect(library.ops).toEqual([]);
  });

  it('readEditableFields 读出标题、标签、批注', () => {
    expect(readEditableFields(file('含"引号"与：冒号'))).toEqual({ title: 'Article', tags: [], note: '含"引号"与：冒号' });
    expect(readEditableFields('没有 frontmatter')).toEqual({});
  });
});
