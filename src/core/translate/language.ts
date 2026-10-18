// 语言标签规范化：产品里统一用 Chrome 官方语言列表的写法（zh / zh-Hant），
// 其余标签取主语言子标签（ALAG-24 §4）。
const SIMPLIFIED = ['zh', 'zh-cn', 'zh-sg', 'zh-hans'];
const TRADITIONAL = ['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant'];

/** 以 prefix 开头且后面是标签边界（末尾或 '-'），避免把 zhx 当成 zh。 */
function startsWithTag(tag: string, prefix: string): boolean {
  return tag === prefix || tag.startsWith(`${prefix}-`);
}

/** 任意 BCP 47 标签 → 发给本机引擎的标签：简繁中文各自归一，其余取主语言子标签。 */
export function toApiTag(tag: string): string {
  const lower = tag.toLowerCase();
  if (lower === 'zh') return 'zh';
  if (TRADITIONAL.some((prefix) => startsWithTag(lower, prefix))) return 'zh-Hant';
  if (SIMPLIFIED.some((prefix) => startsWithTag(lower, prefix))) return 'zh';
  return lower.split('-')[0] ?? lower;
}

/** 两个标签是否会被本机引擎当成同一种语言。 */
export function sameLanguage(a: string, b: string): boolean {
  return toApiTag(a) === toApiTag(b);
}
