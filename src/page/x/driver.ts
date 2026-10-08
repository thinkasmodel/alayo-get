// 真实页面的 XPageDriver：滚动、点击、计时都作用在当前标签页（只在用户点了保存之后运行，ADR-0003）。
import { listCells } from './cells';
import type { XPageDriver } from './collect';
import { parseXStatusUrl } from './url';

const ANNOTATE_EVENT = 'alayo-get:annotate-x';
const SCROLL_WAIT_MS = 350;
const CLICK_WAIT_MS = 600;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 当前页面的驱动；创建时记下滚动位置，restore() 时滚回去。 */
export function createPageDriver(doc: Document = document, win: Window = window): XPageDriver {
  // 按帖子比较：同一帖子打开图片灯箱（/photo/1）或带查询参数都不算切页
  const pageKey = (href: string) => parseXStatusUrl(href)?.id ?? href;
  const startKey = pageKey(win.location.href);
  const samePage = () => pageKey(win.location.href) === startKey;
  const startX = win.scrollX;
  const startY = win.scrollY;
  const root = () => doc.querySelector('[data-testid="primaryColumn"]') ?? doc.querySelector('main') ?? doc;
  const scrollTo = (top: number, left = 0) => win.scrollTo({ top, left, behavior: 'instant' });
  return {
    navigatedAway: () => !samePage(),
    cells: () => listCells(root()),
    annotate: () => {
      // 主世界标注器同步处理，返回时属性已经写好
      doc.dispatchEvent(new CustomEvent(ANNOTATE_EVENT));
    },
    atTop: () => win.scrollY <= 0,
    atBottom: () => win.innerHeight + win.scrollY >= doc.documentElement.scrollHeight - 2,
    scrollToTop: async () => {
      scrollTo(0);
      await sleep(SCROLL_WAIT_MS);
    },
    scrollDown: async () => {
      scrollTo(win.scrollY + Math.round(win.innerHeight * 0.8));
      await sleep(SCROLL_WAIT_MS);
    },
    click: async (el) => {
      (el as HTMLElement).click();
      await sleep(CLICK_WAIT_MS);
    },
    wait: sleep,
    now: () => Date.now(),
    // 已站内切页时不滚：旧页面的位置对新页面没有意义
    restore: () => {
      if (samePage()) scrollTo(startY, startX);
    },
  };
}
