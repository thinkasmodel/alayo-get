// 剪藏文件名：标题清洗、截断、重名加序号。
import { t } from '@/shared/i18n';

const MAX_CODE_POINTS = 60;

/** 由标题得到文件基础名（不含 `.md`）。 */
export function clipBaseName(title: string): string {
  // 1. 非法字符与控制字符 → '-'
  let name = title.replace(/[/\\:*?"<>|]/g, '-').replace(/\p{Cc}/gu, '-');
  // 2. 连续空白合并，去首尾空白
  name = name.replace(/\s+/g, ' ').trim();
  // 3. 去开头的点（Workbench 会把点开头的文件当隐藏文件）
  name = name.replace(/^\.+/, '').trim();
  // 4. 按码点截断
  const points = Array.from(name);
  if (points.length > MAX_CODE_POINTS) {
    name = points.slice(0, MAX_CODE_POINTS - 1).join('') + '…';
  }
  // 5. 空 → 默认名
  return name === '' ? t('file_untitled') : name;
}

function nameKey(name: string): string {
  // macOS 默认文件系统不分大小写、并做 Unicode 归一，比较时同样处理，避免覆盖已有文件。
  return name.normalize('NFC').toLowerCase();
}

/** 两个文件名在不分大小写的文件系统上是否指向同一个文件。 */
export function sameFileName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}

/**
 * 在已有文件名中找一个不冲突的文件名：`名.md`、`名 (2).md`、`名 (3).md`……
 * `existing` 是剪藏库根目录下现有的文件名；`ext` 是带点的扩展名，缺省 `.md`（媒体剪藏传 `.jpg` 等，ALAG-4）。
 */
export function uniqueFileName(base: string, existing: Iterable<string>, ext = '.md'): string {
  const taken = new Set<string>();
  for (const name of existing) taken.add(nameKey(name));
  let candidate = `${base}${ext}`;
  for (let n = 2; taken.has(nameKey(candidate)); n++) {
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}
