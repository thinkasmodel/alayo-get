// 界面与剪藏文件文字的取用入口（ALAG-7）。文案放在 public/_locales/<locale>/messages.json，
// Chrome 按浏览器界面语言选一份：zh_CN、zh_TW（内容与 zh_CN 相同）显示简体中文，其余语言回落到 en。
// 不许在模块顶层调用 t()/tn()：测试换语言、换消息源都发生在模块加载之后。
// MAIN world 的代码（src/page/x/annotate.ts）没有 browser.i18n，不能引入本模块。
import { browser } from 'wxt/browser';

/** WXT 按 public/_locales/en/messages.json 生成的 getMessage 键名（最后一个重载是全部键名的联合），去掉 Chrome 预定义的 `@@` 键。 */
export type MessageKey = Exclude<Parameters<typeof browser.i18n.getMessage>[0], `@@${string}`>;

type PluralBase<K> = K extends `${infer B}_one` ? (`${B}_other` extends MessageKey ? B : never) : never;

/** 同时有 `<key>_one` 与 `<key>_other` 的 key（tn 用）。 */
export type PluralKey = PluralBase<MessageKey>;

export type Substitutions = string | string[];

type MessageSource = (key: string, subs?: Substitutions) => string;

const chromeSource: MessageSource = (key, subs) => browser.i18n.getMessage(key as MessageKey, subs);

let source: MessageSource = chromeSource;

/** 只供测试：换掉消息源（传 null 恢复为 browser.i18n.getMessage）。 */
export function setMessageSourceForTest(next: MessageSource | null): void {
  source = next ?? chromeSource;
}

/** 该键的文案；键不存在（getMessage 返回空串）时打一次错误日志，返回键名本身。 */
export function t(key: MessageKey, subs?: Substitutions): string {
  const message = source(key, subs);
  if (message === '') {
    console.error(`[Alayo Get] 缺少文案：${key}`);
    return key;
  }
  return message;
}

/** 当前文案的语言：Chrome 实际选中的那份 messages.json 里的 uiLang。 */
export function currentLang(): 'zh' | 'en' {
  return t('uiLang') === 'zh' ? 'zh' : 'en';
}

/** 单复数：en 且 n 为 1 取 `<key>_one`，其余取 `<key>_other`；n 作为第一个替换值 `$1`，subs 依次接在后面。 */
export function tn(key: PluralKey, n: number, subs?: Substitutions): string {
  const rest = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
  const form = currentLang() === 'en' && n === 1 ? 'one' : 'other';
  return t(`${key}_${form}` as MessageKey, [String(n), ...rest]);
}
