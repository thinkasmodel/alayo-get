// 标签建议：从已保存记录里统计历史标签。
import type { SavedIndexData, TagCount } from '@/shared/types';

/**
 * prefix 为空时返回最常用的标签；非空时只返回以它开头的。
 * 按次数降序，次数相同按字典序（码元序）。
 */
export function tagSuggestions(index: SavedIndexData, prefix: string, limit = 8): TagCount[] {
  const counts = new Map<string, number>();
  for (const entry of Object.values(index)) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .filter(([tag]) => prefix === '' || tag.startsWith(prefix))
    .sort(([a, ca], [b, cb]) => cb - ca || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}
