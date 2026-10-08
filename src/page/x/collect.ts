// 作者串采集器：边滚动边按 status id 累积 cell（列表是虚拟滚动），点开“显示回复”，
// 取焦点帖所在的同一作者连续帖子。真实页面的操作经 XPageDriver 注入，测试用快照假驱动。
import type { XPartial } from '@/shared/types';
import { classifyCell, parsePost, type XCell, type XPost } from './cells';

export interface XPageDriver {
  /** 当前 DOM 里的会话 cell（[data-testid="cellInnerDiv"]），按文档顺序 */
  cells(): Element[];
  /** 派发 alayo-get:annotate-x */
  annotate(): void;
  atTop(): boolean;
  atBottom(): boolean;
  scrollToTop(): Promise<void>;
  /** 向下滚约 0.8 屏，然后等 350ms */
  scrollDown(): Promise<void>;
  /** 点击后等 600ms */
  click(el: Element): Promise<void>;
  wait(ms: number): Promise<void>;
  now(): number;
  /** 采集结束后恢复用户原来的滚动位置 */
  restore(): void;
  /** 站内切页了：当前地址和驱动创建时记下的地址不同 */
  navigatedAway(): boolean;
}
export const X_MAX_POSTS = 50;
export const X_MAX_MS = 15_000;
export const X_IDLE_MS = 1_500;
/** 这么久还找不到焦点帖，就放弃（extractX 退化为书签）。 */
export const X_FOCAL_MS = 5_000;
/** 等滚到顶、等骨架渲染时的轮询间隔。 */
const POLL_MS = 100;
const SKELETON_WAIT_MS = 350;

export interface CollectOptions {
  maxPosts?: number;
  maxMs?: number;
  idleMs?: number;
  focalMs?: number;
}

export interface CollectResult {
  form: 'post' | 'thread';
  /** 作者串，按页面顺序；串头是第一条 */
  posts: XPost[];
  /** null 表示完整 */
  partial: XPartial | null;
  /** 焦点帖最后一次见到的 article 元素（extractX 据此判断是不是长文） */
  focalArticle: Element;
}

/** 累积列表里的一条帖子。 */
export interface Entry {
  id: string;
  handle: string;
  article: Element;
  post: XPost | null;
  /** 最近一次看到它时，它和前一条帖子之间隔着分隔、按钮或骨架 */
  breakBefore: boolean;
}

/** click 带上锚点：本快照里按钮前面最近的那条作者串帖子，用来确认展开区域还在视野里。 */
type Decision = 'end' | 'continue' | 'pending' | { click: Element; anchorId: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * 累积列表：按页面顺序存帖子。新帖子的位置：
 * 1. 本快照里它前面有已知帖子：插在最近那条之后；
 * 2. 前面没有、后面有：插在本快照里它后面第一条已知帖子之前（连续几条新帖子保持相对顺序）；
 * 3. 本快照里一条已知帖子都没有：追加到末尾（只往下滚；两份快照不重叠时中间可能漏帖子，不标 partial）。
 */
export class Accumulator {
  readonly list: Entry[] = [];
  private readonly byId = new Map<string, Entry>();

  /** 合并一份快照，返回新出现的帖子条数。 */
  merge(cells: XCell[]): number {
    let added = 0;
    let prev: Entry | null = null;
    let gap = false;
    let seen = false;
    // 合并前就已知的帖子里，每个位置之后的第一条（规则 2 的锚点）
    const nextKnown: (Entry | null)[] = new Array<Entry | null>(cells.length).fill(null);
    for (let i = cells.length - 1, next: Entry | null = null; i >= 0; i--) {
      nextKnown[i] = next;
      const c = cells[i] as XCell;
      if (c.kind === 'post') next = this.byId.get(c.id) ?? next;
    }
    for (const [i, c] of cells.entries()) {
      if (c.kind !== 'post') {
        gap = true;
        seen = true;
        continue;
      }
      let entry = this.byId.get(c.id);
      if (!entry) {
        entry = { id: c.id, handle: c.handle, article: c.article, post: parsePost(c.article), breakBefore: false };
        const after = nextKnown[i] ?? null;
        const at = prev ? this.list.indexOf(prev) + 1 : after ? this.list.indexOf(after) : this.list.length;
        this.list.splice(at, 0, entry);
        this.byId.set(c.id, entry);
        added++;
      } else {
        // 已知帖子每次都按最新的元素重新解析（换了元素，或同一个 article 原地更新，如视频节点后渲染出来）；
        // 解析失败时保留旧结果
        entry.article = c.article;
        entry.post = parsePost(c.article) ?? entry.post;
      }
      // 快照里它前面有东西时才知道它和前一条之间有没有隔断；快照第一个 cell 保留上次的判断
      if (seen) entry.breakBefore = gap;
      prev = entry;
      gap = false;
      seen = true;
    }
    return added;
  }

  indexOf(id: string): number {
    const e = this.byId.get(id);
    return e ? this.list.indexOf(e) : -1;
  }
}

/**
 * 作者串的范围 [start, end]：往上取同一作者连续的帖子，遇到别人的帖子或隔断（分隔、按钮、骨架）就停；
 * 往下跳过隔断，连续收作者本人的帖子，遇到第一条别人的帖子就停。
 */
function threadRange(list: Entry[], focal: number): { start: number; end: number } {
  const author = (list[focal] as Entry).handle;
  let start = focal;
  while (start > 0 && !(list[start] as Entry).breakBefore && same((list[start - 1] as Entry).handle, author)) start--;
  let end = focal;
  while (end + 1 < list.length && same((list[end + 1] as Entry).handle, author)) end++;
  return { start, end };
}

/**
 * 一遍按 DOM 顺序扫本快照，决定下一步：
 * - 首帖上方紧邻的 cell 是骨架：pending（往上取作者串时遇到骨架会断开，骨架可能是还没渲染出来的上文）；
 * - 从本快照里作者串范围内出现的第一条帖子起往后：作者串里的帖子、分隔、点过的按钮都跳过；
 *   未点过的按钮就点开；骨架就等（pending）；作者本人但不在当前范围内的帖子跳过（保守）；别人的帖子就结束；
 * - 扫到快照末尾：continue。
 * 本快照里一条作者串的帖子都没有时：累积列表里末条之后已有帖子就结束，否则 continue。
 */
function decide(cells: XCell[], acc: Accumulator, start: number, end: number, author: string, clicked: Set<Element>): Decision {
  const ids = new Set(acc.list.slice(start, end + 1).map((e) => e.id));
  const first = cells.findIndex((c) => c.kind === 'post' && ids.has(c.id));
  if (first === -1) return end + 1 < acc.list.length ? 'end' : 'continue';
  if (cells[first - 1]?.kind === 'skeleton') return 'pending';
  let anchorId = (cells[first] as Extract<XCell, { kind: 'post' }>).id;
  for (const c of cells.slice(first + 1)) {
    if (c.kind === 'separator') continue;
    if (c.kind === 'button') {
      if (clicked.has(c.button)) continue;
      return { click: c.button, anchorId };
    }
    if (c.kind === 'skeleton') return 'pending';
    if (ids.has(c.id)) {
      anchorId = c.id;
      continue;
    }
    if (same(c.handle, author)) continue;
    return 'end';
  }
  return 'continue';
}

/** 采集焦点帖所在的作者串。找不到焦点帖时返回 null。结束后总会 restore()。 */
export async function collectThread(driver: XPageDriver, focalId: string, options: CollectOptions = {}): Promise<CollectResult | null> {
  const maxPosts = options.maxPosts ?? X_MAX_POSTS;
  const maxMs = options.maxMs ?? X_MAX_MS;
  const idleMs = options.idleMs ?? X_IDLE_MS;
  const focalMs = options.focalMs ?? X_FOCAL_MS;

  const acc = new Accumulator();
  const clicked = new Set<Element>();
  /** 点开了、还没展开完成的“显示回复” */
  let expanding: { button: Element; anchorId: string; clickedAt: number; postsAtClick: number } | null = null;
  const started = driver.now();
  let limit = false;
  let timeout = false;

  try {
    // 开始前就已切页：不动页面，按找不到焦点帖处理
    if (driver.navigatedAway()) return null;
    await driver.scrollToTop();
    while (!driver.atTop() && !driver.navigatedAway() && driver.now() - started < maxMs) await driver.wait(POLL_MS);
    let lastNew = driver.now();

    for (;;) {
      // 超时，或站内切页了（新页面由它自己的采集器处理）：立刻结束，存已采到的，记为没有加载完
      if (driver.now() - started >= maxMs || driver.navigatedAway()) {
        timeout = true;
        break;
      }
      driver.annotate();
      const cells = driver.cells().map(classifyCell);
      if (acc.merge(cells) > 0) lastNew = driver.now();

      const focal = acc.indexOf(focalId);
      if (focal === -1) {
        if (driver.now() - started >= focalMs) return null;
        if (driver.atBottom()) await driver.wait(POLL_MS);
        else await driver.scrollDown();
        continue;
      }

      const { start, end } = threadRange(acc.list, focal);
      if (end - start + 1 > maxPosts) {
        limit = true;
        break;
      }
      if (expanding) {
        // 展开完成要同时满足：被点的按钮不在当前 cells 里；锚点帖子在当前 cells 里（展开区域还在视野里，
        // 不是被虚拟滚动回收了）；点击后合并进了新帖子、或距点击已过 idleMs。
        // 不满足就一直算未完成：不滚动、不判终止、不点别的按钮，也不重新定位；由总时限兜底（timeout）。
        const { button, anchorId } = expanding;
        const gone = !cells.some((c) => c.kind === 'button' && c.button === button);
        const anchored = cells.some((c) => c.kind === 'post' && c.id === anchorId);
        const done = gone && anchored && (acc.list.length > expanding.postsAtClick || driver.now() - expanding.clickedAt >= idleMs);
        if (!done) {
          await driver.wait(POLL_MS);
          continue;
        }
        expanding = null;
      }
      const decision = decide(cells, acc, start, end, (acc.list[focal] as Entry).handle, clicked);
      if (decision === 'end') break;
      if (typeof decision === 'object') {
        // 点开“显示回复”：本步不判终止，也不滚动，等展开完成后再判定
        clicked.add(decision.click);
        expanding = { button: decision.click, anchorId: decision.anchorId, clickedAt: driver.now(), postsAtClick: acc.list.length };
        await driver.click(decision.click);
        continue;
      }
      if (decision === 'pending') {
        // 骨架还在加载：只等，不做“到底且空闲”的结束判定；一直不消失由总时限兜底（timeout）
        await driver.wait(SKELETON_WAIT_MS);
        continue;
      }
      if (driver.atBottom() && driver.now() - lastNew >= idleMs) break;
      await driver.scrollDown();
    }

    const focal = acc.indexOf(focalId);
    if (focal === -1) return null;
    const { start, end } = threadRange(acc.list, focal);
    const posts = acc.list
      .slice(start, end + 1)
      .slice(0, maxPosts)
      .map((e) => e.post)
      .filter((p): p is XPost => p !== null);
    const truncated = posts.filter((p) => p.truncated || p.quote?.truncated).length;
    const partial = limit || timeout || truncated > 0 ? { limit, timeout, truncated } : null;
    return { form: posts.length > 1 ? 'thread' : 'post', posts, partial, focalArticle: (acc.list[focal] as Entry).article };
  } finally {
    driver.restore();
  }
}
