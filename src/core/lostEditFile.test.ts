// 批注草稿文件（ALAG-20）：文件名、版式、只列改过的字段、摘录的「第 N 条」、英文不含中文。
import { describe, expect, it } from 'vitest';
import type { ClipSummary, LostEdit } from '@/shared/types';
import { CJK, useLocale } from '../../tests/setup/i18n';
import { buildLostEditFile, lostEditFileName, lostEditFileStem, lostEditReason } from './lostEditFile';
import { quoteTimestamp } from './quote';

const clip: ClipSummary = {
  id: '01JDRAFT',
  file: '为什么安静的界面更难做.md',
  title: '为什么安静的界面更难做',
  medium: 'web',
  site: 'example.com',
  source: 'https://example.com/quiet',
  extract: 'full',
  imageCount: 0,
  imageFailures: 0,
  tags: ['设计'],
  note: '',
  savedAt: '2026-10-08T00:00:00.000Z',
};

const quoteClip: ClipSummary = {
  ...clip,
  id: '01JQUOTE',
  medium: 'quote',
  file: '摘录 - 慢思考.md',
  title: '慢思考',
  tags: [],
  quote: { fileId: 'F', entry: 3, anchor: 'a', fragment: true, recreated: false },
};

const AT = '2026-10-08T06:30:00.000Z';

function lost(fields: LostEdit['fields'], c: ClipSummary = clip, errorName = 'NotFoundError'): LostEdit {
  return { id: 'L1', clip: c, fields, error: { name: errorName, message: 'x' }, at: AT };
}

describe('批注草稿文件名', () => {
  it('去掉最后一个扩展名；没有扩展名原样', () => {
    expect(lostEditFileStem('摘录 - 慢思考.md')).toBe('摘录 - 慢思考');
    expect(lostEditFileStem('x.pdf')).toBe('x');
    expect(lostEditFileStem('没有扩展名')).toBe('没有扩展名');
  });

  it('批注草稿 - <原文件名去扩展名>.md；重名加 (2)', () => {
    expect(lostEditFileName(lost({ note: 'a' }), [])).toBe('批注草稿 - 为什么安静的界面更难做.md');
    expect(lostEditFileName(lost({ note: 'a' }), ['批注草稿 - 为什么安静的界面更难做.md'])).toBe('批注草稿 - 为什么安静的界面更难做 (2).md');
  });

  it('原因分类：NotFoundError → missing，ClipMismatchError → replaced，其余 other', () => {
    expect(lostEditReason({ name: 'NotFoundError' })).toBe('missing');
    expect(lostEditReason({ name: 'ClipMismatchError' })).toBe('replaced');
    expect(lostEditReason({ name: 'NotAllowedError' })).toBe('other');
  });
});

describe('批注草稿文件内容', () => {
  it('三个字段都改了：标题、说明、原文链接，然后标题 / 标签 / 批注三段；没有 frontmatter，以单个换行结尾', () => {
    const md = buildLostEditFile(lost({ title: '新标题', tags: ['设计', '读书'], note: '第一行\n第二行' }));
    expect(md).toBe(
      [
        '# 批注草稿 - 为什么安静的界面更难做',
        '',
        `这是 ${quoteTimestamp(AT)} 在工具栏面板里写的修改，没能写进「为什么安静的界面更难做.md」（文件不在剪藏库里，可能已被移动或改名）。`,
        '',
        '[原文](https://example.com/quiet)',
        '',
        '## 标题',
        '新标题',
        '',
        '## 标签',
        '设计、读书',
        '',
        '## 批注',
        '第一行\n第二行',
        '',
      ].join('\n'),
    );
    expect(md.startsWith('---')).toBe(false);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('只含改过的字段：只改了标签就只有标签一段；原因按错误分类', () => {
    const md = buildLostEditFile(lost({ tags: ['论文'] }, clip, 'ClipMismatchError'));
    expect(md).toContain('## 标签\n论文\n');
    expect(md).not.toContain('## 标题');
    expect(md).not.toContain('## 批注');
    expect(md).toContain('（原路径现在是另一个文件）');
    expect(buildLostEditFile(lost({ note: 'x' }, clip, 'NotAllowedError'))).toContain('（NotAllowedError）');
  });

  it('摘录剪藏：批注前先写一行「第 N 条」，空一行再写批注', () => {
    const md = buildLostEditFile(lost({ note: '这里的「慢」是指延迟回应。' }, quoteClip));
    expect(md.startsWith('# 批注草稿 - 摘录 - 慢思考\n')).toBe(true);
    expect(md).toContain('## 批注\n第 3 条\n\n这里的「慢」是指延迟回应。\n');
    expect(md.endsWith('这里的「慢」是指延迟回应。\n')).toBe(true);
  });

  it('摘录文件里找不到这一条（QuoteEntryNotFound）：原因句写“摘录文件里找不到这一条”（codex review 第 2 轮）', () => {
    expect(lostEditReason({ name: 'QuoteEntryNotFound' })).toBe('entry-missing');
    expect(buildLostEditFile(lost({ note: 'x' }, quoteClip, 'QuoteEntryNotFound'))).toContain('没能写进「摘录 - 慢思考.md」（摘录文件里找不到这一条）。');
    useLocale('en');
    expect(buildLostEditFile(lost({ note: 'x' }, { ...quoteClip, file: 'Quotes - Slow thinking.md' }, 'QuoteEntryNotFound'))).toContain('(the quote entry is no longer in the file).');
  });

  it('en：文件名与内容不含中日韩字符', () => {
    useLocale('en');
    const enClip: ClipSummary = { ...clip, file: 'Why quiet interfaces are harder.md', title: 'Why quiet interfaces are harder', tags: ['design'] };
    const edit = lost({ title: 'New title', tags: ['design', 'reading'], note: 'note' }, enClip);
    expect(lostEditFileName(edit, [])).toBe('Note draft - Why quiet interfaces are harder.md');
    const md = buildLostEditFile(edit);
    expect(md).not.toMatch(CJK);
    expect(md).toContain('## Tags\ndesign, reading\n');
    expect(md).toContain('[Source](https://example.com/quiet)');
    const quoteMd = buildLostEditFile(lost({ note: 'slow' }, { ...quoteClip, file: 'Quotes - Slow thinking.md' }, 'ClipMismatchError'));
    expect(quoteMd).not.toMatch(CJK);
    expect(quoteMd).toContain('#3\n\nslow\n');
  });
});
