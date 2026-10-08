// 测试里的文案来源（ALAG-7）：读 public/_locales/<locale>/messages.json，按 Chrome getMessage 的规则替换。
// 两个 vitest project 都把本文件注册为 setupFiles；默认 zh_CN，每个测试结束后恢复为 zh_CN。
import { afterEach } from 'vitest';
import { setMessageSourceForTest, type Substitutions } from '@/shared/i18n';
import enRaw from '../../public/_locales/en/messages.json?raw';
import zhCnRaw from '../../public/_locales/zh_CN/messages.json?raw';
import zhTwRaw from '../../public/_locales/zh_TW/messages.json?raw';

export type TestLocale = 'en' | 'zh_CN' | 'zh_TW';

/** 中日韩字符（含全角标点）：英文输出里不该出现。 */
export const CJK = /[\u3000-\u303F\u4E00-\u9FFF\uFF00-\uFFEF]/;

interface ChromeMessage {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string; example?: string }>;
}

export type Messages = Record<string, ChromeMessage>;

const RAW: Record<TestLocale, string> = { en: enRaw, zh_CN: zhCnRaw, zh_TW: zhTwRaw };

/** 一份 messages.json 的内容（每次重新解析，调用方改了也不影响别处）。 */
export function loadMessages(locale: TestLocale): Messages {
  return JSON.parse(RAW[locale]) as Messages;
}

/**
 * 模拟 chrome.i18n.getMessage：键不存在返回空串；先把 `$name$`（不分大小写）换成占位符的 content，
 * 再把 `$1`…`$9` 换成 subs 对应项（缺省为空串），最后 `$$` → `$`。后两步在同一遍扫描里做，替换进来的值不再被解释。
 */
export function chromeGetMessage(messages: Messages, key: string, subs?: Substitutions): string {
  const entry = messages[key];
  if (!entry) return '';
  const list = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
  const placeholders = new Map(Object.entries(entry.placeholders ?? {}).map(([name, p]) => [name.toLowerCase(), p.content]));
  const expanded = entry.message.replace(/\$([A-Za-z0-9_@]+)\$/g, (whole, name: string) => placeholders.get(name.toLowerCase()) ?? whole);
  return expanded.replace(/\$(\$|[1-9])/g, (_m, c: string) => (c === '$' ? '$' : (list[Number(c) - 1] ?? '')));
}

/** 切换测试里的文案语言；setup 在每个测试结束后恢复为 zh_CN。 */
export function useLocale(locale: TestLocale): void {
  const messages = loadMessages(locale);
  setMessageSourceForTest((key, subs) => chromeGetMessage(messages, key, subs));
}

useLocale('zh_CN');
afterEach(() => useLocale('zh_CN'));
