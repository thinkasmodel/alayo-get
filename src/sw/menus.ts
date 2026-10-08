// 右键菜单的创建（DESIGN.md §4）：先清空再建。安装、更新和每次浏览器启动都会调用（ALAG-7）。
import { CONTEXT_MENUS, type MenuContext } from './route';

/** contextMenus API 里本模块用到的部分（测试注入）。 */
export interface MenusApi {
  removeAll(): Promise<void>;
  create(props: { id: string; title: string; contexts: [MenuContext] }, callback: () => void): unknown;
  /** 读 `runtime.lastError`：create 的回调里用它判断是否失败。 */
  lastError(): { message?: string } | undefined;
}

/** 建一项，等浏览器回调确认；失败（如 id 重复）时 reject，lastError 在回调里读掉，不留“未检查”。 */
function createOne(api: MenusApi, props: { id: string; title: string; contexts: [MenuContext] }): Promise<void> {
  return new Promise((resolve, reject) => {
    api.create(props, () => {
      const err = api.lastError();
      if (err) reject(new Error(err.message ?? `contextMenus.create failed: ${props.id}`));
      else resolve();
    });
  });
}

/**
 * 返回“重建右键菜单”函数。多次调用按顺序排队：上一次的清空和创建全部确认完，下一次才开始清空。
 * 浏览器启动时 onStartup 与 onInstalled 可能先后触发，两次重建若同时跑，会各自清空后各建一遍，撞上重复 id（UTM 实测，ALAG-7）。
 */
export function createMenuInstaller(api: MenusApi): () => Promise<void> {
  let last: Promise<void> = Promise.resolve();
  const build = async () => {
    await api.removeAll();
    for (const menu of CONTEXT_MENUS) await createOne(api, { id: menu.id, title: menu.title, contexts: [menu.context] });
  };
  return () => {
    // 上一次失败不影响这一次；这一次的结果原样交给调用方
    const run = last.catch(() => undefined).then(build);
    last = run;
    return run;
  };
}
