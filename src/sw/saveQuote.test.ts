// 摘录剪藏的保存与写批注（ALAG-4 brief B §5、§6）。本地时间固定为东八区，断言里直接写字面量。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { parse } from 'yaml';
import { quoteTimestamp } from '@/core/quote';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createPendingQueue } from '@/io/pending';
import { createSavedIndex, type SavedIndex } from '@/io/savedIndex';
import type { Capture, ClipSummary, SaveOutcome } from '@/shared/types';
import { applyEdits } from './applyEdits';
import { quoteCapture, resolveQuoteCapture } from './route';
import { flushPending, saveClip, type SaveDeps } from './saveClip';
import { quoteIndexKey } from './saveQuote';

vi.stubEnv('TZ', 'Asia/Shanghai');

const PAGE = 'https://sspai.com/post/90001?utm_source=feed';
const SOURCE = 'https://sspai.com/post/90001';
const KEY = `quote:${SOURCE}`;
const TITLE = '为什么我们需要慢思考';
const FILE = `摘录 - ${TITLE}.md`;
const NOW = new Date('2026-10-08T01:00:00.000Z');

/** 16:31、16:35、16:40（东八区）。 */
const T1 = '2026-10-07T08:31:00.000Z';
const T2 = '2026-10-07T08:35:10.000Z';
const T3 = '2026-10-07T08:40:00.000Z';

const frag = (text: string) => `${PAGE}#:~:text=${encodeURIComponent(text)}`;

function quote(markdown: string, selectedAt: string, fragmentUrl: string | null = frag(markdown.slice(0, 4))): Capture {
  return quoteCapture(PAGE, TITLE, { markdown, fragmentUrl, selectedAt });
}

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
    now: () => NOW,
    newId: () => {
      const id = ids.shift();
      if (!id) throw new Error('测试 id 用完了');
      return id;
    },
  };
}

function savedClip(outcome: SaveOutcome): ClipSummary {
  if (outcome.state !== 'saved') throw new Error(`没有存成功：${JSON.stringify(outcome)}`);
  return outcome.clip;
}

function frontmatterOf(md: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m?.[1]) throw new Error('没有 frontmatter');
  return parse(m[1]) as Record<string, unknown>;
}

const bodyOf = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, '');

beforeEach(() => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  index = createSavedIndex();
  ids = ['01JQE0000000000000000000E1', '01JQF0000000000000000000F1', '01JQE0000000000000000000E2', '01JQE0000000000000000000E3', '01JQE0000000000000000000E4', '01JQF0000000000000000000F2'];
});

const Q1 = '快思考替我们省下了大量注意力，代价是它几乎从不怀疑自己。\n\n慢思考的价值不在于更**聪明**，而在于它肯停下来。';
const Q2 = '每一次“我早就知道”，都是一次被删改的记忆。';
const Q3 = '[卡尼曼](https://example.com/k)说系统 1 很快。';

async function threeQuotes(): Promise<ClipSummary[]> {
  const deps = makeDeps();
  return [savedClip(await saveClip({ capture: quote(Q1, T1), snapshot: false }, deps)), savedClip(await saveClip({ capture: quote(Q2, T2), snapshot: false }, deps)), savedClip(await saveClip({ capture: quote(Q3, T3), snapshot: false }, deps))];
}

describe('saveClip：摘录剪藏', () => {
  it('同一页面连续摘录 3 条：只有一个摘录文件，3 个 anchor 行，entry 依次 1、2、3，版式与样张一致', async () => {
    const clips = await threeQuotes();
    expect([...library.files.keys()]).toEqual([FILE]);
    expect(clips.map((c) => c.quote?.entry)).toEqual([1, 2, 3]);
    expect(clips.map((c) => c.id)).toEqual(['01JQE0000000000000000000E1', '01JQE0000000000000000000E2', '01JQE0000000000000000000E3']);
    for (const c of clips) {
      expect(c).toMatchObject({ file: FILE, title: TITLE, medium: 'quote', source: SOURCE, site: 'sspai.com', note: '' });
      expect(c.quote).toMatchObject({ fileId: '01JQF0000000000000000000F1', fragment: true, recreated: false });
    }

    const md = library.text(FILE) ?? '';
    // frontmatter 只有一份，captured 是第一条的时间；比样张多 author、published、extract 三个空键（键集与其他剪藏一致）
    expect(md.match(/^---$/gm)).toHaveLength(2);
    expect(frontmatterOf(md)).toEqual({
      id: '01JQF0000000000000000000F1',
      source: SOURCE,
      medium: 'quote',
      title: TITLE,
      author: '',
      published: '',
      captured: T1,
      site: 'sspai.com',
      tags: [],
      note: '',
      extract: 'full',
    });
    expect(bodyOf(md)).toBe(
      [
        '',
        `# 摘录 - ${TITLE}`,
        '',
        `[原文](${SOURCE})`,
        '',
        '> 快思考替我们省下了大量注意力，代价是它几乎从不怀疑自己。',
        '>',
        '> 慢思考的价值不在于更**聪明**，而在于它肯停下来。',
        '',
        `2026-10-07 16:31 · [跳回原文](${frag('快思考替')})`,
        '',
        `> ${Q2}`,
        '',
        `2026-10-07 16:35 · [跳回原文](${frag('每一次“')})`,
        '',
        `> ${Q3}`,
        '',
        `2026-10-07 16:40 · [跳回原文](${frag('[卡尼曼')})`,
        '',
      ].join('\n'),
    );
    expect(clips.map((c) => c.quote?.anchor)).toEqual([
      `2026-10-07 16:31 · [跳回原文](${frag('快思考替')})`,
      `2026-10-07 16:35 · [跳回原文](${frag('每一次“')})`,
      `2026-10-07 16:40 · [跳回原文](${frag('[卡尼曼')})`,
    ]);
    // 摘录文件记录：键带 quote: 前缀，id 是文件 id，source 是规范化页面地址
    expect(await index.get(KEY)).toEqual({ id: '01JQF0000000000000000000F1', file: FILE, title: TITLE, medium: 'quote', source: SOURCE, savedAt: T1, tags: [] });
    expect(await index.get(SOURCE)).toBeUndefined();
  });

  it('时间行用 selectedAt 的本地时间（与 quoteTimestamp 一致）', () => {
    expect(quoteTimestamp(T2)).toBe('2026-10-07 16:35');
  });

  it('摘录文件被删掉后再摘录：新建文件，recreated，entry 为 1，记录指向新文件', async () => {
    await threeQuotes();
    library.files.delete(FILE);
    const clip = savedClip(await saveClip({ capture: quote(Q2, T3), snapshot: false }, makeDeps()));
    expect(clip.quote).toMatchObject({ entry: 1, recreated: true, fileId: '01JQF0000000000000000000F2' });
    expect(clip.id).toBe('01JQE0000000000000000000E4');
    expect(clip.file).toBe(FILE);
    expect((await index.get(KEY))?.id).toBe('01JQF0000000000000000000F2');
    expect(library.text(FILE)?.match(/· \[跳回原文\]/g)).toHaveLength(1);
  });

  it('摘录文件被改名后再摘录：原文件不动，新建一个，记录指向新文件', async () => {
    await threeQuotes();
    const content = library.text(FILE) ?? '';
    library.files.delete(FILE);
    library.files.set('我的摘录.md', content);
    const clip = savedClip(await saveClip({ capture: quote(Q2, T3), snapshot: false }, makeDeps()));
    expect(clip.quote).toMatchObject({ entry: 1, recreated: true });
    expect(library.text('我的摘录.md')).toBe(content);
    expect(await index.get(KEY)).toMatchObject({ id: '01JQF0000000000000000000F2', file: FILE });
  });

  it('同名文件的 id 不是记录里的摘录文件：新建（名字加序号），recreated', async () => {
    await threeQuotes();
    library.files.set(FILE, (library.text(FILE) ?? '').replace('id: "01JQF0000000000000000000F1"', 'id: "OTHER"'));
    const clip = savedClip(await saveClip({ capture: quote(Q2, T3), snapshot: false }, makeDeps()));
    expect(clip.file).toBe(`摘录 - ${TITLE} (2).md`);
    expect(clip.quote).toMatchObject({ entry: 1, recreated: true });
  });

  it('片段为 null：链接为页面地址，fragment 为 false', async () => {
    const clip = savedClip(await saveClip({ capture: quote('一段话 (带括号)', T1, null), snapshot: false }, makeDeps()));
    expect(clip.quote).toMatchObject({ fragment: false, entry: 1, anchor: `2026-10-07 16:31 · [跳回原文](${PAGE})` });
    expect(library.text(FILE)).toContain(`> 一段话 (带括号)\n\n2026-10-07 16:31 · [跳回原文](${PAGE})\n`);
  });

  it('链接地址里的括号、空白按 linkDestination 编码', async () => {
    const clip = savedClip(await saveClip({ capture: quote('x', T1, 'https://a.example.com/w/A_(b)#:~:text=a(b)'), snapshot: false }, makeDeps()));
    expect(clip.quote?.anchor).toBe('2026-10-07 16:31 · [跳回原文](https://a.example.com/w/A_%28b%29#:~:text=a%28b%29)');
  });

  it('同一分钟、同一页、没有片段摘两次：第二条 anchor 带 (2)', async () => {
    const deps = makeDeps();
    const first = savedClip(await saveClip({ capture: quote('第一次', T1, null), snapshot: false }, deps));
    const second = savedClip(await saveClip({ capture: quote('第二次', '2026-10-07T08:31:40.000Z', null), snapshot: false }, deps));
    expect(first.quote?.anchor).toBe(`2026-10-07 16:31 · [跳回原文](${PAGE})`);
    expect(second.quote?.anchor).toBe(`2026-10-07 16:31 (2) · [跳回原文](${PAGE})`);
    expect(second.quote?.entry).toBe(2);
  });

  it('同一段文字再摘一次：不查重，再追加一条', async () => {
    const deps = makeDeps();
    await saveClip({ capture: quote(Q2, T1), snapshot: false }, deps);
    const again = await saveClip({ capture: quote(Q2, T2), snapshot: false }, deps);
    expect(again.state).toBe('saved');
    expect(savedClip(again).quote?.entry).toBe(2);
  });

  it('未授权：进暂存队列（Capture 能 JSON 往返）；授权后补写，时间用 selectedAt 而不是补写时刻', async () => {
    library.permissionState = 'prompt';
    const deps = makeDeps();
    const capture = quote(Q2, T2);
    expect(JSON.parse(JSON.stringify(capture))).toEqual(capture);
    const outcome = await saveClip({ capture, snapshot: false }, deps);
    expect(outcome).toMatchObject({ state: 'needs-permission', preview: { title: TITLE, source: SOURCE, medium: 'quote' } });
    expect(await deps.pending.list()).toEqual([{ capture, snapshot: false }]);
    expect(library.files.size).toBe(0);

    library.permissionState = 'granted';
    const outcomes: SaveOutcome[] = [];
    await flushPending(deps, (o) => outcomes.push(o));
    expect(outcomes.map((o) => o.state)).toEqual(['saved']);
    expect(await deps.pending.list()).toEqual([]);
    const md = library.text(FILE) ?? '';
    expect(md).toContain(`2026-10-07 16:35 · [跳回原文](`);
    expect(frontmatterOf(md).captured).toBe(T2);
    expect(md).not.toContain(NOW.toISOString());
  });

  it('页面保存与摘录互不影响：先存页面再摘录，不判已存过；反之亦然', async () => {
    const page: Capture = { url: PAGE, title: TITLE, site: '', author: '', published: '', description: '', coverUrl: '', markdown: '正文。', textLength: 300, kind: 'page' };
    const deps = makeDeps();
    expect((await saveClip({ capture: page, snapshot: false }, deps)).state).toBe('saved');
    expect((await saveClip({ capture: quote(Q2, T1), snapshot: false }, deps)).state).toBe('saved');

    fakeBrowser.reset();
    library = new MemoryLibrary();
    index = createSavedIndex();
    ids = ['A1', 'A2', 'A3'];
    const deps2 = makeDeps();
    expect((await saveClip({ capture: quote(Q2, T1), snapshot: false }, deps2)).state).toBe('saved');
    expect((await saveClip({ capture: page, snapshot: false }, deps2)).state).toBe('saved');
    expect(await index.get(SOURCE)).toMatchObject({ medium: 'web' });
    expect(await index.get(KEY)).toMatchObject({ medium: 'quote' });
  });

  it('新建时提交记录失败：删掉新建的摘录文件', async () => {
    const failing: SavedIndex = { ...index, put: async () => Promise.reject(new Error('storage 满了')) };
    const outcome = await saveClip({ capture: quote(Q2, T1), snapshot: false }, { ...makeDeps(), index: failing });
    expect(outcome.state).toBe('failed');
    expect(library.files.size).toBe(0);
  });

  it('追加时写入失败：原文件原样保留，不被清理删掉', async () => {
    await threeQuotes();
    const before = library.text(FILE);
    library.failWrite = { match: (p) => p === FILE, error: new Error('磁盘满了') };
    const outcome = await saveClip({ capture: quote('第四条', T3), snapshot: false }, makeDeps());
    expect(outcome).toMatchObject({ state: 'failed', error: { message: '磁盘满了' } });
    expect(library.text(FILE)).toBe(before);
  });
});

describe('applyEdits：摘录剪藏的批注', () => {
  it('给第 2 条加批注：出现在第 2 条 anchor 之后、第 3 条之前；再改是替换；清空是去掉；第 1、3 条与 frontmatter 不变', async () => {
    const [first, second, third] = await threeQuotes();
    if (!first || !second || !third) throw new Error('缺少摘录');
    const original = library.text(FILE) ?? '';
    const deps = { library, index };

    const withNote = await applyEdits(second, { note: '这段和卡尼曼的\n系统 1 / 系统 2 说法对得上' }, deps);
    expect(withNote.note).toBe('这段和卡尼曼的\n系统 1 / 系统 2 说法对得上');
    const a2 = second.quote?.anchor ?? '';
    const md1 = library.text(FILE) ?? '';
    expect(md1).toBe(original.replace(`${a2}\n\n> ${Q3}`, `${a2}\n\n这段和卡尼曼的\n系统 1 / 系统 2 说法对得上\n\n> ${Q3}`));

    await applyEdits(withNote, { note: '改过的批注' }, deps);
    const md2 = library.text(FILE) ?? '';
    expect(md2).toBe(original.replace(`${a2}\n\n> ${Q3}`, `${a2}\n\n改过的批注\n\n> ${Q3}`));
    expect(md2).not.toContain('对得上');

    await applyEdits({ ...withNote, note: '改过的批注' }, { note: '' }, deps);
    expect(library.text(FILE)).toBe(original);
    // 已保存记录不变
    expect((await index.get(KEY))?.id).toBe('01JQF0000000000000000000F1');
  });

  it('给最后一条加批注、再清空：批注接在文件末尾，清空后回到原样', async () => {
    const [, , third] = await threeQuotes();
    if (!third) throw new Error('缺少摘录');
    const original = library.text(FILE) ?? '';
    await applyEdits(third, { note: '末尾批注' }, { library, index });
    expect(library.text(FILE)).toBe(`${original}\n末尾批注\n`);
    await applyEdits({ ...third, note: '末尾批注' }, { note: '' }, { library, index });
    expect(library.text(FILE)).toBe(original);
  });

  it('只改 title、tags：不写文件', async () => {
    const [first] = await threeQuotes();
    if (!first) throw new Error('缺少摘录');
    library.ops.length = 0;
    await applyEdits(first, { title: '新标题', tags: ['a'] }, { library, index });
    expect(library.ops).toEqual([]);
  });

  it('anchor 找不到时抛错；文件 id 不符时抛 ClipMismatchError', async () => {
    const [first] = await threeQuotes();
    if (!first?.quote) throw new Error('缺少摘录');
    const lost = { ...first, quote: { ...first.quote, anchor: '2026-10-07 09:00 · [跳回原文](https://nowhere/)' } };
    await expect(applyEdits(lost, { note: 'x' }, { library, index })).rejects.toThrow('摘录文件里找不到这一条');
    const other = { ...first, quote: { ...first.quote, fileId: 'OTHER' } };
    await expect(applyEdits(other, { note: 'x' }, { library, index })).rejects.toMatchObject({ name: 'ClipMismatchError' });
  });
});

describe('摘录回退：右键选中文字', () => {
  it('回退到 selectionText 的纯文本先转义，文件里是转义后的文本', async () => {
    const capture = resolveQuoteCapture(null, { pageUrl: PAGE, selectionText: '*value* <stdio.h>' }, { title: TITLE }, new Date(T1));
    savedClip(await saveClip({ capture, snapshot: false }, makeDeps()));
    expect(bodyOf(library.text(FILE) ?? '')).toContain('> \\*value\\* \\<stdio.h\\>');
  });
});

describe('摘录幂等（opId）', () => {
  const withOp = (markdown: string, selectedAt: string, opId: string): Capture =>
    quoteCapture(PAGE, TITLE, { markdown, fragmentUrl: frag(markdown.slice(0, 4)), selectedAt, opId });
  const countAnchors = (md: string) => md.split('\n').filter((l) => / · \[跳回原文\]\(/.test(l)).length;

  it('落盘后出队失败、再次补写：文件里只有 1 条，两次的 clip.id 相同（flushPending + remove 第一次抛错的队列）', async () => {
    library.permissionState = 'prompt';
    const base = makeDeps();
    let removeCalls = 0;
    const deps: SaveDeps = {
      ...base,
      pending: {
        ...base.pending,
        remove: async (item) => {
          if (++removeCalls === 1) throw new Error('出队失败（后台被终止）');
          await base.pending.remove(item);
        },
      },
    };
    await saveClip({ capture: withOp(Q2, T2, 'OP1'), snapshot: false }, deps);
    library.permissionState = 'granted';

    const outcomes: SaveOutcome[] = [];
    await expect(flushPending(deps, (o) => outcomes.push(o))).rejects.toThrow('出队失败');
    expect(countAnchors(library.text(FILE) ?? '')).toBe(1);
    expect(await deps.pending.list()).toHaveLength(1);

    await flushPending(deps, (o) => outcomes.push(o));
    expect(countAnchors(library.text(FILE) ?? '')).toBe(1);
    expect(await deps.pending.list()).toEqual([]);
    expect(outcomes.map((o) => o.state)).toEqual(['saved']);
    // 第二次补写没有再生成新的摘录文件
    expect([...library.files.keys()]).toEqual([FILE]);
  });

  it('直接调用两次同一个 opId：1 条摘录，clip.id 相同、第二次不读不写文件', async () => {
    const deps = makeDeps();
    const capture = withOp(Q2, T2, 'OP1');
    const first = savedClip(await saveClip({ capture, snapshot: false }, deps));
    const before = library.text(FILE);
    library.ops.length = 0;
    const second = savedClip(await saveClip({ capture, snapshot: false }, deps));
    expect(second.id).toBe(first.id);
    expect(library.text(FILE)).toBe(before);
    expect(countAnchors(library.text(FILE) ?? '')).toBe(1);
  });

  it('两个不同 opId 的相同文字：2 条（重复摘录仍允许）', async () => {
    const deps = makeDeps();
    const a = savedClip(await saveClip({ capture: withOp(Q2, T1, 'OP1'), snapshot: false }, deps));
    const b = savedClip(await saveClip({ capture: withOp(Q2, T1, 'OP2'), snapshot: false }, deps));
    expect(b.id).not.toBe(a.id);
    expect(countAnchors(library.text(FILE) ?? '')).toBe(2);
  });

  it('新建摘录时已保存记录提交失败：文件回滚、不登记 opId，重试会真正写入（codex review 第 4 轮）', async () => {
    const deps = makeDeps();
    let putCalls = 0;
    const flaky: SaveDeps = {
      ...deps,
      index: {
        ...deps.index,
        put: async (key, entry) => {
          if (++putCalls === 1) throw new Error('记录写入失败');
          await deps.index.put(key, entry);
        },
      },
    };
    const capture = withOp(Q2, T2, 'OP9');
    const first = await saveClip({ capture, snapshot: false }, flaky);
    expect(first.state).toBe('failed');
    expect(library.text(FILE)).toBeUndefined();

    const second = savedClip(await saveClip({ capture, snapshot: false }, flaky));
    expect(countAnchors(library.text(FILE) ?? '')).toBe(1);
    expect(second.file).toBe(FILE);
    expect((await deps.index.get(quoteIndexKey(PAGE)))?.file).toBe(FILE);
  });
});
