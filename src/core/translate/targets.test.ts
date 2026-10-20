import { describe, expect, it } from 'vitest';
import { useLocale } from '../../../tests/setup/i18n';
import { isTargetTag, languageName, pickTarget, resolveTarget, TARGET_LANGUAGES } from './targets';

describe('目标语言表', () => {
  it('8 种语言，标签与本地名称与设计一致', () => {
    expect(TARGET_LANGUAGES.map((l) => l.tag)).toEqual(['zh', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es']);
    expect(TARGET_LANGUAGES.find((l) => l.tag === 'ja')?.endonym).toBe('日本語');
  });

  it('isTargetTag 只认表里的标签', () => {
    for (const { tag } of TARGET_LANGUAGES) expect(isTargetTag(tag)).toBe(true);
    expect(isTargetTag('auto')).toBe(false);
    expect(isTargetTag('th')).toBe(false);
    expect(isTargetTag('')).toBe(false);
    expect(isTargetTag(undefined)).toBe(false);
  });
});

describe('resolveTarget', () => {
  it('auto 跟随界面语言：中文界面简体中文，英文界面英语', () => {
    expect(resolveTarget('auto', 'zh')).toBe('zh');
    expect(resolveTarget('auto', 'en')).toBe('en');
  });

  it('明确指定的语言不随界面变', () => {
    expect(resolveTarget('ja', 'zh')).toBe('ja');
    expect(resolveTarget('zh-Hant', 'en')).toBe('zh-Hant');
  });
});

describe('pickTarget', () => {
  const on = { target: 'ja' as const, always: true };
  const off = { target: 'ja' as const, always: false };

  it('明确指定的优先（即使没开总是翻译）', () => {
    expect(pickTarget('zh-Hant', off, false, 'zh')).toBe('zh-Hant');
  });

  it('开了总是翻译但浏览器不支持 → undefined', () => {
    expect(pickTarget(undefined, on, false, 'zh')).toBeUndefined();
  });

  it('开了总是翻译且支持 → 用设置解析后的语言', () => {
    expect(pickTarget(undefined, on, true, 'zh')).toBe('ja');
    expect(pickTarget(undefined, { target: 'auto', always: true }, true, 'en')).toBe('en');
  });

  it('都没有 → undefined；空串也不算明确指定', () => {
    expect(pickTarget(undefined, off, true, 'zh')).toBeUndefined();
    expect(pickTarget('   ', on, true, 'zh')).toBe('ja');
  });
});

describe('languageName', () => {
  it('表内语言用 lang_* 的本地化名称（zh 与 en 界面）', () => {
    expect(languageName('zh')).toBe('简体中文');
    expect(languageName('en')).toBe('英语');
    expect(languageName('zh-Hant')).toBe('繁体中文');
    useLocale('en');
    expect(languageName('zh')).toBe('Chinese (Simplified)');
    expect(languageName('en')).toBe('English');
  });

  it('表外语言用 Intl.DisplayNames（zh 与 en 界面）；认不出就返回标签本身', () => {
    expect(languageName('th')).toBe('泰语');
    useLocale('en');
    expect(languageName('th')).toBe('Thai');
    expect(languageName('zzzz')).toBe('zzzz');
  });
});
