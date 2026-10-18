import { describe, expect, it } from 'vitest';
import { sameLanguage, toApiTag } from './language';

describe('toApiTag', () => {
  it.each([
    ['zh', 'zh'],
    ['zh-cn', 'zh'],
    ['zh-SG', 'zh'],
    ['zh-Hans', 'zh'],
    ['zh-Hans-CN', 'zh'],
    ['zh-TW', 'zh-Hant'],
    ['zh-hk', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    ['zh-Hant', 'zh-Hant'],
    ['zh-Hant-TW', 'zh-Hant'],
    ['en-US', 'en'],
    ['PT-br', 'pt'],
  ])('%s → %s', (input, expected) => {
    expect(toApiTag(input)).toBe(expected);
  });

  it('不以 zh 开头的标签不会被当成中文', () => {
    expect(toApiTag('zhx')).toBe('zhx');
    expect(toApiTag('zhx-CN')).toBe('zhx');
  });
});

describe('sameLanguage', () => {
  it('简体中文的不同写法同语言', () => {
    expect(sameLanguage('zh-CN', 'zh-Hans')).toBe(true);
  });

  it('繁体与简体不同语言', () => {
    expect(sameLanguage('zh-TW', 'zh')).toBe(false);
  });

  it('地区变体同语言', () => {
    expect(sameLanguage('en-GB', 'en')).toBe(true);
  });
});
