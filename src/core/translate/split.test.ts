import { describe, expect, it } from 'vitest';
import { joinPieces, MAX_PIECE_CHARS, splitLong } from './split';

describe('splitLong', () => {
  it('短文本原样返回', () => {
    expect(splitLong('Hello world.')).toEqual(['Hello world.']);
    expect(splitLong('')).toEqual(['']);
  });

  it('5000 字符的多句英文切成每块 ≤ MAX_PIECE_CHARS 且拼回原文', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const text = sentence.repeat(Math.ceil(5000 / sentence.length)).slice(0, 5000);
    const pieces = splitLong(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(MAX_PIECE_CHARS);
    expect(pieces.join('')).toBe(text);
  });

  it('4500 字符无标点的长串硬切成 2000/2000/500', () => {
    const text = 'a'.repeat(4500);
    expect(splitLong(text)).toEqual(['a'.repeat(2000), 'a'.repeat(2000), 'a'.repeat(500)]);
  });
});

describe('joinPieces', () => {
  it('中文用空串连接', () => {
    expect(joinPieces([' 你好 ', ' 世界 '], 'zh-CN')).toBe('你好世界');
  });

  it('英文用空格连接', () => {
    expect(joinPieces([' Hello ', ' world '], 'en')).toBe('Hello world');
  });
});
