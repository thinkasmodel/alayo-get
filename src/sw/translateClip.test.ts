import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { planBilingual } from '@/core/bilingual';
import { createLock, type Lock } from './lock';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createPendingQueue } from '@/io/pending';
import { createSavedIndex, type SavedIndex } from '@/io/savedIndex';
import type { Capture, ClipSummary, SavedEntry } from '@/shared/types';
import type { TranslateHandlers, TranslateRequest, TranslateResult, TranslationService } from '@/core/translate/types';
import { applyEdits } from './applyEdits';
import { saveClip } from './saveClip';
import { FLUSH_MS, startClipTranslation, type TranslateClipDeps } from './translateClip';

const ID = '01K7B2Q8N4M6P3R5T7V9X1Z3A5';
const SOURCE = 'https://example.org/blog/small-library-catalogs';
const FILE = 'article.md';
const TITLE = 'How Small Libraries Keep Their Catalogs Alive';

function fixture(name: string): string {
  return readFileSync(new URL(`../core/__fixtures__/bilingual/${name}`, import.meta.url), 'utf8');
}

const original = fixture('article.original.md');
const expected = fixture('article.expected.md');
const table = JSON.parse(fixture('article.translations.json')) as Record<string, string>;

const record: SavedEntry = { id: ID, file: FILE, title: TITLE, medium: 'web', source: SOURCE, savedAt: '2026-10-18T05:40:00.000Z', tags: [] };
const clip: ClipSummary = {
  id: ID,
  file: FILE,
  title: TITLE,
  medium: 'web',
  site: 'example.org',
  source: SOURCE,
  extract: 'full',
  imageCount: 0,
  imageFailures: 0,
  tags: [],
  note: '',
  savedAt: '2026-10-18T05:40:00.000Z',
};

class FakeTranslation implements TranslationService {
  readonly requests: TranslateRequest[] = [];
  readonly cancelled: string[] = [];
  handlers: TranslateHandlers | null = null;
  private resolveResult: ((result: TranslateResult) => void) | null = null;
  private nextId = 0;

  translate(request: TranslateRequest, handlers?: TranslateHandlers) {
    this.requests.push(request);
    this.handlers = handlers ?? null;
    this.nextId += 1;
    let resolve!: (result: TranslateResult) => void;
    const result = new Promise<TranslateResult>((done) => {
      resolve = done;
    });
    this.resolveResult = resolve;
    return { id: `job-${this.nextId}`, result };
  }

  cancel(jobId: string): void {
    this.cancelled.push(jobId);
  }

  emitSource(source: string): void {
    this.handlers?.onSource?.(source);
  }

  emitSegment(index: number, text: string): void {
    this.handlers?.onSegment?.(index, text);
  }

  finish(result: TranslateResult): void {
    this.resolveResult?.(result);
    this.resolveResult = null;
  }
}

class FakeClock {
  private now = 0;
  private next = 0;
  private timers = new Map<number, { fn: () => void; at: number }>();

  setTimer = (fn: () => void, ms: number): unknown => {
    this.next += 1;
    this.timers.set(this.next, { fn, at: this.now + ms });
    return this.next;
  };

  clearTimer = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  tick(ms = FLUSH_MS): void {
    this.now += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.now) {
        this.timers.delete(id);
        timer.fn();
      }
    }
  }
}

const settle = async (turns = 4): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function bodyOf(md: string): string {
  return md.slice(md.indexOf('\n---\n') + 5);
}

let library: MemoryLibrary;
let index: SavedIndex;
let clock: FakeClock;
let translator: FakeTranslation;
let lock: Lock;

function deps(): TranslateClipDeps {
  return { library, index, lock, translator, setTimer: clock.setTimer, clearTimer: clock.clearTimer };
}

function start(target = 'zh') {
  return startClipTranslation({ id: ID, source: SOURCE, medium: 'web', target }, deps());
}

function emitAll(segments: string[], from = 0): void {
  for (let i = from; i < segments.length; i += 1) {
    translator.emitSegment(i, table[segments[i] ?? ''] ?? segments[i] ?? '');
  }
}

beforeEach(async () => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  index = createSavedIndex();
  clock = new FakeClock();
  translator = new FakeTranslation();
  lock = createLock();
  library.files.set(FILE, original);
  await index.put(SOURCE, record);
});

describe('startClipTranslation：完整翻译', () => {
  it('onSource 后立刻写 partial；推进 FLUSH_MS 写回已完成单元；完成后 complete 且文件与金样例一致', async () => {
    const job = start();
    await settle();
    expect(translator.requests).toHaveLength(1);
    const segments = translator.requests[0]?.segments ?? [];
    expect(segments).toEqual(planBilingual(original, 'web').segments);

    translator.emitSource('en');
    await settle();
    const afterSource = library.text(FILE) ?? '';
    expect(afterSource).toContain('lang: "en"');
    expect(afterSource).toContain('translated_to: "zh"');
    expect(afterSource).toContain('translation: "partial"');
    expect(bodyOf(afterSource)).toBe(bodyOf(original));
    expect(library.ops).toEqual([{ op: 'write', path: FILE }]);

    // 第一个单元（标题）译完：还不写，等 FLUSH_MS。
    const plan = planBilingual(original, 'web');
    const first = plan.units[0];
    expect(first?.kind).toBe('heading');
    for (const index of first?.segmentIndexes ?? []) translator.emitSegment(index, table[segments[index] ?? ''] ?? '');
    await settle();
    expect(library.ops).toHaveLength(1);

    clock.tick(FLUSH_MS);
    await settle();
    const flushed = library.text(FILE) ?? '';
    expect(flushed).toContain('\n# 小型图书馆如何使他们的目录保持活力\n');
    expect(flushed).toContain('translation: "partial"');
    expect(library.ops).toHaveLength(2);

    emitAll(segments, (first?.segmentIndexes.length ?? 1));
    translator.finish({ status: 'complete', source: 'en' });
    const outcome = await job.done;
    expect(outcome).toEqual({ status: 'complete', applied: plan.units.length, total: plan.units.length, source: 'en' });
    expect(library.text(FILE)).toBe(expected);
  });
});

describe('startClipTranslation：同语言、失败与没有可翻的段', () => {
  it('同语言 → skipped，文件逐字节不变', async () => {
    const before = library.text(FILE);
    const job = start('en');
    await settle();
    translator.emitSource('en');
    translator.finish({ status: 'skipped', source: 'en' });
    const outcome = await job.done;
    expect(outcome.status).toBe('skipped');
    expect(outcome.applied).toBe(0);
    expect(library.text(FILE)).toBe(before);
    expect(library.ops).toEqual([]);
  });

  it('failed + needs-download（无 onSource）→ 只改 frontmatter，lang 为空串、正文不变', async () => {
    const job = start();
    await settle();
    const error = { code: 'needs-download', model: { kind: 'translator', source: 'en', target: 'zh' } } as const;
    translator.finish({ status: 'failed', error, done: 0 });
    const outcome = await job.done;
    expect(outcome.status).toBe('failed');
    expect(outcome.applied).toBe(0);
    expect(outcome.total).toBeGreaterThan(0);
    expect(outcome.error).toEqual(error);
    const md = library.text(FILE) ?? '';
    expect(md).toContain('lang: ""');
    expect(md).toContain('translated_to: "zh"');
    expect(md).toContain('translation: "failed"');
    expect(bodyOf(md)).toBe(bodyOf(original));
  });

  it('没有要翻的段 → 不调翻译、不写文件，skipped', async () => {
    const empty = `---\nid: "01TEST"\nsource: "https://example.com/x"\nmedium: "web"\ntitle: "T"\nauthor: ""\npublished: ""\ncaptured: "2026-10-18T00:00:00.000Z"\nsite: "example.com"\ntags: []\nnote: ""\nextract: "full"\n---\n\n[原文](https://example.com/x)\n\n12,400\n\n    indented code\n`;
    library.files.set('empty.md', empty);
    await index.put('https://example.com/x', { ...record, id: '01TEST', file: 'empty.md', source: 'https://example.com/x' });
    const job = startClipTranslation(
      { id: '01TEST', source: 'https://example.com/x', medium: 'web', target: 'zh' },
      { library, index, lock, translator, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
    );
    const outcome = await job.done;
    expect(outcome).toEqual({ status: 'skipped', applied: 0, total: 0 });
    expect(translator.requests).toEqual([]);
    expect(library.ops).toEqual([]);
  });
});

describe('startClipTranslation：取消、失败与中断', () => {
  const half = async (result: TranslateResult) => {
    const job = start();
    await settle();
    const segments = translator.requests[0]?.segments ?? [];
    translator.emitSource('en');
    await settle();
    const first = planBilingual(original, 'web').units[0];
    for (const index of first?.segmentIndexes ?? []) translator.emitSegment(index, table[segments[index] ?? ''] ?? '');
    clock.tick(FLUSH_MS);
    await settle();
    translator.finish(result);
    const outcome = await job.done;
    const md = library.text(FILE) ?? '';
    expect(outcome.status).toBe('partial');
    expect(outcome.applied).toBe(1);
    expect(md).toContain('\n# 小型图书馆如何使他们的目录保持活力\n');
    expect(md).toContain('translation: "partial"');
    expect(bodyOf(md)).toContain('# 小型图书馆如何使他们的目录保持活力');
    expect(bodyOf(md)).toContain('Most small libraries still run');
    expect(bodyOf(md)).not.toContain('大多数小型图书馆');
    return outcome;
  };

  it('翻到一半 cancelled：已插入的保留，partial', async () => {
    const outcome = await half({ status: 'cancelled', source: 'en', done: 1 });
    expect(outcome.error).toBeUndefined();
  });

  it('翻到一半 host-lost：已插入的保留，partial 且带错误', async () => {
    const outcome = await half({ status: 'failed', error: { code: 'host-lost' }, source: 'en', done: 1 });
    expect(outcome.error).toEqual({ code: 'host-lost' });
  });
});

describe('startClipTranslation：翻译中途文件被改名', () => {
  it('按已保存记录跟到新文件名，标题改动保留；被改掉的标题进 missing', async () => {
    const job = start();
    await settle();
    const segments = translator.requests[0]?.segments ?? [];
    translator.emitSource('en');
    await settle();

    const renamed = await applyEdits(clip, { title: '新标题' }, { library, index, lock });
    expect(renamed.file).toBe('新标题.md');
    expect(library.files.has(FILE)).toBe(false);

    emitAll(segments);
    translator.finish({ status: 'complete', source: 'en' });
    const outcome = await job.done;

    expect(outcome.status).toBe('partial');
    expect(outcome.applied).toBe(planBilingual(original, 'web').units.length - 1);
    const md = library.text('新标题.md') ?? '';
    expect(md).toContain('title: "新标题"');
    expect(md).toContain('\n# 新标题\n');
    expect(md).not.toContain('\n# 小型图书馆如何使他们的目录保持活力\n');
    expect(md).toContain('translation: "partial"');
    expect(md).toContain('大多数小型图书馆');
    expect(await index.get(SOURCE)).toMatchObject({ file: '新标题.md', title: '新标题' });
  });
});

describe('startClipTranslation：定位失败', () => {
  const abortAfterFirstFlush = async (mutate: () => void) => {
    const job = start();
    await settle();
    const segments = translator.requests[0]?.segments ?? [];
    translator.emitSource('en');
    await settle();
    mutate();
    const first = planBilingual(original, 'web').units[0];
    for (const index of first?.segmentIndexes ?? []) translator.emitSegment(index, table[segments[index] ?? ''] ?? '');
    clock.tick(FLUSH_MS);
    const outcome = await job.done;
    expect(outcome.status).toBe('aborted');
    expect(translator.cancelled).toEqual(['job-1']);
    const ops = library.ops.length;
    emitAll(segments);
    clock.tick(FLUSH_MS);
    await settle();
    expect(library.ops).toHaveLength(ops);
    translator.finish({ status: 'cancelled', done: 0 });
    await settle();
    return outcome;
  };

  it('文件被删：aborted，取消翻译任务，之后不再写', async () => {
    const outcome = await abortAfterFirstFlush(() => {
      library.files.delete(FILE);
    });
    expect(outcome.reason).toBe('file-missing');
  });

  it('frontmatter id 不符：aborted，取消翻译任务，之后不再写', async () => {
    const outcome = await abortAfterFirstFlush(() => {
      library.files.set(FILE, original.replace(`id: "${ID}"`, 'id: "01OTHER"'));
    });
    expect(outcome.reason).toBe('id-mismatch');
  });
});

describe('startClipTranslation：与保存共用剪藏库锁', () => {
  it('翻译写回与并发的 saveClip 不交错：所有写入都在锁内', async () => {
    let active = false;
    const inner = createLock();
    const traced: Lock = (fn) =>
      inner(async () => {
        expect(active).toBe(false);
        active = true;
        try {
          return await fn();
        } finally {
          active = false;
        }
      });
    const realWrite = library.write.bind(library);
    library.write = async (path: string, data: Blob | string) => {
      expect(active).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return realWrite(path, data);
    };

    const job = startClipTranslation(
      { id: ID, source: SOURCE, medium: 'web', target: 'zh' },
      { library, index, lock: traced, translator, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
    );
    await settle();
    const segments = translator.requests[0]?.segments ?? [];
    translator.emitSource('en');
    emitAll(segments);
    clock.tick(FLUSH_MS);

    const capture: Capture = {
      url: 'https://example.com/other',
      title: '另存文章',
      site: '',
      author: '',
      published: '',
      description: '',
      coverUrl: '',
      markdown: '另存文章的正文。'.repeat(20),
      textLength: 400,
      kind: 'page',
    };
    const pending = createPendingQueue();
    const saved = await saveClip(
      { capture, snapshot: false },
      {
        library,
        index,
        pending,
        fetch: async () => {
          throw new TypeError('no network in test');
        },
        now: () => new Date('2026-10-18T06:00:00.000Z'),
        newId: () => '01SAVE',
        lock: traced,
      },
    );
    expect(saved.state).toBe('saved');

    translator.finish({ status: 'complete', source: 'en' });
    const outcome = await job.done;
    expect(outcome.status).toBe('complete');
    expect(library.files.has('另存文章.md')).toBe(true);
    expect(library.text(FILE)).toBe(expected);
  });
});
