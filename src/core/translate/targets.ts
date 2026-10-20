// 目标语言表与解析（ALAG-27）：面板/选项页的下拉框、右键菜单的语言名与「保存时总是翻译」共用。
// 表内语言在句子里用本地化名称（lang_*），表外语言用 Intl.DisplayNames 现取（ALAG-27 §2）。
import { currentLang, t, type MessageKey } from '@/shared/i18n';
import { toApiTag } from './language';

/** 目标语言下拉框的 8 种语言；endonym 在中英界面显示相同。 */
export const TARGET_LANGUAGES = [
  { tag: 'zh', endonym: '简体中文', nameKey: 'lang_zh' },
  { tag: 'zh-Hant', endonym: '繁體中文', nameKey: 'lang_zhHant' },
  { tag: 'en', endonym: 'English', nameKey: 'lang_en' },
  { tag: 'ja', endonym: '日本語', nameKey: 'lang_ja' },
  { tag: 'ko', endonym: '한국어', nameKey: 'lang_ko' },
  { tag: 'fr', endonym: 'Français', nameKey: 'lang_fr' },
  { tag: 'de', endonym: 'Deutsch', nameKey: 'lang_de' },
  { tag: 'es', endonym: 'Español', nameKey: 'lang_es' },
] as const satisfies ReadonlyArray<{ tag: string; endonym: string; nameKey: MessageKey }>;

export type TargetTag = (typeof TARGET_LANGUAGES)[number]['tag'];

/** 设置里的目标语言：跟随界面语言，或 8 种之一。 */
export type TargetSetting = 'auto' | TargetTag;

export function isTargetTag(x: unknown): x is TargetTag {
  return typeof x === 'string' && TARGET_LANGUAGES.some((language) => language.tag === x);
}

/** 'auto' → 界面语言：中文界面用简体中文，其余用英文。 */
export function resolveTarget(setting: TargetSetting, uiLang: 'zh' | 'en'): TargetTag {
  if (setting !== 'auto') return setting;
  return uiLang === 'zh' ? 'zh' : 'en';
}

/** 句子里用的语言名：表内语言用 t(nameKey)；表外语言用 Intl.DisplayNames，取不到就返回标签本身。 */
export function languageName(tag: string): string {
  const known = TARGET_LANGUAGES.find((language) => language.tag === tag) ?? TARGET_LANGUAGES.find((language) => language.tag === toApiTag(tag));
  if (known) return t(known.nameKey);
  try {
    const locale = currentLang() === 'zh' ? 'zh-CN' : 'en';
    const name = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(tag);
    return name !== undefined && name !== '' ? name : tag;
  } catch {
    return tag;
  }
}

/**
 * 这次保存用哪个目标语言：明确指定的优先；否则开了「总是翻译」且浏览器支持时用设置；
 * 都不满足返回 undefined（不翻）。
 */
export function pickTarget(
  explicit: string | undefined,
  settings: { target: TargetSetting; always: boolean },
  supported: boolean,
  uiLang: 'zh' | 'en',
): string | undefined {
  const chosen = explicit?.trim();
  if (chosen !== undefined && chosen !== '') return chosen;
  if (!settings.always || !supported) return undefined;
  return resolveTarget(settings.target, uiLang);
}
