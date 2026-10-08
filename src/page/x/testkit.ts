// 仅供测试：把 X 样本载入成文档、找焦点帖、按快照序列构造假驱动。生产代码不引用本文件。
import type { XPageDriver } from './collect';
import { classifyCell, listCells, TWEET } from './cells';

/** 样本第二行注释里的来源地址。 */
export function fixtureUrl(html: string): string {
  const m = /<!-- captured \S+ from (\S+)/.exec(html);
  if (!m?.[1]) throw new Error('样本没有来源地址');
  return m[1];
}

/** 用 DOMParser 构造文档，加 <base> 让 baseURI 等于页面地址（同 src/page/extract.dom.test.ts）。 */
export function loadFixture(html: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.href = fixtureUrl(html);
  doc.head.prepend(base);
  return doc;
}

/** 按 id 找帖子 article。 */
export function articleById(doc: Document, id: string): Element {
  for (const cell of listCells(doc)) {
    const c = classifyCell(cell);
    if (c.kind === 'post' && c.id === id) return c.article;
  }
  // 不在 cell 里的（如时间线样本）按标注数据找
  for (const a of doc.querySelectorAll(TWEET)) if (a.getAttribute('data-alayo-x')?.includes(`"id":"${id}"`)) return a;
  throw new Error(`样本里没有帖子 ${id}`);
}

export interface FakeDriver extends XPageDriver {
  /** 当前快照下标。 */
  readonly index: number;
  clicks: Element[];
  restored: number;
  annotations: number;
  /** 当前假时钟。 */
  clock: number;
  /** navigatedAway() 的返回值，测试可以设置（模拟站内切页） */
  away: boolean;
}

/**
 * 假驱动：cells() 返回第 k 份快照里的 cell；scrollDown()、click() 让 k 前进（停在最后一份；
 * click 可按选项延迟或无效）；
 * atBottom() 在最后一份上为真。假时钟由 scrollDown 加 350、click 加 600、wait 加 ms 推进，
 * onStep 可以在每次 scrollDown / click 之后改时钟。
 */
export interface SnapshotDriverOptions {
  onStep?: (d: FakeDriver, step: number) => void;
  /** 点击后要再等这么多次 wait() 才切到下一份快照（模拟展开响应慢）；缺省 0，点击即切换 */
  clickDelayWaits?: number;
  /** 点击无效：快照不变 */
  clickNoop?: boolean;
  /** 点击切到下一份快照后，再 wait 这么多次自动再切一份（模拟点击后先出现一份过渡快照） */
  advanceAfterClickWaits?: number;
  /** 每次点击时先调用（在切换快照之前），测试可以借此原地改当前快照 */
  onClick?: (d: FakeDriver, el: Element) => void;
}

export function snapshotDriver(docs: Document[], options: SnapshotDriverOptions = {}): FakeDriver {
  let k = 0;
  let steps = 0;
  /** 点击后还要等的 wait 次数；null 表示没有待切换的点击 */
  let pendingClick: number | null = null;
  const advance = () => {
    k = Math.min(k + 1, docs.length - 1);
    steps++;
    options.onStep?.(driver, steps);
  };
  const driver: FakeDriver = {
    get index() {
      return k;
    },
    clicks: [],
    restored: 0,
    annotations: 0,
    clock: 0,
    away: false,
    navigatedAway: () => driver.away,
    cells: () => listCells(docs[k] as Document),
    annotate: () => {
      driver.annotations++;
    },
    atTop: () => true,
    atBottom: () => k === docs.length - 1,
    scrollToTop: async () => undefined,
    scrollDown: async () => {
      driver.clock += 350;
      advance();
    },
    click: async (el) => {
      driver.clicks.push(el);
      driver.clock += 600;
      options.onClick?.(driver, el);
      if (options.clickNoop) return;
      if (options.clickDelayWaits) pendingClick = options.clickDelayWaits;
      else {
        advance();
        if (options.advanceAfterClickWaits) pendingClick = options.advanceAfterClickWaits;
      }
    },
    wait: async (ms) => {
      driver.clock += ms;
      if (pendingClick === null) return;
      pendingClick--;
      if (pendingClick <= 0) {
        pendingClick = null;
        advance();
      }
    },
    now: () => driver.clock,
    restore: () => {
      driver.restored++;
    },
  };
  return driver;
}
