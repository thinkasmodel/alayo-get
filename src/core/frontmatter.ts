// 剪藏的 YAML frontmatter：键序固定、每键一行、字符串一律双引号标量。
import { t } from '@/shared/i18n';
import type { ExtractState, Medium, Platform } from '@/shared/types';
import { toApiTag } from './translate/language';

export interface FrontmatterFields {
  id: string;
  /** 规范化出处。 */
  source: string;
  medium: Medium;
  title: string;
  author: string;
  /** 原始发布时间，能被 Date.parse 解析的转 ISO，否则原样保留。 */
  published: string;
  /** 保存时间。 */
  captured: Date;
  tags: string[];
  note: string;
  extract: ExtractState;
}

/** 只有流媒体剪藏有的五个字段（ALAG-4），接在 extract 之后。取不到时 video_id、embed、cover 为空串，duration 为 null。 */
export interface StreamFrontmatter {
  platform: Platform;
  video_id: string;
  embed: string;
  /** 秒，写整数；取不到为 null。 */
  duration: number | null;
  /** `.assets/<id>/cover.<ext>` 或空串。 */
  cover: string;
}

/**
 * 双引号标量：用 JSON.stringify 转义（结果是合法的 YAML 双引号标量）。
 * JSON 不转义 DEL、C1 控制字符、U+2028/2029 和 BOM，YAML 不允许它们裸出现（或在 YAML 1.1 里当换行），
 * 这里补成 \uXXXX（JSON 与 YAML 都认）。
 */
export function yamlString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function yamlTags(tags: string[]): string {
  return `[${tags.map(yamlString).join(', ')}]`;
}

/** 主机名去掉开头的 `www.`；解析不了时为空。 */
export function siteFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function normalizePublished(published: string): string {
  const trimmed = published.trim();
  if (trimmed === '') return '';
  const t = Date.parse(trimmed);
  return Number.isNaN(t) ? trimmed : new Date(t).toISOString();
}

/** 生成 `---` 块，以 `---\n` 结尾。传了 stream 时在 extract 之后追加流媒体的五行；没传时输出与 ALAG-4 之前逐字节相同。 */
export function emitFrontmatter(f: FrontmatterFields, stream?: StreamFrontmatter): string {
  const lines = [
    `id: ${yamlString(f.id)}`,
    `source: ${yamlString(f.source)}`,
    `medium: ${yamlString(f.medium)}`,
    `title: ${yamlString(f.title)}`,
    `author: ${yamlString(f.author)}`,
    `published: ${yamlString(normalizePublished(f.published))}`,
    `captured: ${yamlString(f.captured.toISOString())}`,
    `site: ${yamlString(siteFromUrl(f.source))}`,
    `tags: ${yamlTags(f.tags)}`,
    `note: ${yamlString(f.note)}`,
    `extract: ${yamlString(f.extract)}`,
  ];
  if (stream) {
    const duration = stream.duration === null || !Number.isFinite(stream.duration) ? 'null' : String(Math.round(stream.duration));
    lines.push(
      `platform: ${yamlString(stream.platform)}`,
      `video_id: ${yamlString(stream.video_id)}`,
      `embed: ${yamlString(stream.embed)}`,
      `duration: ${duration}`,
      `cover: ${yamlString(stream.cover)}`,
    );
  }
  return `---\n${lines.join('\n')}\n---\n`;
}

/**
 * 只替换 frontmatter 里对应键的那一行，其余字节不变。
 * 文件开头没有 `---` 块、或块里缺目标键时抛错。
 */
export function updateFrontmatter(md: string, edits: { title?: string; tags?: string[]; note?: string }): string {
  if (!md.startsWith('---\n')) throw new Error(t('error_noFrontmatter'));
  const end = md.indexOf('\n---\n', 3);
  const endAtEof = end === -1 && md.endsWith('\n---') ? md.length - 4 : -1;
  const close = end !== -1 ? end : endAtEof;
  if (close === -1) throw new Error(t('error_frontmatterUnclosed'));

  const head = md.slice(0, 4);
  const block = md.slice(4, close + 1); // 含最后一行的换行
  const tail = md.slice(close + 1);

  const replacements: Array<[string, string]> = [];
  if (edits.title !== undefined) replacements.push(['title', yamlString(edits.title)]);
  if (edits.tags !== undefined) replacements.push(['tags', yamlTags(edits.tags)]);
  if (edits.note !== undefined) replacements.push(['note', yamlString(edits.note)]);

  const lines = block.split('\n');
  for (const [key, value] of replacements) {
    const i = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (i === -1) throw new Error(t('error_frontmatterKeyMissing', key));
    lines[i] = `${key}: ${value}`;
  }
  return head + lines.join('\n') + tail;
}

/** 翻译状态（CONTEXT.md「翻译状态」）：没翻译过的剪藏没有这三个字段。 */
export type TranslationState = 'complete' | 'partial' | 'failed';

export interface TranslationFields {
  /** 原文语言；还不知道时为空串。 */
  lang: string;
  /** 目标语言。 */
  translated_to: string;
  translation: TranslationState;
}

interface FrontmatterBounds {
  /** 开头的 `---\n`。 */
  head: string;
  /** 键行，含最后一行的换行。 */
  block: string;
  /** 从收尾的 `---` 开始，含正文。 */
  tail: string;
}

/** 切出 frontmatter 的三段；没有 `---` 块时返回 null。 */
function frontmatterBounds(md: string): FrontmatterBounds | null {
  if (!md.startsWith('---\n')) return null;
  const end = md.indexOf('\n---\n', 3);
  const endAtEof = end === -1 && md.endsWith('\n---') ? md.length - 4 : -1;
  const close = end !== -1 ? end : endAtEof;
  if (close === -1) return null;
  return { head: md.slice(0, 4), block: md.slice(4, close + 1), tail: md.slice(close + 1) };
}

const TRANSLATION_KEYS = ['lang', 'translated_to', 'translation'] as const;

/**
 * 写翻译状态：三个键都已存在就逐个替换值；都不存在（或只存在一部分）时在 `extract:` 行之后
 * 按 lang、translated_to、translation 的顺序补齐。lang、translated_to 用 toApiTag 规范化。
 */
export function setTranslationFields(md: string, fields: TranslationFields): string {
  if (!md.startsWith('---\n')) throw new Error(t('error_noFrontmatter'));
  const bounds = frontmatterBounds(md);
  if (!bounds) throw new Error(t('error_frontmatterUnclosed'));

  const values = new Map<string, string>([
    ['lang', yamlString(fields.lang.trim() === '' ? '' : toApiTag(fields.lang.trim()))],
    ['translated_to', yamlString(fields.translated_to.trim() === '' ? '' : toApiTag(fields.translated_to.trim()))],
    ['translation', yamlString(fields.translation)],
  ]);
  const lines = bounds.block.split('\n');
  const indexes = new Map<string, number>();
  for (const key of TRANSLATION_KEYS) {
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (index !== -1) indexes.set(key, index);
  }

  // 三个都在：只换值，其余字节（包括键的位置）不变。
  if (indexes.size === TRANSLATION_KEYS.length) {
    for (const key of TRANSLATION_KEYS) {
      const index = indexes.get(key) ?? -1;
      if (index !== -1) lines[index] = `${key}: ${values.get(key)}`;
    }
    return bounds.head + lines.join('\n') + bounds.tail;
  }

  // 缺键：先去掉已有的翻译行，再在 extract 之后按固定顺序补齐。
  const kept = lines.filter((line) => !TRANSLATION_KEYS.some((key) => line.startsWith(`${key}:`)));
  const extract = kept.findIndex((line) => line.startsWith('extract:'));
  const at = extract !== -1 ? extract + 1 : Math.max(kept.length - 1, 0);
  kept.splice(at, 0, ...TRANSLATION_KEYS.map((key) => `${key}: ${values.get(key)}`));
  return bounds.head + kept.join('\n') + bounds.tail;
}

/** 撤掉三个翻译字段（同语言跳过时用）；没有这三个字段时原样返回。 */
export function removeTranslationFields(md: string): string {
  const bounds = frontmatterBounds(md);
  if (!bounds) return md;
  const lines = bounds.block.split('\n');
  const kept = lines.filter((line) => !TRANSLATION_KEYS.some((key) => line.startsWith(`${key}:`)));
  if (kept.length === lines.length) return md;
  return bounds.head + kept.join('\n') + bounds.tail;
}

/**
 * 读出 frontmatter 里可编辑的三个字段（标题、标签、批注）的实际值。
 * 判断“有没有改动”要以文件为准，不能以缓存里的剪藏信息为准（codex review 加审轮）。
 * 某个键缺失或解析不了时，不出现在结果里。
 */
export function readEditableFields(md: string): { title?: string; tags?: string[]; note?: string } {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1];
  if (!block) return {};
  const value = (key: string): unknown => {
    const raw = new RegExp(`^${key}: (.*)$`, 'm').exec(block)?.[1];
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  };
  const out: { title?: string; tags?: string[]; note?: string } = {};
  const title = value('title');
  if (typeof title === 'string') out.title = title;
  const note = value('note');
  if (typeof note === 'string') out.note = note;
  const tags = value('tags');
  if (Array.isArray(tags) && tags.every((t) => typeof t === 'string')) out.tags = tags as string[];
  return out;
}
