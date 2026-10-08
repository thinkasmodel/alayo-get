// 右键菜单与右键直接失败的英文文案（ALAG-7 brief A §8）。
import { describe, expect, it } from 'vitest';
import { useLocale } from '../../tests/setup/i18n';
import { CONTEXT_MENUS, routeContextClick } from './route';

describe('英文：右键菜单', () => {
  it('6 个 title 与文案表一致', () => {
    useLocale('en');
    expect(CONTEXT_MENUS.map((m) => [m.id, m.title, m.context])).toEqual([
      ['save-page', 'Save to Alayo Get', 'page'],
      ['save-link', 'Save link to Alayo Get', 'link'],
      ['save-image', 'Save image to Alayo Get', 'image'],
      ['save-video', 'Save video to Alayo Get', 'video'],
      ['save-audio', 'Save audio to Alayo Get', 'audio'],
      ['save-quote', 'Save quote to Alayo Get', 'selection'],
    ]);
  });

  it('title 每次读取时按当前语言取（不是模块加载时取定的）', () => {
    useLocale('en');
    expect(CONTEXT_MENUS[0]?.title).toBe('Save to Alayo Get');
    useLocale('zh_CN');
    expect(CONTEXT_MENUS[0]?.title).toBe('存入 Alayo Get');
  });
});

describe('英文：右键直接失败', () => {
  it('时间线上的 X 视频、没有可下载地址的图片', () => {
    useLocale('en');
    expect(routeContextClick({ menuItemId: 'save-video', srcUrl: 'blob:https://x.com/1', pageUrl: 'https://x.com/home' })).toEqual({
      action: 'fail',
      name: 'XVideoNeedsPost',
      message: 'Can’t tell which post this is on the timeline. Open the post, then save again',
    });
    expect(routeContextClick({ menuItemId: 'save-image', srcUrl: 'blob:https://example.com/1', pageUrl: 'https://example.com/' })).toEqual({
      action: 'fail',
      name: 'NoDownloadableUrl',
      message: 'This image has no downloadable address',
    });
  });
});
