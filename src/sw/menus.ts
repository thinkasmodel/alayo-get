// 右键菜单的创建（DESIGN.md §4）：先清空再建。安装、更新和每次浏览器启动都会调用（ALAG-7）。
import { currentLang, t } from '@/shared/i18n';
import { languageName, resolveTarget, type TargetSetting } from '@/core/translate/targets';
import { CONTEXT_MENUS, MENU_SAVE_PAGE, MENU_SAVE_PAGE_TRANSLATE, type MenuContext } from './route';

export interface MenuItem {
  readonly id: string;
  readonly title: string;
  readonly context: MenuContext;
}

/**
 * 这次要创建哪些右键菜单项（ALAG-27）：浏览器支持本机翻译且没开「总是翻译」时，
 * 在「存入 Alayo Get」之后加「并翻译成〈语言〉」；其余情况与原来相同。
 */
export function contextMenusFor(settings: { target: TargetSetting; always: boolean }, supported: boolean): MenuItem[] {
  const items: MenuItem[] = [];
  for (const menu of CONTEXT_MENUS) {
    items.push(menu);
    if (menu.id === MENU_SAVE_PAGE && supported && !settings.always) {
      items.push({
        id: MENU_SAVE_PAGE_TRANSLATE,
        title: t('menu_savePageTranslate', [languageName(resolveTarget(settings.target, currentLang()))]),
        context: 'page',
      });
    }
  }
  return items;
}

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
export function createMenuInstaller(
  api: MenusApi,
  itemsFor: () => ReadonlyArray<MenuItem> | Promise<ReadonlyArray<MenuItem>> = () => CONTEXT_MENUS,
): () => Promise<void> {
  let last: Promise<void> = Promise.resolve();
  const build = async () => {
    await api.removeAll();
    for (const menu of await itemsFor()) await createOne(api, { id: menu.id, title: menu.title, contexts: [menu.context] });
  };
  return () => {
    // 上一次失败不影响这一次；这一次的结果原样交给调用方
    const run = last.catch(() => undefined).then(build);
    last = run;
    return run;
  };
}
