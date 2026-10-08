// 摘录里替换图片的链接文字随语言变化（ALAG-7）：英文 [Image](…)。
import { afterEach, describe, expect, it } from 'vitest';
import { useLocale } from '../../tests/setup/i18n';
import { rangeToMarkdown } from './quote';

afterEach(() => {
  document.body.replaceChildren();
});

describe('英文：摘录里的图片链接', () => {
  it('图片只留 [Image](绝对地址)', () => {
    useLocale('en');
    document.body.innerHTML = '<p id="p">Before <img src="/images/a.png"> after</p>';
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p') as Node);
    expect(rangeToMarkdown(range, 'https://blog.example.com/posts/1')).toContain('[Image](https://blog.example.com/images/a.png)');
  });
});
