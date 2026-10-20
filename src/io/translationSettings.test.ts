import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createTranslationSettings, TRANSLATION_SETTINGS_KEY, TRANSLATION_SUPPORTED_KEY } from './translationSettings';

/** 内存 StorageArea 桩，记录写次数。 */
class MemoryArea {
  data: Record<string, unknown> = {};
  writes: Array<Record<string, unknown>> = [];
  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.data ? { [key]: this.data[key] } : {};
  }
  async set(items: Record<string, unknown>): Promise<void> {
    this.writes.push(items);
    for (const [key, value] of Object.entries(items)) this.data[key] = value;
  }
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('createTranslationSettings', () => {
  it('缺省：跟随界面语言、不总是翻译；支持标记缺省 false', async () => {
    const store = createTranslationSettings(new MemoryArea());
    expect(await store.get()).toEqual({ target: 'auto', always: false });
    expect(await store.getSupported()).toBe(false);
  });

  it('非法值逐字段兜底', async () => {
    const area = new MemoryArea();
    area.data[TRANSLATION_SETTINGS_KEY] = { target: 'klingon', always: 'yes' };
    expect(await createTranslationSettings(area).get()).toEqual({ target: 'auto', always: false });

    area.data[TRANSLATION_SETTINGS_KEY] = { target: 'ja', always: 'yes' };
    expect(await createTranslationSettings(area).get()).toEqual({ target: 'ja', always: false });

    area.data[TRANSLATION_SETTINGS_KEY] = { target: 3, always: true };
    expect(await createTranslationSettings(area).get()).toEqual({ target: 'auto', always: true });

    area.data[TRANSLATION_SETTINGS_KEY] = 'nope';
    expect(await createTranslationSettings(area).get()).toEqual({ target: 'auto', always: false });
  });

  it('set 合并写：只改传入的字段，另一项保留', async () => {
    const area = new MemoryArea();
    const store = createTranslationSettings(area);
    await store.set({ target: 'fr' });
    expect(await store.get()).toEqual({ target: 'fr', always: false });
    await store.set({ always: true });
    expect(await store.get()).toEqual({ target: 'fr', always: true });
    expect(area.data[TRANSLATION_SETTINGS_KEY]).toEqual({ target: 'fr', always: true });
  });

  it('setSupported：值没变就不写', async () => {
    const area = new MemoryArea();
    const store = createTranslationSettings(area);
    await store.setSupported(false);
    expect(area.writes).toHaveLength(0);
    await store.setSupported(true);
    await store.setSupported(true);
    expect(area.writes).toHaveLength(1);
    expect(await store.getSupported()).toBe(true);
  });

  it('onChanged：两个键的变化都触发，其他键与别的区域不触发；返回的函数取消订阅', async () => {
    const cb = vi.fn();
    const off = createTranslationSettings(new MemoryArea()).onChanged(cb);

    await fakeBrowser.storage.onChanged.trigger({ [TRANSLATION_SETTINGS_KEY]: { newValue: { target: 'ja', always: true } } }, 'local');
    await fakeBrowser.storage.onChanged.trigger({ [TRANSLATION_SUPPORTED_KEY]: { newValue: true } }, 'local');
    expect(cb).toHaveBeenCalledTimes(2);

    await fakeBrowser.storage.onChanged.trigger({ other: { newValue: 1 } }, 'local');
    await fakeBrowser.storage.onChanged.trigger({ [TRANSLATION_SETTINGS_KEY]: { newValue: {} } }, 'sync');
    expect(cb).toHaveBeenCalledTimes(2);

    off();
    await fakeBrowser.storage.onChanged.trigger({ [TRANSLATION_SETTINGS_KEY]: { newValue: {} } }, 'local');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('真实 storage.local 读写：默认值、set 与 onChanged 联动', async () => {
    const store = createTranslationSettings(fakeBrowser.storage.local as unknown as Browser.storage.StorageArea);
    const cb = vi.fn();
    const off = store.onChanged(cb);
    expect(await store.get()).toEqual({ target: 'auto', always: false });
    await store.set({ target: 'de' });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(await store.get()).toEqual({ target: 'de', always: false });
    await store.setSupported(true);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(await store.getSupported()).toBe(true);
    off();
  });
});
