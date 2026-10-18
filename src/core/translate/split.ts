// 长段切分与拼接：本机翻译按句消化，长段先切成 ≤ MAX_PIECE_CHARS 的块，译完按语言习惯拼回（ALAG-25 §5）。
import { toApiTag } from './language';

export const MAX_PIECE_CHARS = 2000;

/**
 * 超过 max 的文本用 Intl.Segmenter 切句，按顺序贪心合并成 ≤ max 的块；
 * 单句超过 max 时按 max 硬切。所有块拼起来等于原文。
 */
export function splitLong(text: string, max = MAX_PIECE_CHARS): string[] {
  if (text.length <= max) return [text];

  const pieces: string[] = [];
  let current = '';
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  for (const { segment } of segmenter.segment(text)) {
    let sentence = segment;
    if (sentence.length > max) {
      if (current) {
        pieces.push(current);
      }
      while (sentence.length > max) {
        pieces.push(sentence.slice(0, max));
        sentence = sentence.slice(max);
      }
      current = sentence;
      continue;
    }
    if (current.length + sentence.length <= max) {
      current += sentence;
    } else {
      if (current) pieces.push(current);
      current = sentence;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** 译文拼接：中文、日文不用空格，其余（含韩文）用一个空格；每块先 trim。 */
export function joinPieces(pieces: string[], target: string): string {
  const tag = toApiTag(target);
  const separator = tag === 'zh' || tag === 'zh-Hant' || tag === 'ja' ? '' : ' ';
  return pieces.map((piece) => piece.trim()).join(separator);
}
