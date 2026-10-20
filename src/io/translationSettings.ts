// 翻译设置（ALAG-27）：目标语言与「保存时总是翻译」，以及「浏览器是否支持本机翻译」的标记。
// 标记由面板/选项页在加载时写入（SW 里没有 Translator 全局）；SW 只读它决定菜单与保存时是否翻译。
import type { TargetSetting } from '@/core/translate/targets';
import { isTargetTag } from '@/core/translate/targets';

export const TRANSLATION_SETTINGS_KEY = 'translationSettings';
export const TRANSLATION_SUPPORTED_KEY = 'translationSupported';

export interface TranslationSettings {
  target: TargetSetting;
  always: boolean;
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = { target: 'auto', always: false };

export interface TranslationStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}


export interface TranslationSettingsStore {
  get(): Promise<TranslationSettings>;
  /** 合并写：只改传入的字段。 */
  set(patch: Partial<TranslationSettings>): Promise<void>;
  getSupported(): Promise<boolean>;
  /** 值没变就不写。 */
  setSupported(value: boolean): Promise<void>;
  /** 任一键变化时回调（storage.local 的 onChanged）；返回取消函数。 */
  onChanged(cb: () => void): () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** 逐字段兜底：缺省或值不合法用默认值。 */
function normalizeSettings(raw: unknown): TranslationSettings {
  if (!isRecord(raw)) return { ...DEFAULT_TRANSLATION_SETTINGS };
  const target = raw.target;
  return {
    target: target === 'auto' || isTargetTag(target) ? target : DEFAULT_TRANSLATION_SETTINGS.target,
    always: typeof raw.always === 'boolean' ? raw.always : DEFAULT_TRANSLATION_SETTINGS.always,
  };
}

export function createTranslationSettings(area: TranslationStorage = browser.storage.local): TranslationSettingsStore {
  // 读改写串行化，避免并发 set 互相覆盖。
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  const readSettings = async (): Promise<TranslationSettings> => {
    const got = await area.get(TRANSLATION_SETTINGS_KEY);
    return normalizeSettings(got[TRANSLATION_SETTINGS_KEY]);
  };
  const readSupported = async (): Promise<boolean> => {
    const got = await area.get(TRANSLATION_SUPPORTED_KEY);
    return got[TRANSLATION_SUPPORTED_KEY] === true;
  };

  return {
    get: () => serial(readSettings),
    set: (patch) =>
      serial(async () => {
        const next = { ...(await readSettings()), ...patch };
        await area.set({ [TRANSLATION_SETTINGS_KEY]: next });
      }),
    getSupported: () => serial(readSupported),
    setSupported: (value) =>
      serial(async () => {
        if ((await readSupported()) === value) return;
        await area.set({ [TRANSLATION_SUPPORTED_KEY]: value });
      }),
    onChanged: (cb) => {
      const listener = (changes: Record<string, unknown>, areaName: string): void => {
        if (areaName !== 'local') return;
        if (TRANSLATION_SETTINGS_KEY in changes || TRANSLATION_SUPPORTED_KEY in changes) cb();
      };
      browser.storage.onChanged.addListener(listener);
      return () => browser.storage.onChanged.removeListener(listener);
    },
  };
}
