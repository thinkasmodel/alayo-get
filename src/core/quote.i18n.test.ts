// 摘录文件的英文版式与跨语言追加、改批注（ALAG-7 brief A §5、§8；样张 designs/alag-6-7/FilesEn.dc.html）。
import { describe, expect, it, vi } from 'vitest';
import { useLocale } from '../../tests/setup/i18n';
import { ANCHOR_LINE, appendQuoteEntry, buildQuoteFile, countQuoteEntries, quoteAnchor, quoteEntryText, readQuoteNote, replaceQuoteNote } from './quote';

vi.stubEnv('TZ', 'Asia/Shanghai');

const SOURCE = 'https://example.com/thinking-fast-and-slow';
const T1 = '2026-10-07T08:31:00.000Z'; // 16:31
const T2 = '2026-10-07T08:35:00.000Z'; // 16:35
const T3 = '2026-10-07T08:40:00.000Z'; // 16:40
const frag = (text: string) => `${SOURCE}#:~:text=${encodeURIComponent(text)}`;

/** 在当前语言下新建一个两条摘录的文件，第一条带批注；返回文件与两条的 anchor。 */
function twoEntryFile(): { md: string; a1: string; a2: string } {
  const a1 = quoteAnchor(T1, frag('System 1'), '');
  let md = buildQuoteFile({ id: 'F1', source: SOURCE, title: 'Thinking, Fast and Slow notes', captured: new Date(T1), firstEntry: quoteEntryText('System 1 operates automatically.', a1) });
  md = replaceQuoteNote(md, a1, '第一条的批注');
  const a2 = quoteAnchor(T2, frag('Nothing in life'), md);
  md = appendQuoteEntry(md, quoteEntryText('Nothing in life is as important as you think it is.', a2));
  return { md, a1, a2 };
}

describe('英文环境写的摘录文件', () => {
  it('标题 # Quotes - {title}、[Source](…)、时间行 [Jump to source](…)', () => {
    useLocale('en');
    const anchor = quoteAnchor(T1, frag('System 1'), '');
    expect(anchor).toBe(`2026-10-07 16:31 · [Jump to source](${SOURCE}#:~:text=System%201)`);
    const md = buildQuoteFile({ id: 'F1', source: SOURCE, title: 'Thinking, Fast and Slow notes', captured: new Date(T1), firstEntry: quoteEntryText('> a', anchor) });
    const body = md.replace(/^---\n[\s\S]*?\n---\n/, '');
    expect(body).toBe(`\n# Quotes - Thinking, Fast and Slow notes\n\n[Source](${SOURCE})\n\n> > a\n\n${anchor}\n`);
  });

  it('anchor 行按形状识别：中文、英文链接文字都算，带序号的也算', () => {
    for (const line of [
      '2026-10-07 16:31 · [跳回原文](https://a/)',
      '2026-10-07 16:31 · [Jump to source](https://a/)',
      '2026-10-07 16:31 (2) · [Jump to source](https://a/)',
    ]) {
      expect(ANCHOR_LINE.test(line), line).toBe(true);
    }
    expect(ANCHOR_LINE.test('2026-10-07 16:31 · [](https://a/)')).toBe(false);
    expect(ANCHOR_LINE.test('> 2026-10-07 16:31 · [Jump to source](https://a/)')).toBe(false);
  });

  it('找不到这一条时抛英文错误', () => {
    useLocale('en');
    expect(() => replaceQuoteNote('> a\n', '2026-10-07 16:31 · [Jump to source](https://a/)', 'n')).toThrow('This quote isn’t in the quotes file');
  });
});

describe('跨语言摘录（验收第 4 条）', () => {
  it('中文旧文件（两条“跳回原文”）→ 英文环境：条数 2，追加英文条目后 3，改旧条目批注成功，英文条目不受影响', () => {
    const { md: zhFile, a1, a2 } = twoEntryFile();
    expect(a1).toContain('[跳回原文](');
    expect(zhFile).toContain('# 摘录 - Thinking, Fast and Slow notes');

    useLocale('en');
    expect(countQuoteEntries(zhFile)).toBe(2);
    const a3 = quoteAnchor(T3, frag('focusing'), zhFile);
    expect(a3).toBe(`2026-10-07 16:40 · [Jump to source](${SOURCE}#:~:text=focusing)`);
    const appended = appendQuoteEntry(zhFile, quoteEntryText('The focusing illusion.', a3));
    expect(countQuoteEntries(appended)).toBe(3);
    // 旧条目原样不动
    expect(appended.startsWith(zhFile.replace(/\s+$/, ''))).toBe(true);

    const edited = replaceQuoteNote(appended, a2, 'Compare with the focusing illusion chapter');
    expect(readQuoteNote(edited, a2)).toBe('Compare with the focusing illusion chapter');
    expect(readQuoteNote(edited, a1)).toBe('第一条的批注');
    expect(readQuoteNote(edited, a3)).toBe('');
    expect(edited.endsWith(`> The focusing illusion.\n\n${a3}\n`)).toBe(true);
    expect(countQuoteEntries(edited)).toBe(3);

    // 改英文条目的批注同样只动它自己
    const edited2 = replaceQuoteNote(edited, a3, 'Note on the English entry');
    expect(readQuoteNote(edited2, a3)).toBe('Note on the English entry');
    expect(readQuoteNote(edited2, a2)).toBe('Compare with the focusing illusion chapter');
  });

  it('英文旧文件（两条“Jump to source”）→ 中文环境：条数 2，追加中文条目后 3，改旧条目批注成功，中文条目不受影响', () => {
    useLocale('en');
    const { md: enFile, a1, a2 } = twoEntryFile();
    expect(a1).toContain('[Jump to source](');
    expect(enFile).toContain('# Quotes - Thinking, Fast and Slow notes');

    useLocale('zh_CN');
    expect(countQuoteEntries(enFile)).toBe(2);
    const a3 = quoteAnchor(T3, frag('focusing'), enFile);
    expect(a3).toBe(`2026-10-07 16:40 · [跳回原文](${SOURCE}#:~:text=focusing)`);
    const appended = appendQuoteEntry(enFile, quoteEntryText('聚焦错觉。', a3));
    expect(countQuoteEntries(appended)).toBe(3);
    expect(appended.startsWith(enFile.replace(/\s+$/, ''))).toBe(true);

    const edited = replaceQuoteNote(appended, a2, '和聚焦错觉那一章对照');
    expect(readQuoteNote(edited, a2)).toBe('和聚焦错觉那一章对照');
    expect(readQuoteNote(edited, a1)).toBe('第一条的批注');
    expect(readQuoteNote(edited, a3)).toBe('');
    expect(edited.endsWith(`> 聚焦错觉。\n\n${a3}\n`)).toBe(true);

    const edited2 = replaceQuoteNote(edited, a3, '中文条目的批注');
    expect(readQuoteNote(edited2, a3)).toBe('中文条目的批注');
    expect(readQuoteNote(edited2, a2)).toBe('和聚焦错觉那一章对照');
  });
});
