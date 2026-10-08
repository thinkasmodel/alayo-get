// 文案文件与 t/tn/currentLang（ALAG-7 brief A §6）。
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { chromeGetMessage, CJK, loadMessages, useLocale, type Messages } from '../../tests/setup/i18n';
import { currentLang, setMessageSourceForTest, t, tn } from './i18n';
import enRaw from '../../public/_locales/en/messages.json?raw';
import zhCnRaw from '../../public/_locales/zh_CN/messages.json?raw';
import zhTwRaw from '../../public/_locales/zh_TW/messages.json?raw';

const LOCALES = ['en', 'zh_CN', 'zh_TW'] as const;
const NAMED = /\$([A-Za-z0-9_@]+)\$/g;

const all = Object.fromEntries(LOCALES.map((l) => [l, loadMessages(l)])) as Record<(typeof LOCALES)[number], Messages>;
const sortedKeys = (m: Messages) => Object.keys(m).sort();
const placeholderNames = (m: Messages, key: string) => Object.keys(m[key]?.placeholders ?? {}).map((n) => n.toLowerCase()).sort();

describe('messages.json：三份文案的一致性', () => {
  it('en、zh_CN、zh_TW 键集完全相同；键名只用 [A-Za-z0-9_]', () => {
    expect(sortedKeys(all.zh_CN)).toEqual(sortedKeys(all.en));
    expect(sortedKeys(all.zh_TW)).toEqual(sortedKeys(all.en));
    for (const key of Object.keys(all.en)) expect(key, key).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it('zh_TW 与 zh_CN 逐字相同', () => {
    expect(all.zh_TW).toEqual(all.zh_CN);
  });

  it('每个键在三份里的 placeholders 名字集合相同', () => {
    for (const key of Object.keys(all.en)) {
      const names = placeholderNames(all.en, key);
      expect(placeholderNames(all.zh_CN, key), key).toEqual(names);
      expect(placeholderNames(all.zh_TW, key), key).toEqual(names);
    }
  });

  it('message 里的 $name$ 都在 placeholders 里定义；没有裸 $1…$9', () => {
    for (const locale of LOCALES) {
      for (const [key, entry] of Object.entries(all[locale])) {
        const defined = new Set(placeholderNames(all[locale], key));
        for (const [, name] of entry.message.matchAll(NAMED)) expect(defined.has((name ?? '').toLowerCase()), `${locale} ${key} $${name}$`).toBe(true);
        expect(entry.message.replace(/\$\$/g, ''), `${locale} ${key}`).not.toMatch(/\$[1-9]/);
      }
    }
  });

  it('_one 与 _other 成对出现', () => {
    for (const locale of LOCALES) {
      const keys = new Set(Object.keys(all[locale]));
      for (const key of keys) {
        if (key.endsWith('_one')) expect(keys.has(`${key.slice(0, -4)}_other`), `${locale} ${key}`).toBe(true);
        if (key.endsWith('_other')) expect(keys.has(`${key.slice(0, -6)}_one`), `${locale} ${key}`).toBe(true);
      }
    }
  });

  it('en 的所有 message 不含中日韩字符', () => {
    for (const [key, entry] of Object.entries(all.en)) expect(entry.message, key).not.toMatch(CJK);
  });

  it('uiLang：en 为 en，zh_CN、zh_TW 为 zh；extName 两种语言都是 Alayo Get', () => {
    expect([all.en.uiLang?.message, all.zh_CN.uiLang?.message, all.zh_TW.uiLang?.message]).toEqual(['en', 'zh', 'zh']);
    expect([all.en.extName?.message, all.zh_CN.extName?.message]).toEqual(['Alayo Get', 'Alayo Get']);
  });
});

describe('测试用的 getMessage 模拟（tests/setup/i18n.ts）', () => {
  const messages: Messages = {
    a: { message: 'Hi $Who$, $$5 for $N$', placeholders: { who: { content: '$1' }, n: { content: '$2' } } },
    b: { message: 'x $1 y' },
  };

  it('$name$ 不分大小写换成 content，再换 $1…$9，$$ 变 $；缺的替换值为空串；不存在的键返回空串', () => {
    expect(chromeGetMessage(messages, 'a', ['Ada', '3'])).toBe('Hi Ada, $5 for 3');
    expect(chromeGetMessage(messages, 'a', 'Ada')).toBe('Hi Ada, $5 for ');
    expect(chromeGetMessage(messages, 'nope')).toBe('');
  });

  it('替换进来的值不再被解释', () => {
    expect(chromeGetMessage(messages, 'b', '$2 $$')).toBe('x $2 $$ y');
  });
});

describe('t、tn、currentLang', () => {
  it('默认 zh_CN：中文文案，currentLang 为 zh，tn 的 1 和 2 都取 _other', () => {
    expect(currentLang()).toBe('zh');
    expect(t('menu_savePage')).toBe('存入 Alayo Get');
    expect(t('saving_images', ['7', '12'])).toBe('正文已抽取，正在下载图片 7 / 12');
    expect(tn('desc_xThread', 1)).toBe('X 作者串 · 1 条');
    expect(tn('desc_xThread', 2)).toBe('X 作者串 · 2 条');
    expect(tn('desc_withImages', 1, '文章剪藏')).toBe('文章剪藏 · 含 1 张图片');
  });

  it("useLocale('en')：英文文案，currentLang 为 en，tn 的 1 取 _one、2 取 _other，n 是 $1、subs 接在后面", () => {
    useLocale('en');
    expect(currentLang()).toBe('en');
    expect(t('menu_savePage')).toBe('Save to Alayo Get');
    expect(t('saving_images', ['7', '12'])).toBe('Article extracted. Downloading images 7 / 12');
    expect(tn('desc_xThread', 1)).toBe('X thread · 1 post');
    expect(tn('desc_xThread', 2)).toBe('X thread · 2 posts');
    expect(tn('desc_xThread', 0)).toBe('X thread · 0 posts');
    expect(tn('desc_withImages', 1, 'Article')).toBe('Article · 1 image');
    expect(tn('desc_withImages', 2, ['Article'])).toBe('Article · 2 images');
  });

  it("useLocale('zh_TW')：显示简体中文，currentLang 为 zh", () => {
    useLocale('zh_TW');
    expect(currentLang()).toBe('zh');
    expect(t('menu_saveQuote')).toBe('摘录到 Alayo Get');
  });

  it('上一个测试切到 en 后，setup 在测试结束时恢复为 zh_CN', () => {
    useLocale('en');
    expect(currentLang()).toBe('en');
  });

  it('（接上）这里又是 zh_CN', () => {
    expect(currentLang()).toBe('zh');
  });

  it('键不存在（getMessage 返回空串）：打一次错误日志，返回键名本身，不抛错', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setMessageSourceForTest(() => '');
    expect(t('menu_savePage')).toBe('menu_savePage');
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('生产消息源是 browser.i18n.getMessage(key, subs)', () => {
    const getMessage = vi.spyOn(fakeBrowser.i18n, 'getMessage').mockReturnValue('来自 Chrome');
    setMessageSourceForTest(null);
    expect(t('file_from', '[页面](https://a/)')).toBe('来自 Chrome');
    expect(getMessage).toHaveBeenCalledWith('file_from', '[页面](https://a/)');
    getMessage.mockRestore();
  });
});

// Chrome 读 messages.json 时键名不分大小写，只差大小写的两个键会让扩展加载失败；JSON.parse 会把同名键合并，所以按原文数顶层键
describe('messages.json：顶层键名（不分大小写）不重复', () => {
  const raws = { en: enRaw, zh_CN: zhCnRaw, zh_TW: zhTwRaw };
  for (const [locale, raw] of Object.entries(raws)) {
    it(locale, () => {
      const keys = [...raw.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => (m[1] ?? '').toLowerCase());
      expect(keys.length).toBe(Object.keys(JSON.parse(raw) as object).length);
      expect(new Set(keys).size).toBe(keys.length);
    });
  }
});
