// 对照译文（ALAG-26）：识别要翻的块、准备送翻纯文本、渲染译文行，并在当前文件上插入译文。
// 纯函数，node 环境可测；文件格式的权威是 src/core/__fixtures__/bilingual/ 下的金样例。
import { toApiTag } from './translate/language';
import type { Medium } from '@/shared/types';

/** 要翻的单元种类。 */
export type UnitKind = 'heading' | 'paragraph' | 'list-item' | 'list-paragraph' | 'quote-paragraph';

/** 原文里的一个要翻单元。 */
export interface Unit {
  kind: UnitKind;
  /** 在整份 Markdown（含 frontmatter）里的起止行号，从 0 起。 */
  start: number;
  end: number;
  /** 原文的行文字（不含换行），applyTranslations 据此重新定位。 */
  sourceLines: string[];
  /** 每一段的送翻文本在 plan.segments 里的下标。 */
  segmentIndexes: number[];
  /** 与 segmentIndexes 对应的送翻纯文本（行内代码已换成占位符）。 */
  segmentTexts: string[];
  /** 与 segmentIndexes 对应的行内代码原文，用于还原占位符。 */
  segmentCodes: string[][];
  /** 列表单元译文行的缩进空格数（内容列）。 */
  indent?: number;
  /** 标题级别（1–6）。 */
  headingLevel?: number;
  /** 按行翻的段落（含硬换行）：sourceLines 每一行一份译文。 */
  perLine?: boolean;
  /** perLine 时不送翻的行（与 sourceLines 对齐）：原文去掉硬换行标记后的样子；null 表示这一行要翻。 */
  passthrough?: Array<string | null>;
  /** 正文第一个非空行、且是一级 ATX 标题：这一行由扩展自己维护（改标题时同步改），找不到时按免插计。 */
  displayTitle?: boolean;
}

export interface BilingualPlan {
  units: Unit[];
  /** 按原文顺序送去翻译的纯文本。 */
  segments: string[];
}

/** 纯文本转换结果：text 是送去翻译的文本，codes 是各占位符对应的行内代码原文（含反引号）。 */
export interface PlainText {
  text: string;
  codes: string[];
}

const PLACEHOLDER = /⟦c(\d+)⟧/gi;

const BLANK = /^[ \t]*$/;

/** 只去掉首尾的空格与 tab；NBSP 等其他空白是正文。 */
function trimSpaceTab(text: string): string {
  return text.replace(/^[ \t]+|[ \t]+$/g, '');
}

/** 只去掉行首的空格与 tab；NBSP 等其他空白是正文。 */
function trimSpaceTabStart(text: string): string {
  return text.replace(/^[ \t]+/, '');
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX_HEADING = /^(#{1,6}) (.*)$/;
const QUOTE_LINE = /^ {0,3}>/;
const LIST_ITEM = /^([ \t]*)((?:[-*+]|\d+[.)]))([ \t]+)(.*)$/;
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
/** X 作者串的一级标题：`# @handle - …`。 */
const X_HEADING = /^# @[A-Za-z0-9_]{1,15} - /;
/** 引用帖的作者行：`**名字 (@handle)** · …`。 */
const X_QUOTE_AUTHOR = /^\*\*.+\*\*( · .*)?$/;

/**
 * 链接/图片的 `(地址 "标题")`（ALAG-42）：地址是 `<…>` 或不含空白、括号都转义了的串（Turndown 与
 * linkDestination 的写法），标题可选，用 `"…"`、`'…'` 或 `(…)` 括起。地址里有未转义的括号
 * （如 Turndown 把原有反斜杠写成 `\\(`）就认不出，退回旧写法：到第一个未转义的 `)` 为止。
 * Turndown 也不转义标题与地址里原有的反斜杠：`title="C:\"` 写成 `"C:\"`、地址末尾的 `\` 写成 `\)`，
 * 所以双引号标题里后面紧跟 `)` 的 `\"` 当结束引号，退回写法允许 `)` 前有一个反斜杠（与 main 相同）。
 * 每段空白前后都是非空白，反斜杠只能作转义开头，选项互不重叠，未闭合时回溯是线性的。
 */
const LINK_DEST = String.raw`(?:<(?:\\.|[^<>\n\\])*>|(?:\\.|[^\s()\\])+)`;
const LINK_TITLE = String.raw`(?:"(?:[^"\\]|\\[^"]|\\"(?![ \t\n]*\)))*\\?"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\))`;
const LINK_TARGET = String.raw`(?:\([ \t\n]*(?:${LINK_DEST}(?:[ \t\n]+(?:${LINK_TITLE}[ \t\n]*)?)?)?\)|\((?:\\[\s\S]|[^)\\])*\\?\))`;
const LINK_TEXT = String.raw`\[((?:\\.|[^\]\\])*)\]`;
const IMAGE = new RegExp(String.raw`!\[(?:\\.|[^\]\\])*\]${LINK_TARGET}`, 'g');
const LINK = new RegExp(`${LINK_TEXT}${LINK_TARGET}`, 'g');

/**
 * Markdown 的纯文本（送翻用）：行内代码换成占位符；去掉图片、链接只留文字、自动链接去掉尖括号；
 * 去掉强调标记与行内 HTML；反斜杠转义还原；空白合并。
 */
export function plainTextOf(raw: string): PlainText {
  const codes: string[] = [];
  let text = raw.replace(/(`+)([\s\S]*?)\1/g, (match: string) => {
    codes.push(match);
    return `⟦c${codes.length}⟧`;
  });
  // 图片整个去掉（alt 也不翻）。
  text = text.replace(IMAGE, '');
  // 链接只留文字。
  text = text.replace(LINK, '$1');
  // 自动链接（URL 与邮件地址）去掉尖括号，保留地址。
  text = text.replace(/<([A-Za-z][A-Za-z0-9+.-]*:[^<>\s]+)>/g, '$1');
  text = text.replace(/<([^<>\s]+@[^<>\s]+)>/g, '$1');
  // 强调标记（转义过的 `\*`、`\_` 不在此列）。
  text = text.replace(/(?<!\\)\*\*|(?<!\\)__|(?<!\\)~~|(?<!\\)\*|(?<!\\)_/g, '');
  // 行内 HTML 标签。
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, '');
  // 反斜杠转义还原。
  text = text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
  return { text: text.replace(/\s+/g, ' ').trim(), codes };
}

/** 一行里有没有字母（Unicode）。 */
function hasLetters(text: string): boolean {
  return /\p{L}/u.test(text);
}

/** 译文干净到可以直接写回 Markdown：中文/日文标点后的空白去掉（引擎实测会加）。 */
function cleanPunctuation(text: string, target: string): string {
  const tag = toApiTag(target);
  if (tag === 'zh' || tag === 'zh-Hant' || tag === 'ja') {
    return text.replace(/([。！？；：，、）」』])\s+/g, '$1');
  }
  return text;
}

/** 占位符换回行内代码原文；不区分大小写（引擎会把 ⟦c1⟧ 改成 ⟦C1⟧）。 */
function restorePlaceholders(text: string, codes: string[]): string {
  return text.replace(PLACEHOLDER, (match, digits: string) => codes[Number(digits) - 1] ?? match);
}

/** Turndown 的转义表（src/page/extract.ts 使用的 Markdown 方言）；在 SW 里自己实现，不 import turndown。 */
const ESCAPES: Array<[RegExp, string]> = [
  [/\\/g, '\\\\'],
  [/\*/g, '\\*'],
  [/^-/g, '\\-'],
  [/^\+ /g, '\\+ '],
  [/^(=+)/g, '\\$1'],
  [/^(#{1,6}) /g, '\\$1 '],
  [/`/g, '\\`'],
  [/^~~~/g, '\\~~~'],
  [/\[/g, '\\['],
  [/\]/g, '\\]'],
  [/^>/g, '\\>'],
  [/_/g, '\\_'],
  [/^(\d+)\. /g, '$1\\. '],
];

/** 译文按 Turndown 的转义表转义；逐行处理，行首规则对每一行都生效。 */
export function escapeMarkdownTranslation(text: string): string {
  return text
    .split('\n')
    .map((line) => ESCAPES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), line))
    .join('\n');
}

/** 行尾硬换行：一个 `\`（不是转义的 `\\`）或两个以上空格。 */
function hasHardBreak(line: string): boolean {
  if (/[ \t]{2,}$/.test(line)) return true;
  return line.endsWith('\\') && !line.endsWith('\\\\');
}

/** 去掉行尾的硬换行标记（`\` 或空格）；`\\` 是转义的反斜杠，不算硬换行。 */
function stripHardBreak(line: string): string {
  let out = line.replace(/[ \t]+$/, '');
  if (out.endsWith('\\') && !out.endsWith('\\\\')) out = out.slice(0, -1);
  return out;
}

/** 去掉等长反引号配对的代码段（含反引号）；有没配对的反引号返回 null。 */
function stripInlineCode(text: string): string | null {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      out += text[i];
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] === '`') j += 1;
    const length = j - i;
    let k = j;
    let close = -1;
    while (k < text.length) {
      if (text[k] !== '`') {
        k += 1;
        continue;
      }
      let m = k;
      while (m < text.length && text[m] === '`') m += 1;
      if (m - k === length) {
        close = k;
        break;
      }
      k = m;
    }
    if (close === -1) return null;
    out += ' ';
    i = close + length;
  }
  return out;
}

/** 去掉链接/图片目标 `](…)`（只用于检查，保留方括号；目标里的括号可嵌套）。 */
function stripLinkTargets(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf('](', i);
    if (at === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, at + 1);
    let depth = 1;
    let j = at + 2;
    while (j < text.length && depth > 0) {
      if (text[j] === '(') depth += 1;
      else if (text[j] === ')') depth -= 1;
      j += 1;
    }
    if (depth !== 0) break;
    i = j;
  }
  return out;
}

/** 这一行的行内结构是否自足：未转义的链接方括号、反引号、强调标记都成对。 */
function inlineStructuresBalanced(line: string): boolean {
  const clean = line.replace(/\\[\s\S]/g, '');
  const withoutCode = stripInlineCode(clean);
  if (withoutCode === null) return false;
  let text = stripLinkTargets(withoutCode);
  // 自动链接、裸网址里的符号不参与成对检查。
  text = text.replace(/<[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*>/g, '');
  text = text.replace(/<[^<>\s]+@[^<>\s]+>/g, '');
  text = text.replace(/https?:\/\/[^\s\]>)]+/g, '');
  // 词中下划线（snake_case / a__b）在 CommonMark 中不构成强调。
  text = text.replace(/(?<=[\p{L}\p{N}])_+(?=[\p{L}\p{N}])/gu, '');
  const count = (part: string, pattern: RegExp): number => (part.match(pattern) ?? []).length;
  if (count(text, /\[/g) !== count(text, /\]/g)) return false;
  if (count(text, /\*\*/g) % 2 !== 0) return false;
  if (count(text.replace(/\*\*/g, ''), /\*/g) % 2 !== 0) return false;
  if (count(text, /__/g) % 2 !== 0) return false;
  if (count(text.replace(/__/g, ''), /_/g) % 2 !== 0) return false;
  if (count(text, /~~/g) % 2 !== 0) return false;
  return true;
}

/** 整段只有图片/链接/自动链接（`[原文](…)`、卡片链接、`▶ 视频` 行）：不翻。 */
function isLinkOnly(raw: string): boolean {
  // 跨行链接的文字也是正文：不能按「纯链接」跳过（续修 9）。
  if (raw.includes('\n') && /\[[^\]]*\]\(/.test(raw)) return false;
  const rest = trimSpaceTab(raw)
    .replace(IMAGE, '')
    .replace(LINK, '')
    .replace(/<[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]+>/g, '')
    .replace(/<[^<>\s]+@[^<>\s]+>/g, '');
  return BLANK.test(rest);
}

/** 是否是一层引用块的行。 */
function isQuote(line: string): boolean {
  return QUOTE_LINE.test(line);
}

/** 去掉一层引用标记。 */
function stripQuote(line: string): string {
  return line.replace(/^ {0,3}> ?/, '');
}

/** HTML 块行（`<` 开头）；自动链接 `<https://…>` 不算。 */
function isHtmlLine(line: string): boolean {
  const trimmed = trimSpaceTabStart(line);
  if (!trimmed.startsWith('<')) return false;
  // 自动链接（含邮件地址）不是 HTML 块。
  if (/^<[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)) return false;
  if (/^<[^<>\s]+@[^<>\s]+>/.test(trimmed)) return false;
  return true;
}

/** 这一行会不会开始另一个块（用来结束段落）。 */
function startsBlock(line: string): boolean {
  if (ATX_HEADING.test(line) || FENCE_OPEN.test(line) || isQuote(line) || HR.test(line)) return true;
  if (LIST_ITEM.test(line)) return true;
  if (trimSpaceTabStart(line).startsWith('|')) return true;
  if (isHtmlLine(line)) return true;
  return false;
}

/** 行首是不是列表项（排除分隔线，如 `* * *` / `- - -`）。 */
function isListItemLine(line: string): boolean {
  return !HR.test(line) && LIST_ITEM.test(line);
}

/** 前导空白宽度（按字符数；列表缩进也按字符算）。 */
function indentOf(line: string): number {
  return /^[ \t]*/.exec(line)?.[0].length ?? 0;
}

interface Containers {
  /** 去掉行首所有连续容器标记后的内容。 */
  content: string;
  /** 最内层容器的内容列（字符数，相对整行）。 */
  col: number;
  /** 各层列表内容列（外→内）；引用标记不占列表列。 */
  cols: number[];
}

/** 剥掉行首所有连续的列表标记（含空格）与 `>` 引用标记；用于同一行开多层容器的识别。 */
function stripContainers(line: string, stripQuotes = true): Containers {
  let rest = line;
  let offset = 0;
  const cols: number[] = [];
  for (;;) {
    const list = LIST_ITEM.exec(rest);
    if (list) {
      const indent = list[1]?.length ?? 0;
      const marker = list[2] ?? '';
      const gap = list[3]?.length ?? 0;
      offset += indent + marker.length + gap;
      cols.push(offset);
      rest = list[4] ?? '';
      continue;
    }
    if (stripQuotes) {
      const quote = /^ {0,3}> ?/.exec(rest);
      if (quote) {
        offset += quote[0].length;
        rest = rest.slice(quote[0].length);
        continue;
      }
    }
    break;
  }
  return { content: rest, col: offset, cols };
}

/** 只剥列表标记，保留后续的 `>` 等块标记；用于判断列表项首行是不是块结构。 */
function stripListMarkers(line: string): Containers {
  return stripContainers(line, false);
}

interface FenceMark {
  char: string;
  length: number;
}

/** 围栏开头（0–3 个空格 + 同字符至少三个 + 可选 info）；不是围栏时返回 null。 */
function openFence(line: string): FenceMark | null {
  const m = FENCE_OPEN.exec(line);
  if (!m) return null;
  const token = m[2] ?? '```';
  return { char: token[0] ?? '`', length: token.length };
}

/** 是不是 mark 对应的围栏关闭行：同字符、长度不小于开头、后面只有空白。 */
function closeFence(line: string, mark: FenceMark): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!m && m[1]?.[0] === mark.char && (m[1]?.length ?? 0) >= mark.length;
}

/** fenced code 的结束行下标；没有闭合时到数组末尾。 */
function fenceEnd(lines: string[], start: number, mark: FenceMark): number {
  for (let i = start + 1; i < lines.length; i += 1) {
    if (closeFence(lines[i] ?? '', mark)) return i;
  }
  return lines.length - 1;
}

/** 引用块里的围栏结束行：按开头那层的内容列剥掉缩进后判断；没有闭合时到引用块结束。 */
function containerFenceEnd(lines: string[], start: number, col: number, mark: FenceMark): number {
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (BLANK.test(line)) continue;
    const content = indentOf(line) >= col ? line.slice(col) : trimSpaceTab(line);
    if (closeFence(content, mark)) return i;
  }
  return lines.length - 1;
}

/** 标出整段里 fenced code 占用的行（含空行）；先剥掉同一行的所有容器标记。 */
function fenceMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i += 1) {
    if (mask[i]) continue;
    const containers = stripContainers(lines[i] ?? '');
    const mark = openFence(containers.content);
    if (!mark) continue;
    const close = containerFenceEnd(lines, i, containers.col, mark);
    for (let j = i; j <= close && j < lines.length; j += 1) mask[j] = true;
    i = close;
  }
  return mask;
}

/** 列表上下文里的 fenced code：从 start 的围栏开头跳到关闭行之后；中间（含空行）都不翻。 */
function listFenceAfter(lines: string[], start: number, col: number, mark: FenceMark): number {
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (BLANK.test(line)) continue;
    const indent = indentOf(line);
    if (indent < col) {
      // 缩进回到列表外：恰好是关闭行就收尾，否则保守地在这里停止跳过。
      return closeFence(trimSpaceTab(line), mark) ? i + 1 : i;
    }
    if (closeFence(line.slice(col), mark)) return i + 1;
  }
  return lines.length;
}

/** 正文从哪一行开始（frontmatter 之后）；没有 frontmatter 时从头开始。 */
function bodyStartLine(lines: string[]): number {
  if (lines[0] !== '---') return 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') return i + 1;
  }
  return 0;
}

/**
 * 扫描 Markdown（frontmatter 之后），找出要翻的单元与送翻纯文本。
 * 认不出、纯图片/纯链接、没有字母、X 的标题与引用作者行都跳过（保守：认不出就不翻）。
 */
export function planBilingual(md: string, medium: Medium): BilingualPlan {
  const lines = md.split('\n');
  const units: Unit[] = [];
  const segments: string[] = [];

  /** 列表/引用单元的插入点后面必须是段落边界（续修 7B）。 */
  const boundaryAfter = (end: number, kind: UnitKind): boolean => {
    const next = lines[end + 1];
    if (kind === 'quote-paragraph') {
      if (next === undefined) return true;
      if (BLANK.test(next)) return true;
      return isQuote(next) && BLANK.test(stripQuote(next));
    }
    if (kind === 'list-item' || kind === 'list-paragraph') {
      if (next === undefined) return true;
      if (BLANK.test(next)) return true;
      return isListItemLine(next);
    }
    return true;
  };

  /** 列表单元被拒绝后，跳过紧跟的懒续行，避免它被当成顶层段落再翻一次。 */
  const skipLazyContinuation = (start: number): number => {
    let i = start;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      if (BLANK.test(line) || isListItemLine(line)) break;
      i += 1;
    }
    return i;
  };

  const pushUnit = (
    kind: UnitKind,
    start: number,
    end: number,
    sourceLines: string[],
    rawSegments: string[],
    extra: Pick<Unit, 'indent' | 'headingLevel' | 'perLine' | 'displayTitle'> = {},
  ): void => {
    if (!boundaryAfter(end, kind)) return;
    // 单元在行内结构中间被截断时不翻；容器标记不在 rawSegments 里，不会误伤列表/引用。
    if (!inlineStructuresBalanced(rawSegments.join('\n'))) return;
    const normalized = rawSegments.map(stripHardBreak);
    let plains: PlainText[];
    let passthrough: Array<string | null> | undefined;
    if (extra.perLine) {
      // 按行翻的段落：没有字母的行、只有链接/图片的行不送翻，译文里原样照抄。
      passthrough = [];
      plains = [];
      for (const raw of normalized) {
        const plain = plainTextOf(raw);
        if (isLinkOnly(raw) || !hasLetters(plain.text.replace(/⟦c\d+⟧/gi, ' '))) {
          passthrough.push(raw);
        } else {
          passthrough.push(null);
          plains.push(plain);
        }
      }
      if (plains.length === 0) return;
    } else {
      plains = normalized.map((raw) => plainTextOf(raw));
      // 纯链接/图片段、一段都不剩、或有一行没有字母：整块不翻，避免把数字/纯链接行送进引擎。
      if (normalized.some((raw) => isLinkOnly(raw))) return;
      if (plains.length === 0 || plains.some((p) => !hasLetters(p.text.replace(/⟦c\d+⟧/gi, ' ')))) return;
    }
    const segmentIndexes: number[] = [];
    const segmentTexts: string[] = [];
    const segmentCodes: string[][] = [];
    for (const plain of plains) {
      segmentIndexes.push(segments.length);
      segmentTexts.push(plain.text);
      segmentCodes.push(plain.codes);
      segments.push(plain.text);
    }
    units.push({
      kind,
      start,
      end,
      sourceLines,
      segmentIndexes,
      segmentTexts,
      segmentCodes,
      ...extra,
      ...(passthrough ? { passthrough } : {}),
    });
  };

  let i = bodyStartLine(lines);
  /** 正文第一个非空行还没遇到。 */
  let firstContent = true;
  /** 当前列表各层内容列的栈（从外到内）。 */
  const listCols: number[] = [];
  let sawBlank = false;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (BLANK.test(line)) {
      sawBlank = true;
      i += 1;
      continue;
    }

    // 与 updateDisplayedTitle 认定的是同一行：正文第一个非空行。
    const isFirstContent = firstContent;
    firstContent = false;

    const fence = openFence(line);
    if (fence) {
      i = fenceEnd(lines, i, fence) + 1;
      listCols.length = 0;
      sawBlank = false;
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading) {
      listCols.length = 0;
      sawBlank = false;
      const title = heading[2] ?? '';
      const level = heading[1]?.length ?? 1;
      if (!(medium === 'x' && level === 1 && X_HEADING.test(line))) {
        pushUnit('heading', i, i, [line], [title], { headingLevel: level, displayTitle: isFirstContent && level === 1 });
      }
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      listCols.length = 0;
      sawBlank = false;
      i += 1;
      continue;
    }

    const tableLine = trimSpaceTabStart(line).startsWith('|');
    if (tableLine || isHtmlLine(line)) {
      // 列表项里的表格/HTML 块不打断列表上下文：保留缩进到某一层内容列的列表栈，
      // 表格后面的缩进段落才能照常当列表段落翻。表格/HTML 块本身仍不建单元。
      const lead = indentOf(line);
      const col = listCols.length > 0 ? [...listCols].reverse().find((c) => c <= lead) : undefined;
      if (col !== undefined && lead < col + 4) {
        while (listCols.length > 0 && (listCols[listCols.length - 1] ?? 0) > col) listCols.pop();
      } else {
        listCols.length = 0;
      }
      sawBlank = false;
      i += 1;
      if (tableLine) continue;
      // HTML 块到空行为止（保守：认不出结构就不翻）。
      while (i < lines.length && !BLANK.test(lines[i] ?? '')) i += 1;
      continue;
    }

    if (isQuote(line)) {
      listCols.length = 0;
      sawBlank = false;
      i = scanQuote(lines, i, medium, pushUnit);
      continue;
    }

    const list = LIST_ITEM.exec(line);
    if (list) {
      const indent = list[1]?.length ?? 0;
      const containers = stripContainers(line);
      const inner = stripListMarkers(line);
      const content = inner.content;
      const col = inner.col;
      while (listCols.length > 0 && (listCols[listCols.length - 1] ?? 0) > indent) listCols.pop();
      for (const c of containers.cols.length > 0 ? containers.cols : [col]) listCols.push(c);
      sawBlank = false;

      // 同一行开多层容器（如 "-   -   ```"）：剩下是围栏就整块跳过，不当列表项。
      const firstFence = openFence(containers.content);
      if (firstFence) {
        i = listFenceAfter(lines, i, containers.col, firstFence);
        continue;
      }

      // 列表项首段 = 首行 + 紧跟的续行（缩进不小于内容列、且不是新的块），直到空行。
      const rawLines: string[] = [content];
      let j = i + 1;
      while (j < lines.length) {
        const current = lines[j] ?? '';
        if (BLANK.test(current)) break;
        if (indentOf(current) < col) break;
        if (indentOf(current) >= col + 4) break;
        const rest = current.slice(col);
        if (startsBlock(rest)) break;
        rawLines.push(rest);
        j += 1;
      }

      // 首行剥掉列表标记后是标题/引用/表格/HTML/分隔线等块结构：不建单元、不送翻，
      // 这一行和它的续行都原样不动（围栏已在前面 firstFence 处理）。
      if (startsBlock(content)) {
        i = boundaryAfter(j - 1, 'list-item') ? j : skipLazyContinuation(j);
        continue;
      }

      // 插入点后面不是段落边界：不建单元，并跳过紧跟的懒续行，原文不动。
      if (!boundaryAfter(j - 1, 'list-item')) {
        i = skipLazyContinuation(j);
        continue;
      }

      const hard = rawLines.some((raw) => hasHardBreak(raw));
      const perLine = hard && rawLines.every((raw) => inlineStructuresBalanced(raw));
      const rawSegments = perLine ? rawLines : [rawLines.join('\n')];
      pushUnit('list-item', i, j - 1, lines.slice(i, j), rawSegments, { indent: col, perLine });
      i = j;
      continue;
    }

    // 列表上下文里的 fenced code：先去掉内容列缩进再判断围栏；围栏内（含空行）不翻。
    if (listCols.length > 0) {
      const lead = indentOf(line);
      const col = [...listCols].reverse().find((c) => c <= lead);
      if (col !== undefined) {
        const fence = openFence(line.slice(col));
        if (fence) {
          i = listFenceAfter(lines, i, col, fence);
          sawBlank = false;
          continue;
        }
      }
    }

    // 列表项里的后续段：缩进到某层内容列、前面是空行。
    if (listCols.length > 0 && sawBlank) {
      const lead = indentOf(line);
      const col = [...listCols].reverse().find((c) => c <= lead);
      if (col !== undefined) {
        // 内容列再缩进 4 格是列表里的缩进代码块，不翻。
        if (lead >= col + 4) {
          i += 1;
          continue;
        }
        const start = i;
        const raws: string[] = [];
        let j = i;
        while (j < lines.length) {
          const current = lines[j] ?? '';
          if (BLANK.test(current)) break;
          if (indentOf(current) < col) break;
          const content = current.slice(col);
          if (startsBlock(content)) break;
          raws.push(content);
          j += 1;
        }
        if (raws.length > 0) {
          if (!boundaryAfter(j - 1, 'list-paragraph')) {
            i = skipLazyContinuation(j);
            continue;
          }
          pushUnit('list-paragraph', start, j - 1, lines.slice(start, j), [raws.join('\n')], { indent: col });
          i = j;
          sawBlank = false;
          continue;
        }
      }
    }

    // 缩进代码块或认不出的缩进行：跳过。
    if (indentOf(line) > 0) {
      i += 1;
      continue;
    }

    // 顶层段落：缩进 0、连续非空行，遇到别的块或空行结束。
    listCols.length = 0;
    sawBlank = false;
    const start = i;
    const raws: string[] = [];
    let j = i;
    while (j < lines.length) {
      const current = lines[j] ?? '';
      if (BLANK.test(current)) break;
      if (j > start && startsBlock(current)) break;
      if (indentOf(current) > 0) break;
      raws.push(current);
      j += 1;
    }
    if (raws.length > 0) {
      const next = lines[j];
      if (!inlineStructuresBalanced(raws.join('\n'))) {
        // 本段被下一行块开头截断在链接/强调中间：整段不翻，并把后续非空行一并跳到空行。
        if (next !== undefined && !BLANK.test(next)) {
          while (j < lines.length && !BLANK.test(lines[j] ?? '')) j += 1;
        }
        i = j;
        continue;
      }
      if (next !== undefined && !BLANK.test(next) && !startsBlock(next)) {
        // 只因缩进等非块原因停下：不建单元，跳过余下非空行到空行，原文不动。
        while (j < lines.length && !BLANK.test(lines[j] ?? '')) j += 1;
        i = j;
        continue;
      }
      const hard = raws.some((raw) => hasHardBreak(raw));
      const perLine = hard && raws.every((raw) => inlineStructuresBalanced(raw));
      const rawSegments = perLine ? raws : [raws.join('\n')];
      pushUnit('paragraph', start, j - 1, raws, rawSegments, { perLine });
      i = j;
    } else {
      i += 1;
    }
  }

  return { units, segments };
}

/** 扫描一个引用块（从 start 开始），把一层引用里的段落交给 pushUnit；返回块之后的行下标。 */
function scanQuote(
  lines: string[],
  start: number,
  medium: Medium,
  pushUnit: (
    kind: UnitKind,
    start: number,
    end: number,
    sourceLines: string[],
    rawSegments: string[],
    extra?: Pick<Unit, 'indent' | 'headingLevel'>,
  ) => void,
): number {
  let i = start;
  const rawLines: string[] = [];
  while (i < lines.length && isQuote(lines[i] ?? '')) {
    rawLines.push(lines[i] ?? '');
    i += 1;
  }
  const stripped = rawLines.map(stripQuote);
  // 两层及以上的引用不翻。
  if (stripped.some((line) => isQuote(line))) return i;

  // 围栏跨空行跟踪：引用块里的代码块即使中间有空行，整块也不翻。
  const fenced = fenceMask(stripped);

  // 引用块里出现过列表项后，后续段落可能只是列表的缩进/懒续行，全部不再翻。
  let sawList = false;
  let from = 0;
  while (from < stripped.length) {
    while (from < stripped.length && (fenced[from] || BLANK.test(stripped[from] ?? ''))) from += 1;
    if (from >= stripped.length) break;
    let to = from;
    while (to < stripped.length && !fenced[to] && !BLANK.test(stripped[to] ?? '')) to += 1;
    const rawContent = stripped.slice(from, to);
    const contentLines = rawContent.map((line) => stripHardBreak(trimSpaceTab(line)));
    const raw = contentLines.join(' ');
    const isXAuthor = medium === 'x' && X_QUOTE_AUTHOR.test(contentLines.join('\n'));
    const hasList = rawContent.some((line) => LIST_ITEM.test(line));
    if (hasList) sawList = true;
    // 引用块只翻普通段落：列表项/标题/围栏/表格/HTML/任何前导缩进都跳过整段（保守）。
    const nonParagraph = rawContent.some(
      (line) =>
        LIST_ITEM.test(line) ||
        ATX_HEADING.test(line) ||
        FENCE_OPEN.test(line) ||
        trimSpaceTabStart(line).startsWith('|') ||
        isHtmlLine(line) ||
        /^[ \t]/.test(line),
    );
    if (!sawList && !isXAuthor && !nonParagraph) {
      pushUnit('quote-paragraph', start + from, start + to - 1, rawLines.slice(from, to), [raw]);
    }
    from = to;
  }

  // 引用块后面紧跟不带 `>` 的懒续行（普通文字）：它不是独立的顶层段落，原样跳过。
  if (stripped.some((line) => !BLANK.test(line))) {
    const next = lines[i];
    if (next !== undefined && !BLANK.test(next) && !startsBlock(next)) {
      while (i < lines.length) {
        const line = lines[i] ?? '';
        if (BLANK.test(line) || startsBlock(line)) break;
        i += 1;
      }
    }
  }
  return i;
}

/** 按行翻的段落：不送翻的行原样照抄，其余行用译文，行间用 `\` 硬换行。 */
function renderPerLine(unit: Unit, translations: string[], target: string): string[] | null {
  if (translations.length !== unit.segmentIndexes.length) return null;
  const passthrough = unit.passthrough ?? [];
  let next = 0;
  let same = true;
  const lines: string[] = [];
  for (let index = 0; index < unit.sourceLines.length; index += 1) {
    const copied = passthrough[index];
    if (copied !== null && copied !== undefined) {
      lines.push(copied);
      continue;
    }
    const raw = translations[next] ?? '';
    if (raw.trim() === '') return null;
    const codes = unit.segmentCodes[next] ?? [];
    const cleaned = cleanPunctuation(raw, target);
    const text = restorePlaceholders(cleaned, codes);
    const source = restorePlaceholders(unit.segmentTexts[next] ?? '', codes);
    if (text.trim() !== source.trim()) same = false;
    lines.push(restorePlaceholders(escapeMarkdownTranslation(cleaned), codes));
    next += 1;
  }
  if (next !== translations.length) return null;
  if (same) return [];
  if (unit.kind === 'list-item') {
    const indent = ' '.repeat(unit.indent ?? 0);
    return lines.map((line, index) => `${indent}${line}${index < lines.length - 1 ? '\\' : ''}`);
  }
  return ['', ...lines.map((line, index) => (index < lines.length - 1 ? `${line}\\` : line))];
}

/**
 * 按单元生成要插入的行。译文等于该段原文纯文本时返回空数组（免插）；任一段译文为空白或缺失时
 * 返回 null（无效，不插入、不算完成）。translations 与 unit.segmentIndexes 一一对应。
 */
export function renderTranslation(unit: Unit, translations: string[], target: string): string[] | null {
  if (unit.perLine) return renderPerLine(unit, translations, target);
  if (translations.length !== unit.segmentIndexes.length) return null;
  const rendered: string[] = [];
  let same = true;
  for (let i = 0; i < translations.length; i += 1) {
    const raw = translations[i] ?? '';
    if (raw.trim() === '') return null;
    const codes = unit.segmentCodes[i] ?? [];
    const cleaned = cleanPunctuation(raw, target);
    const text = restorePlaceholders(cleaned, codes);
    const source = restorePlaceholders(unit.segmentTexts[i] ?? '', codes);
    if (text.trim() !== source.trim()) same = false;
    // 先转义、再换回行内代码：代码里的反引号等不该再被转义。
    rendered.push(restorePlaceholders(escapeMarkdownTranslation(cleaned), codes));
  }
  if (same) return [];

  const first = rendered[0] ?? '';
  switch (unit.kind) {
    case 'heading':
      return ['', `${'#'.repeat(unit.headingLevel ?? 1)} ${first}`];
    case 'list-item':
      return [`${' '.repeat(unit.indent ?? 0)}${first}`];
    case 'list-paragraph':
      return ['', `${' '.repeat(unit.indent ?? 0)}${first}`];
    case 'quote-paragraph':
      return ['>', `> ${first}`];
    case 'paragraph':
    default: {
      const out: string[] = [];
      rendered.forEach((text, index) => {
        out.push(index < rendered.length - 1 ? `${text}\\` : text);
      });
      return ['', ...out];
    }
  }
}

export interface TranslationItem {
  unit: Unit;
  /** renderTranslation 生成的行；空数组表示与原文相同（免插），null 表示译文无效（空白或缺失）。 */
  lines: string[] | null;
}

export interface ApplyTranslationsResult {
  md: string;
  applied: Unit[];
  missing: Unit[];
  /** 只靠「同文字块已带同样译文」匹配上、本次没有插入的单元；它们仍出现在 applied 里。 */
  alreadyPresent: Unit[];
}

/** 写回时列表项原文末尾加了硬换行 `\`；比较原文时两种写法算同一个块。 */
function sameSourceLines(a: Unit, b: Unit): boolean {
  if (a.sourceLines.length !== b.sourceLines.length || a.sourceLines.length === 0) return false;
  if (a.sourceLines.every((line, index) => line === b.sourceLines[index])) return true;
  if (a.kind !== 'list-item' || b.kind !== 'list-item') return false;
  const last = a.sourceLines.length - 1;
  if (!a.sourceLines.every((line, index) => index === last || line === b.sourceLines[index])) return false;
  const left = a.sourceLines[last] ?? '';
  const right = b.sourceLines[last] ?? '';
  return left === `${right}\\` || right === `${left}\\`;
}

interface LineEdit {
  index: number;
  deleteCount: number;
  lines: string[];
}

/** 目标块后面是否已经紧跟这些译文行（expected 为空视为无需插入）。 */
function follows(lines: string[], target: Unit, expected: string[]): boolean {
  if (expected.length === 0) return true;
  const following = lines.slice(target.end + 1, target.end + 1 + expected.length);
  return following.length === expected.length && following.every((line, index) => line === expected[index]);
}

/**
 * 在当前文件上插入译文：重新扫描 currentMd，按原文顺序为每个 item 找到原文行完全相同的块。
 * 候选块后面已经紧跟同样译文时跳过它，继续找下一个同文字、还没译文的块；都没有才按已插入计。
 * 找不到的进 missing；item.lines 为 null 的无效单元直接进 missing，不插入、不算完成。
 * frontmatter 以外的原有字节不改，列表项只在原行末尾追加 `\`。
 */
export function applyTranslations(currentMd: string, items: TranslationItem[], medium: Medium): ApplyTranslationsResult {
  const plan = planBilingual(currentMd, medium);
  const lines = currentMd.split('\n');
  const applied: Unit[] = [];
  const missing: Unit[] = [];
  const alreadyPresent: Unit[] = [];
  const edits: LineEdit[] = [];
  const planDisplay = plan.units.find((unit) => unit.displayTitle);
  let cursor = 0;

  for (const item of items) {
    if (item.lines === null) {
      // 空白/缺失译文：不插入、不算完成；后续 item 仍按顺序找块。
      missing.push(item.unit);
      continue;
    }
    if (item.unit.displayTitle) {
      // 显示标题行是扩展自己维护的：改标题后这一块找不到，不算 missing，也不插任何行。
      if (planDisplay && sameSourceLines(planDisplay, item.unit)) {
        applied.push(item.unit);
        if (item.lines.length > 0 && !follows(lines, planDisplay, item.lines)) {
          edits.push({ index: planDisplay.end + 1, deleteCount: 0, lines: item.lines });
        }
      } else {
        applied.push(item.unit);
      }
      continue;
    }

    let insertAt = -1;
    let alreadyAt = -1;
    for (let k = cursor; k < plan.units.length; k += 1) {
      const candidate = plan.units[k];
      if (!candidate || candidate.kind !== item.unit.kind) continue;
      // 显示标题块只由 displayTitle 分支处理，其他单元不能把它当普通同文字块。
      if (candidate.displayTitle) continue;
      if (!sameSourceLines(candidate, item.unit)) continue;
      if (follows(lines, candidate, item.lines)) {
        // 这一块已经有同样译文：记下，继续找后面同文字、还没译文的块（续修 A）。
        if (alreadyAt === -1) alreadyAt = k;
        continue;
      }
      insertAt = k;
      break;
    }
    if (insertAt === -1) {
      if (alreadyAt === -1) {
        missing.push(item.unit);
        continue;
      }
      // 同文字的块都已经译过：按已插入计，消费最前面那个，后续同批 item 还能各对应一块。
      applied.push(item.unit);
      if (item.lines.length > 0) alreadyPresent.push(item.unit);
      cursor = alreadyAt + 1;
      continue;
    }
    cursor = insertAt + 1;
    const target = plan.units[insertAt];
    if (!target) {
      missing.push(item.unit);
      continue;
    }
    applied.push(item.unit);

    if (item.unit.kind === 'list-item') {
      const original = lines[target.end] ?? '';
      const withBreak = hasHardBreak(original) ? original : `${original}\\`;
      edits.push({ index: target.end, deleteCount: 1, lines: [withBreak, ...item.lines] });
    } else {
      edits.push({ index: target.end + 1, deleteCount: 0, lines: item.lines });
    }
  }

  if (edits.length === 0) return { md: currentMd, applied, missing, alreadyPresent };

  // 从后往前改，避免前面的插入移动后面的行号。同一行上既有替换（列表项）又有插入（前一个块的译文）时，
  // 替换先做：插入的行会出现在被替换的原文行之前，顺序才对。
  edits.sort((a, b) => b.index - a.index || b.deleteCount - a.deleteCount);
  const out = [...lines];
  for (const edit of edits) {
    out.splice(edit.index, edit.deleteCount, ...edit.lines);
  }
  return { md: out.join('\n'), applied, missing, alreadyPresent };
}
