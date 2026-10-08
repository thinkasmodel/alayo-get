import { describe, expect, it, vi } from 'vitest';
import { countQuoteEntries, escapeMarkdownText, quoteAnchor, quoteEntryText, quoteTimestamp, readQuoteNote, replaceQuoteNote } from './quote';

vi.stubEnv('TZ', 'Asia/Shanghai');

const A1 = '2026-10-07 16:31 · [跳回原文](https://a/#:~:text=x)';
const A2 = '2026-10-07 16:31 (2) · [跳回原文](https://a/)';

describe('摘录的版式', () => {
  it('时间是本地 YYYY-MM-DD HH:mm', () => {
    expect(quoteTimestamp('2026-10-06T23:05:59.000Z')).toBe('2026-10-07 07:05');
  });

  it('每行加 > ，空行写 >（含只有空白的行），空一行接 anchor', () => {
    expect(quoteEntryText('\n第一段\n\n  \n- 列表\n', A1)).toBe(`> 第一段\n>\n>\n> - 列表\n\n${A1}`);
  });

  it('anchor 与已有行相同时依次加 (2)、(3)', () => {
    const existing = `x\n\n2026-10-07 16:31 · [跳回原文](https://a/)\n\n${A2}\n`;
    expect(quoteAnchor('2026-10-07T08:31:30.000Z', 'https://a/', existing)).toBe('2026-10-07 16:31 (3) · [跳回原文](https://a/)');
    expect(quoteAnchor('2026-10-07T08:31:30.000Z', 'https://a/', '')).toBe('2026-10-07 16:31 · [跳回原文](https://a/)');
  });

  it('条数按 anchor 行数，带序号的也算；正文里的“跳回原文”不算', () => {
    expect(countQuoteEntries(`> 引文里提到 [跳回原文](x)\n\n${A1}\n\n> b\n\n${A2}\n`)).toBe(2);
  });

  it('anchor 不止一处时同样抛错', () => {
    expect(() => replaceQuoteNote(`> a\n\n${A1}\n\n> b\n\n${A1}\n`, A1, 'n')).toThrow('摘录文件里找不到这一条');
  });

  it('批注区到下一个以 > 开头的段落为止：批注里中间的空行原样保留', () => {
    const md = `> a\n\n${A1}\n\n旧批注\n\n> b\n\n${A2}\n`;
    expect(replaceQuoteNote(md, A1, '新批注第一段\n\n第二段')).toBe(`> a\n\n${A1}\n\n新批注第一段\n\n第二段\n\n> b\n\n${A2}\n`);
    expect(replaceQuoteNote(md, A1, '  ')).toBe(`> a\n\n${A1}\n\n> b\n\n${A2}\n`);
  });
});

describe('escapeMarkdownText：纯文本转义后当 Markdown', () => {
  it('行内符号加反斜杠', () => {
    expect(escapeMarkdownText('*value* <stdio.h>')).toBe('\\*value\\* \\<stdio.h\\>');
    expect(escapeMarkdownText('a\\b `c` _d_ [e] ~f~ g|h')).toBe('a\\\\b \\`c\\` \\_d\\_ \\[e\\] \\~f\\~ g\\|h');
  });

  it('行首的 #、>、-、+、数字加 . 或 )，换行保留', () => {
    expect(escapeMarkdownText('# a\n1. b')).toBe('\\# a\n1\\. b');
    expect(escapeMarkdownText('> q\n- x\n+ y\n12) z\nplain 3. ok')).toBe('\\> q\n\\- x\n\\+ y\n12\\) z\nplain 3. ok');
  });
});

describe('readQuoteNote：读一条摘录的批注区', () => {
  it('返回批注区内容（去首尾空白，中间空行保留），到下一条摘录为止', () => {
    const md = `> a\n\n${A1}\n\n 第一段\n\n第二段 \n\n> b\n\n${A2}\n\nb 的批注\n`;
    expect(readQuoteNote(md, A1)).toBe('第一段\n\n第二段');
    expect(readQuoteNote(md, A2)).toBe('b 的批注');
  });

  it('没有批注区返回空串；anchor 找不到或不唯一返回 null', () => {
    expect(readQuoteNote(`> a\n\n${A1}\n\n> b\n\n${A2}\n`, A1)).toBe('');
    expect(readQuoteNote(`> a\n\n${A1}\n`, A2)).toBeNull();
    expect(readQuoteNote(`> a\n\n${A1}\n\n> b\n\n${A1}\n`, A1)).toBeNull();
  });
});
