import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { buildBookmarkMarkdown, buildStreamMarkdown } from '@/core/document';
import { emitFrontmatter } from '@/core/frontmatter';
import { serializeMediaMeta, type MediaMeta } from '@/core/media';
import { MemoryLibrary } from '@/io/memoryLibrary';
import { createSavedIndex, type SavedIndex } from '@/io/savedIndex';
import type { ClipSummary } from '@/shared/types';
import { applyEdits } from './applyEdits';

const SOURCE = 'https://example.com/post';
const ID = '01JEDIT0000000000000000001';

function clipFile(): string {
  return (
    emitFrontmatter({
      id: ID,
      source: SOURCE,
      medium: 'web',
      title: '原标题',
      author: '',
      published: '',
      captured: new Date('2026-10-06T00:00:00Z'),
      tags: [],
      note: '',
      extract: 'full',
    }) + `\n# 原标题\n\n[原文](${SOURCE})\n\n正文。\n`
  );
}

const clip: ClipSummary = {
  id: ID,
  file: '原标题.md',
  title: '原标题',
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

let library: MemoryLibrary;
let index: SavedIndex;
let original: string;

beforeEach(async () => {
  fakeBrowser.reset();
  library = new MemoryLibrary();
  index = createSavedIndex();
  original = clipFile();
  library.files.set('原标题.md', original);
  await index.put(SOURCE, {
    id: ID,
    file: '原标题.md',
    title: '原标题',
    medium: 'web',
    source: SOURCE,
    savedAt: clip.savedAt,
    tags: [],
  });
});

describe('applyEdits', () => {
  it('只改批注时，只改 frontmatter 的 note 行', async () => {
    const next = await applyEdits(clip, { note: '我的批注' }, { library, index });
    expect(next).toEqual({ ...clip, note: '我的批注' });
    expect(library.ops).toEqual([{ op: 'write', path: '原标题.md' }]);
    const before = original.split('\n');
    const after = (library.text('原标题.md') ?? '').split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.map((line, i) => (line === before[i] ? -1 : i)).filter((i) => i >= 0);
    expect(changed).toEqual([10]);
    expect(after[10]).toBe('note: "我的批注"');
  });

  it('改标签时只改 tags 行，已保存记录的 tags 同步', async () => {
    await applyEdits(clip, { tags: ['设计', 'ai'], title: '原标题', note: '' }, { library, index });
    expect(library.text('原标题.md')).toBe(original.replace('tags: []', 'tags: ["设计", "ai"]'));
    expect((await index.get(SOURCE))?.tags).toEqual(['设计', 'ai']);
  });

  it('改标题时写出新文件名、删掉旧文件，已保存记录的 file 同步更新', async () => {
    const next = await applyEdits(clip, { title: '新标题: 第二版' }, { library, index });
    expect(next.file).toBe('新标题- 第二版.md');
    expect(next.title).toBe('新标题: 第二版');
    // 先写新文件，成功后再删旧文件
    expect(library.ops).toEqual([
      { op: 'write', path: '新标题- 第二版.md' },
      { op: 'remove', path: '原标题.md' },
    ]);
    expect(library.files.has('原标题.md')).toBe(false);
    const md = library.text('新标题- 第二版.md') ?? '';
    // frontmatter 的 title 行与正文的 `# 标题` 行同步改，其余字节不变
    expect(md).toBe(
      original.replace('title: "原标题"', 'title: "新标题: 第二版"').replace('\n# 原标题\n', '\n# 新标题: 第二版\n'),
    );
    expect(await index.get(SOURCE)).toMatchObject({ id: ID, file: '新标题- 第二版.md', title: '新标题: 第二版' });
  });

  it('文章剪藏改标题：正文的 # 标题 行同步改', async () => {
    await applyEdits(clip, { title: '换个标题' }, { library, index });
    const md = library.text('换个标题.md') ?? '';
    const body = md.slice(md.indexOf('\n---\n') + 5);
    expect(body).toBe(`\n# 换个标题\n\n[原文](${SOURCE})\n\n正文。\n`);
  });

  it('书签剪藏改标题：只改 [标题](出处) 的链接文字', async () => {
    const bookmark = buildBookmarkMarkdown({
      frontmatter: {
        id: ID,
        source: SOURCE,
        title: '原标题',
        author: '',
        published: '',
        captured: new Date('2026-10-06T00:00:00Z'),
        tags: [],
        note: '',
        extract: 'fallback',
      },
      description: '描述里也有原标题',
      coverPath: '',
    });
    library.files.set('原标题.md', bookmark);
    await applyEdits(clip, { title: '新[书签]标题' }, { library, index });
    const md = library.text('新[书签]标题.md') ?? '';
    expect(md).toBe(
      bookmark
        .replace('title: "原标题"', 'title: "新[书签]标题"')
        .replace(`\n[原标题](${SOURCE})\n`, `\n[新\\[书签\\]标题](${SOURCE})\n`),
    );
    expect(md).toContain('\n描述里也有原标题\n');
  });

  it('首行已被用户改过：保持不动，frontmatter 照常改', async () => {
    const edited = original.replace('\n# 原标题\n', '\n# 原标题（我改过的）\n');
    library.files.set('原标题.md', edited);
    await applyEdits(clip, { title: '新标题' }, { library, index });
    expect(library.text('新标题.md')).toBe(edited.replace('title: "原标题"', 'title: "新标题"'));
  });

  it('新标题与别的文件重名时加序号', async () => {
    library.files.set('别的.md', 'x');
    const next = await applyEdits(clip, { title: '别的' }, { library, index });
    expect(next.file).toBe('别的 (2).md');
    expect(library.text('别的.md')).toBe('x');
  });

  it('新标题清洗后文件名不变时原地写，不删文件', async () => {
    const next = await applyEdits(clip, { title: '  原标题  ' }, { library, index });
    expect(next.file).toBe('原标题.md');
    expect(library.ops).toEqual([{ op: 'write', path: '原标题.md' }]);
  });

  it('字段没有变化时，不发生任何写入', async () => {
    const next = await applyEdits(clip, { title: '原标题', tags: [], note: '' }, { library, index });
    expect(next).toBe(clip);
    expect(await applyEdits(clip, {}, { library, index })).toBe(clip);
    expect(library.ops).toEqual([]);
    expect(library.text('原标题.md')).toBe(original);
  });

  it('原地改标签时记录提交失败：重试时文件已无改动，仍补齐已保存记录（codex review 合并前复审）', async () => {
    let failOnce = true;
    const flaky: SavedIndex = {
      ...index,
      updateById: (...args) => {
        if (failOnce) {
          failOnce = false;
          return Promise.reject(new Error('storage quota'));
        }
        return index.updateById(...args);
      },
    };
    await expect(applyEdits(clip, { tags: ['new-tag'] }, { library, index: flaky })).rejects.toThrow('storage quota');
    expect(library.text('原标题.md')).toContain('tags: ["new-tag"]');
    expect((await index.get(SOURCE))?.tags).toEqual([]);
    const next = await applyEdits(clip, { tags: ['new-tag'] }, { library, index: flaky });
    expect(next.tags).toEqual(['new-tag']);
    expect((await index.get(SOURCE))?.tags).toEqual(['new-tag']);
  });

  it('已保存记录已被更新的快照覆盖时，不改那条记录', async () => {
    await index.put(SOURCE, { ...(await index.get(SOURCE))!, id: 'NEWER', file: '原标题 (2).md' });
    await applyEdits(clip, { title: '改名' }, { library, index });
    expect(await index.get(SOURCE)).toMatchObject({ id: 'NEWER', file: '原标题 (2).md' });
  });
});

describe('applyEdits：媒体剪藏与流媒体剪藏（ALAG-4）', () => {
  const MEDIA_ID = '01JMEDIAEDIT00000000000001';
  const MEDIA_URL = 'https://cdn.sspai.com/2026/cover@2x.jpg';
  const FILE = '少数派年度盘点 - cover@2x.jpg';
  const META_PATH = `.meta/${MEDIA_ID}.json`;
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const meta: MediaMeta = {
    id: MEDIA_ID,
    file: FILE,
    source: 'https://sspai.com/post/90002',
    media_url: MEDIA_URL,
    medium: 'image',
    title: '少数派年度盘点',
    site: 'sspai.com',
    captured: '2026-10-07T08:40:00.000Z',
    bytes: jpg.byteLength,
    mime: 'image/jpeg',
    tags: [],
    note: '',
  };
  const mediaClip: ClipSummary = {
    id: MEDIA_ID,
    file: FILE,
    title: '少数派年度盘点',
    medium: 'image',
    site: 'sspai.com',
    source: MEDIA_URL,
    extract: 'full',
    imageCount: 0,
    imageFailures: 0,
    tags: [],
    note: '',
    savedAt: '2026-10-07T08:40:00.000Z',
    media: { kind: 'image', bytes: jpg.byteLength },
  };

  beforeEach(async () => {
    library.files.set(FILE, jpg);
    library.files.set(META_PATH, serializeMediaMeta(meta));
    await index.put(MEDIA_URL, { id: MEDIA_ID, file: FILE, title: '少数派年度盘点', medium: 'image', source: MEDIA_URL, savedAt: mediaClip.savedAt, tags: [] });
  });

  it('改标签、批注写进 .meta/<id>.json；媒体文件字节和文件名不变；传 title 不生效', async () => {
    const next = await applyEdits(mediaClip, { title: '想改的标题', tags: ['设计'], note: '好看' }, { library, index });
    expect(next).toEqual({ ...mediaClip, tags: ['设计'], note: '好看' });
    expect(library.ops).toEqual([{ op: 'write', path: META_PATH }]);
    expect(library.files.get(FILE)).toEqual(jpg);
    expect([...library.files.keys()].filter((k) => !k.startsWith('.meta/') && k !== '原标题.md')).toEqual([FILE]);
    expect(library.text(META_PATH)).toBe(serializeMediaMeta({ ...meta, tags: ['设计'], note: '好看' }));
    expect(await index.get(MEDIA_URL)).toMatchObject({ id: MEDIA_ID, file: FILE, title: '少数派年度盘点', tags: ['设计'] });
  });

  it('只传 title：不写任何文件', async () => {
    const next = await applyEdits(mediaClip, { title: '想改的标题' }, { library, index });
    expect(next).toBe(mediaClip);
    expect(library.ops).toEqual([]);
  });

  it('service worker 重启后重建的剪藏信息（没有 media，只有 medium 与非 .md 文件名）同样走侧档', async () => {
    const { media: _media, ...rebuilt } = mediaClip;
    void _media;
    await applyEdits(rebuilt, { note: '重启后' }, { library, index });
    expect(library.ops).toEqual([{ op: 'write', path: META_PATH }]);
    expect(JSON.parse(library.text(META_PATH) ?? '{}')).toMatchObject({ note: '重启后' });
  });

  it('侧档 id 不符时抛 ClipMismatchError，不写文件', async () => {
    library.files.set(META_PATH, serializeMediaMeta({ ...meta, id: 'SOMEONE-ELSE' }));
    await expect(applyEdits(mediaClip, { note: 'x' }, { library, index })).rejects.toMatchObject({ name: 'ClipMismatchError' });
    expect(library.ops).toEqual([]);
  });

  it('流媒体剪藏改标题：正文 # 标题 同步、文件改名（沿用文章剪藏的逻辑）', async () => {
    const STREAM_ID = '01JSTREAMEDIT0000000000001';
    const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const md = buildStreamMarkdown({
      frontmatter: {
        id: STREAM_ID,
        source: WATCH,
        medium: 'video',
        title: '原视频标题',
        author: 'Rick Astley',
        published: '',
        captured: new Date('2026-10-07T00:00:00Z'),
        tags: [],
        note: '',
        extract: 'full',
      },
      stream: { platform: 'youtube', video_id: 'dQw4w9WgXcQ', embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ', duration: 213, cover: '' },
      coverRef: '',
      info: { platform: 'youtube', medium: 'video', duration: 213 },
      description: '简介',
    });
    library.files.set('原视频标题.md', md);
    const streamClip: ClipSummary = {
      ...clip,
      id: STREAM_ID,
      file: '原视频标题.md',
      title: '原视频标题',
      medium: 'video',
      source: WATCH,
      stream: { platform: 'youtube', duration: 213, medium: 'video' },
    };
    await index.put(WATCH, { id: STREAM_ID, file: '原视频标题.md', title: '原视频标题', medium: 'video', source: WATCH, savedAt: clip.savedAt, tags: [] });
    const next = await applyEdits(streamClip, { title: '新视频标题' }, { library, index });
    expect(next.file).toBe('新视频标题.md');
    expect(library.files.has('原视频标题.md')).toBe(false);
    expect(library.text('新视频标题.md')).toBe(md.replace('title: "原视频标题"', 'title: "新视频标题"').replace('\n# 原视频标题\n', '\n# 新视频标题\n'));
    expect(await index.get(WATCH)).toMatchObject({ file: '新视频标题.md', title: '新视频标题' });
  });
});
