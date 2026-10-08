import { describe, expect, it, vi } from 'vitest';
import { createPageDriver } from './driver';

function fakeWindow(href: string) {
  const win = {
    location: { href },
    scrollX: 0,
    scrollY: 1200,
    innerHeight: 800,
    scrollTo: vi.fn(),
  };
  return win;
}

describe('createPageDriver().restore', () => {
  it('同一页面：滚回创建时的位置', () => {
    const win = fakeWindow('https://x.com/a/status/1');
    const driver = createPageDriver(document, win as unknown as Window);
    driver.restore();
    expect(win.scrollTo).toHaveBeenCalledWith({ top: 1200, left: 0, behavior: 'instant' });
  });

  it('同一帖子打开图片灯箱（/photo/1）、带查询参数：不算切页，照常滚回', () => {
    const win = fakeWindow('https://x.com/a/status/1');
    const driver = createPageDriver(document, win as unknown as Window);
    win.location.href = 'https://x.com/a/status/1/photo/1';
    expect(driver.navigatedAway()).toBe(false);
    win.location.href = 'https://x.com/a/status/1?s=20';
    expect(driver.navigatedAway()).toBe(false);
    driver.restore();
    expect(win.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('已站内切页：不滚动（ALAG-3 codex 第 3 轮）', () => {
    const win = fakeWindow('https://x.com/a/status/1');
    const driver = createPageDriver(document, win as unknown as Window);
    win.location.href = 'https://x.com/b/status/2';
    expect(driver.navigatedAway()).toBe(true);
    driver.restore();
    expect(win.scrollTo).not.toHaveBeenCalled();
  });
});
