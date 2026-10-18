import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import { addTableRules } from '@/page/tables';
import { assetPath, planImages, rewriteImages } from './images';

// 与 src/page/extract.ts 相同的 Turndown 配置，用真实输出来验证列表项首行的围栏。
function turndown(): TurndownService {
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  addTableRules(service);
  return service;
}

const CODE =
  '&lt;table&gt;&lt;tr&gt;&lt;td&gt;&lt;img src="https://a.example/code.png"&gt;&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;\n![x](https://a.example/md.png)';

const CODE_PATH = assetPath('01FENCE', 1, 'png');
const MD_PATH = assetPath('01FENCE', 2, 'png');
const REAL_PATH = assetPath('01FENCE', 3, 'png');
const LOCAL = new Map([
  ['https://a.example/code.png', CODE_PATH],
  ['https://a.example/md.png', MD_PATH],
  ['https://a.example/real.png', REAL_PATH],
]);

describe('findImages：列表项首行的围栏', () => {
  it('无序列表项首行的围栏：围栏里的 HTML 表格与 Markdown 图片都不认', () => {
    const markdown = turndown().turndown(`<ul><li><pre><code>${CODE}</code></pre></li></ul>`);
    expect(markdown.startsWith('-   ```')).toBe(true);
    expect(planImages(markdown)).toEqual([]);
    expect(rewriteImages(markdown, LOCAL)).toBe(markdown);
  });

  it('有序列表项首行的围栏：围栏里的图片同样不认', () => {
    const markdown = turndown().turndown(`<ol><li><pre><code>${CODE}</code></pre></li></ol>`);
    expect(markdown.startsWith('1.  ```')).toBe(true);
    expect(planImages(markdown)).toEqual([]);
    expect(rewriteImages(markdown, LOCAL)).toBe(markdown);
  });

  it('围栏正确闭合后，同一列表里后面的普通 Markdown 图片照常识别', () => {
    const markdown = turndown().turndown(
      `<ul><li><pre><code>${CODE}</code></pre></li><li><p><img src="https://a.example/real.png" alt="y"></p></li></ul>`,
    );
    expect(planImages(markdown).map((image) => image.url)).toEqual(['https://a.example/real.png']);
    const out = rewriteImages(markdown, LOCAL);
    expect(out).toContain('![y](.assets/01FENCE/3.png)');
    expect(out).toContain('<img src="https://a.example/code.png">');
    expect(out).toContain('![x](https://a.example/md.png)');
  });
});
