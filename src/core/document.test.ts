import { describe, expect, it } from 'vitest';
import { buildArticleMarkdown, updateDisplayedTitle } from './document';

const SOURCE = 'https://x.com/alice/status/1';

/** X 长文剪藏：frontmatter 标题带 @handle 前缀，正文一级标题是长文标题本身。 */
function longform(title: string, heading: string): string {
  return buildArticleMarkdown({
    frontmatter: { id: '01JDOC', source: SOURCE, title, author: '', published: '', captured: new Date('2026-10-07T00:00:00Z'), tags: [], note: '' },
    body: '正文。',
    medium: 'x',
    heading,
  });
}

const h1 = (md: string) => md.split('\n').find((line) => line.startsWith('# '));

describe('updateDisplayedTitle：X 长文的一级标题（codex review 第 2 轮）', () => {
  it('改成带前缀的新标题：正文一级标题换成去前缀的新标题', () => {
    const md = updateDisplayedTitle(longform('@alice - Old title', 'Old title'), '@alice - Old title', '@alice - New title', SOURCE);
    expect(h1(md)).toBe('# New title');
  });

  it('改成不带前缀的新标题：原样用', () => {
    const md = updateDisplayedTitle(longform('@alice - Old title', 'Old title'), '@alice - Old title', 'New title', SOURCE);
    expect(h1(md)).toBe('# New title');
  });

  it('正文一级标题被手改过：保持原样', () => {
    const before = longform('@alice - Old title', 'Old title').replace('# Old title', '# 我改过的标题');
    expect(updateDisplayedTitle(before, '@alice - Old title', '@alice - New title', SOURCE)).toBe(before);
  });

  it('原规则不变：一级标题与完整旧标题一致时整体替换', () => {
    const md = updateDisplayedTitle(longform('@alice - Old', '@alice - Old'), '@alice - Old', '@alice - New', SOURCE);
    expect(h1(md)).toBe('# @alice - New');
  });
});
