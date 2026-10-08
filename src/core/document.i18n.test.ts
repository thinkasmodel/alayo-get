// 文章、流媒体剪藏文件里随语言变化的固定文字，以及文件名、平台名、媒体类别名（ALAG-7 brief A §8；样张 designs/alag-6-7/FilesEn.dc.html）。
import { beforeEach, describe, expect, it } from 'vitest';
import { CJK, useLocale } from '../../tests/setup/i18n';
import { buildArticleMarkdown, buildStreamMarkdown, streamPlayLine } from './document';
import { clipBaseName } from './filename';
import { mediaKindLabel } from './media';
import { platformLabel } from './stream';

const SOURCE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const fm = (title: string) => ({ id: '01K6Z8M3', source: SOURCE, title, author: 'Rick Astley', published: '', captured: new Date('2026-10-07T08:20:00Z'), tags: [], note: '' });
const bodyOf = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, '');

beforeEach(() => useLocale('en'));

describe('英文：文章剪藏', () => {
  it('标题下是 [Source](…)', () => {
    const md = buildArticleMarkdown({ frontmatter: fm('A title'), body: 'Body.' });
    expect(bodyOf(md)).toBe(`\n# A title\n\n[Source](${SOURCE})\n\nBody.\n`);
  });
});

describe('英文：流媒体剪藏', () => {
  const stream = { platform: 'youtube' as const, video_id: 'dQw4w9WgXcQ', embed: '', duration: 213, cover: '' };

  it('平台视频：[Source]、▶ YouTube video (3:33) · 作者', () => {
    const md = buildStreamMarkdown({
      frontmatter: { ...fm('Never Gonna Give You Up'), medium: 'video', extract: 'full' },
      stream,
      coverRef: '',
      info: { platform: 'youtube', medium: 'video', duration: 213 },
      description: '',
    });
    expect(bodyOf(md)).toBe(`\n# Never Gonna Give You Up\n\n[Source](${SOURCE})\n\n▶ YouTube video (3:33) · Rick Astley\n`);
  });

  it('▶ 行：X video 不重复 video；直链写 Video link · 大小 / Audio link', () => {
    expect(streamPlayLine({ platform: 'x', medium: 'video', duration: 42 }, '')).toBe('▶ X video (0:42)');
    expect(streamPlayLine({ platform: 'bilibili', medium: 'video', duration: null }, '')).toBe('▶ Bilibili video');
    expect(streamPlayLine({ platform: 'youtube', medium: 'audio', duration: 60 }, '')).toBe('▶ YouTube audio (1:00)');
    expect(streamPlayLine({ platform: 'other', medium: 'video', duration: null, bytes: 1.8 * 1024 ** 3 }, '')).toBe('▶ Video link · 1.8 GB');
    expect(streamPlayLine({ platform: 'other', medium: 'audio', duration: null }, '')).toBe('▶ Audio link');
  });

  it('直链：From [页面标题](页面地址)', () => {
    const md = buildStreamMarkdown({
      frontmatter: { ...fm('clip.mp4'), source: 'https://cdn.example.com/clip.mp4', medium: 'video', extract: 'partial' },
      stream: { ...stream, platform: 'other', video_id: '', duration: null },
      coverRef: '',
      info: { platform: 'other', medium: 'video', duration: null, page: { url: 'https://example.com/page', title: 'Page [title]' }, bytes: null },
      description: '',
    });
    expect(bodyOf(md)).toBe('\n# clip.mp4\n\n[Source](https://cdn.example.com/clip.mp4)\n\n▶ Video link\n\nFrom [Page \\[title\\]](https://example.com/page)\n');
    expect(md).not.toMatch(CJK);
  });
});

describe('英文：文件名、平台名、媒体类别名', () => {
  it('标题为空时文件名 Untitled clip', () => {
    expect(clipBaseName('')).toBe('Untitled clip');
    expect(clipBaseName('  ...  ')).toBe('Untitled clip');
  });

  it('平台名', () => {
    expect(['youtube', 'bilibili', 'x', 'baidupan', '115', 'quark'].map((p) => platformLabel(p as never))).toEqual(['YouTube', 'Bilibili', 'X video', 'Baidu Netdisk', '115', 'Quark']);
    expect(platformLabel('other', 'video')).toBe('Video link');
    expect(platformLabel('other', 'audio')).toBe('Audio link');
  });

  it('媒体类别：独立用首字母大写，句中用小写', () => {
    expect((['image', 'audio', 'video', 'pdf'] as const).map((k) => mediaKindLabel(k))).toEqual(['Image', 'Audio', 'Video', 'PDF']);
    expect((['image', 'audio', 'video', 'pdf'] as const).map((k) => mediaKindLabel(k, true))).toEqual(['image', 'audio', 'video', 'PDF']);
  });
});

describe('中文：句中类别名与独立写法相同', () => {
  it('图片、音频、视频、PDF', () => {
    useLocale('zh_CN');
    expect((['image', 'audio', 'video', 'pdf'] as const).map((k) => mediaKindLabel(k, true))).toEqual(['图片', '音频', '视频', 'PDF']);
  });
});
