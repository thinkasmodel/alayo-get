// 最小的 DOM 构建工具，不引入框架。
import { t, type MessageKey } from '@/shared/i18n';
import { icon, type IconName } from './icons';

type Attr = string | number | boolean | null | undefined | EventListener;
export type Attrs = Record<string, Attr>;
export type Child = Node | string | null | undefined | false;

/**
 * 建一个元素。attrs 里：`on<event>` 绑事件；`class`、`id`、`aria-*`、`data-*` 等按属性写入；
 * 布尔 true 写空属性，false / null / undefined 跳过。
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child | Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child | Child[]): void {
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** 哨兵串 `\u0001<序号>\u0001` 的分隔符，不会出现在文案里。 */
const MARK = '\u0001';

/**
 * 句子中间夹着元素（键帽、加粗）的文案（ALAG-7）：整句一个键，元素位置是占位符，`nodes[i]` 对应 `$i+1`。
 * 先用哨兵串作替换值取文案，再按哨兵切开，把哨兵换回对应的节点，其余为文本。语序按各语言的文案，可以与 nodes 顺序不同。
 */
export function richT(key: MessageKey, nodes: Node[]): Child[] {
  const text = t(key, nodes.map((_, i) => `${MARK}${i}${MARK}`));
  // 按分隔符切开：偶数位是文本，奇数位是哨兵里的序号
  return text.split(MARK).map((part, i) => (i % 2 === 0 ? part || null : (nodes[Number(part)] ?? null)));
}

/** 图标节点（span 包一层内联 SVG）。 */
export function iconEl(name: IconName, size = 16, className = 'icon'): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.innerHTML = icon(name, size);
  return span;
}
