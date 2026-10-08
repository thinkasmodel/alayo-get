import { describe, expect, it } from 'vitest';
import { createMenuInstaller, type MenusApi } from './menus';
import { CONTEXT_MENUS } from './route';

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
