import { describe, expect, it } from 'vitest';
import { contextMenusFor, createMenuInstaller, type MenusApi } from './menus';
import { CONTEXT_MENUS, MENU_SAVE_PAGE, MENU_SAVE_PAGE_TRANSLATE } from './route';

/**
 * 模拟 Chrome 的 contextMenus：调用按发出顺序排队、异步处理（像发往浏览器进程的 IPC）；
 * 建一个已存在的 id 时，回调里的 lastError 为 “Cannot create item with duplicate id …”。
 */
function fakeMenus() {
  const items = new Set<string>();
  const errors: string[] = [];
  let lastError: { message: string } | undefined;
  let queue = Promise.resolve();
  const enqueue = (op: () => void) => {
    queue = queue.then(() => new Promise<void>((resolve) => setTimeout(resolve, 0))).then(op);
    return queue;
  };
  const api: MenusApi = {
    removeAll: () => enqueue(() => items.clear()),
    create: (props, callback) => {
      void enqueue(() => {
        if (items.has(props.id)) {
          lastError = { message: `Cannot create item with duplicate id ${props.id}` };
          errors.push(lastError.message);
        } else items.add(props.id);
        callback();
        lastError = undefined;
      });
      return props.id;
    },
    lastError: () => lastError,
  };
  const settle = () => queue.then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  return { api, items, errors, settle };
}

describe('右键菜单重建', () => {
  it('建出 6 项', async () => {
    const fake = fakeMenus();
    await createMenuInstaller(fake.api)();
    await fake.settle();
    expect([...fake.items].sort()).toEqual(CONTEXT_MENUS.map((m) => m.id).sort());
    expect(fake.errors).toEqual([]);
  });

  // UTM 实测（docs/research/ALAG-7-utm-results.md）：浏览器启动时偶发 “duplicate id”，两次重建同时在跑
  it('两次重建同时调用时不会重复建同一 id', async () => {
    const fake = fakeMenus();
    const install = createMenuInstaller(fake.api);
    await Promise.all([install(), install()]);
    await fake.settle();
    expect(fake.errors).toEqual([]);
    expect([...fake.items].sort()).toEqual(CONTEXT_MENUS.map((m) => m.id).sort());
  });

  it('create 失败时 reject，不留未检查的 lastError', async () => {
    const fake = fakeMenus();
    const failing: MenusApi = {
      ...fake.api,
      create: (props, callback) => fake.api.create({ ...props, id: 'save-page' }, callback),
    };
    await expect(createMenuInstaller(failing)()).rejects.toThrow(/duplicate id/);
  });

  it('上一次重建失败后，下一次照常重建', async () => {
    const fake = fakeMenus();
    let failOnce = true;
    const flaky: MenusApi = {
      ...fake.api,
      removeAll: () => {
        if (failOnce) {
          failOnce = false;
          return Promise.reject(new Error('removeAll failed'));
        }
        return fake.api.removeAll();
      },
    };
    const install = createMenuInstaller(flaky);
    const first = install();
    const second = install();
    await expect(first).rejects.toThrow('removeAll failed');
    await second;
    await fake.settle();
    expect(fake.errors).toEqual([]);
    expect([...fake.items].sort()).toEqual(CONTEXT_MENUS.map((m) => m.id).sort());
  });
});

describe('右键菜单项随翻译设置变化（ALAG-27）', () => {
  it('支持且未开「总是翻译」：在 save-page 之后加「并翻译成〈语言〉」，标题带当前默认语言名', () => {
    const items = contextMenusFor({ target: 'ja', always: false }, true);
    const ids = items.map((m) => m.id);
    expect(ids).toContain(MENU_SAVE_PAGE_TRANSLATE);
    expect(ids.indexOf(MENU_SAVE_PAGE_TRANSLATE)).toBe(ids.indexOf(MENU_SAVE_PAGE) + 1);
    expect(items.find((m) => m.id === MENU_SAVE_PAGE_TRANSLATE)?.title).toBe('存入 Alayo Get 并翻译成日语');
    expect(items.filter((m) => m.id !== MENU_SAVE_PAGE_TRANSLATE).map((m) => m.id)).toEqual(CONTEXT_MENUS.map((m) => m.id));
  });

  it('开了「总是翻译」或浏览器不支持：不含这一项', () => {
    for (const [always, supported] of [
      [true, true],
      [false, false],
      [true, false],
    ] as const) {
      const ids = contextMenusFor({ target: 'auto', always }, supported).map((m) => m.id);
      expect(ids).toEqual(CONTEXT_MENUS.map((m) => m.id));
      expect(ids).not.toContain(MENU_SAVE_PAGE_TRANSLATE);
    }
  });

  it('auto 跟随界面语言（默认中文界面为简体中文）', () => {
    const item = contextMenusFor({ target: 'auto', always: false }, true).find((m) => m.id === MENU_SAVE_PAGE_TRANSLATE);
    expect(item?.context).toBe('page');
    expect(item?.title).toContain('简体中文');
  });
});
