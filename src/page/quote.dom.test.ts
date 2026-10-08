import { afterEach, describe, expect, it } from 'vitest';
import { captureQuote } from './quote';

// 全局 jsdom 的地址是 localhost；页面地址按参数传入，相对地址按它转成绝对地址，片段链接也接在它后面。
const PAGE = 'https://blog.example.com/posts/slow.html';

function selectAcross(start: Node, startOffset: number, end: Node, endOffset: number): void {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function textOf(selector: string): Text {
  const node = document.querySelector(selector)?.firstChild;
  if (!(node instanceof Text)) throw new Error(`${selector} 下没有文字`);
  return node;
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  document.title = '';
});

describe('captureQuote（capture-quote 的页面一侧）', () => {
  it('跨段落选区：链接转绝对地址、保留加粗、两个段落、图片只留 [图片](地址)；片段链接接在页面地址后', () => {
    document.title = '为什么我们需要慢思考';
    document.body.innerHTML = [
      '<article>',
      '<p id="p1">快思考替我们省下了大量注意力，<a href="../notes/kahneman.html">卡尼曼</a>说它几乎从不怀疑自己。</p>',
      '<p id="p2">慢思考的价值不在于更<strong>聪明</strong>，<img src="images/a.png" alt="示意">而在于它肯停下来。</p>',
      '<p id="p3">后面还有一段不选的文字。</p>',
      '</article>',
    ].join('');
    const p2 = document.querySelector('#p2');
    if (!p2) throw new Error('缺少 #p2');
    selectAcross(textOf('#p1'), 0, p2, p2.childNodes.length);

    const res = captureQuote(document, PAGE);
    expect(res.url).toBe(PAGE);
    expect(res.title).toBe('为什么我们需要慢思考');
    const quote = res.quote;
    if (!quote) throw new Error('没有取到选区');
    expect(quote.markdown).toContain('[卡尼曼](https://blog.example.com/notes/kahneman.html)');
    expect(quote.markdown).toContain('**聪明**');
    expect(quote.markdown).toContain('[图片](https://blog.example.com/posts/images/a.png)');
    expect(quote.markdown).not.toContain('![');
    // 两个段落：中间空一行
    expect(quote.markdown.split('\n\n')).toHaveLength(2);
    expect(quote.markdown.startsWith('快思考替我们')).toBe(true);
    expect(quote.markdown.endsWith('而在于它肯停下来。')).toBe(true);
    expect(quote.markdown).not.toContain('后面还有');
    expect(quote.fragmentUrl?.startsWith(`${PAGE}#:~:text=`)).toBe(true);
    expect(Number.isNaN(Date.parse(quote.selectedAt))).toBe(false);
  });

  it('中文选区同样生成片段链接', () => {
    document.body.innerHTML = '<p id="p">每一次“我早就知道”，都是一次被删改的记忆。</p><p>另一段完全不同的内容。</p>';
    selectAcross(textOf('#p'), 0, textOf('#p'), 4);
    const quote = captureQuote(document, PAGE).quote;
    expect(quote?.markdown).toBe('每一次“');
    expect(quote?.fragmentUrl?.startsWith(`${PAGE}#:~:text=`)).toBe(true);
    // 片段里的中文是百分号编码的
    expect(quote?.fragmentUrl).toContain('%E6%AF%8F%E4%B8%80%E6%AC%A1');
  });

  it('原地址带 #hash：片段接成 #hash:~:text=', () => {
    document.body.innerHTML = '<p id="p">Slow thinking is worth it.</p>';
    selectAcross(textOf('#p'), 0, textOf('#p'), 13);
    expect(captureQuote(document, `${PAGE}#sec`).quote?.fragmentUrl?.startsWith(`${PAGE}#sec:~:text=`)).toBe(true);
  });

  it('选区为空（没有选区或只是光标）时回传取不到：quote 为 null', () => {
    document.title = '页面';
    document.body.innerHTML = '<p id="p">一段文字。</p>';
    expect(captureQuote(document, PAGE)).toEqual({ url: PAGE, title: '页面', quote: null });
    selectAcross(textOf('#p'), 2, textOf('#p'), 2);
    expect(captureQuote(document, PAGE).quote).toBeNull();
  });

  it('焦点在输入框里（选区在 textarea 里）时视为取不到', () => {
    document.body.innerHTML = '<p id="p">一段文字。</p><textarea>输入框里的字</textarea>';
    selectAcross(textOf('#p'), 0, textOf('#p'), 3);
    document.querySelector('textarea')?.focus();
    expect(captureQuote(document, PAGE).quote).toBeNull();
  });

  it('选区在链接和加粗里面：按原样包上行内格式祖先，链接转绝对地址', () => {
    document.body.innerHTML = '<p id="p">see <a href="/r"><strong>the full report</strong></a> now</p>';
    const text = document.querySelector('strong')?.firstChild;
    if (!(text instanceof Text)) throw new Error('没有文字');
    selectAcross(text, 4, text, 8);
    expect(captureQuote(document, PAGE).quote?.markdown).toBe('[**full**](https://blog.example.com/r)');
  });

  it('选区跨越块级元素时不往外包行内祖先', () => {
    document.body.innerHTML = '<div><p id="a">第一段</p><p id="b">第二段</p></div>';
    selectAcross(textOf('#a'), 0, textOf('#b'), 3);
    expect(captureQuote(document, PAGE).quote?.markdown).toBe('第一段\n\n第二段');
  });

  it('代码块选区：保留换行和缩进，输出围栏代码块', () => {
    document.body.innerHTML = '<pre><code>if ready:\n    run()\nelse:\n    wait()</code></pre>';
    const text = document.querySelector('code')?.firstChild;
    if (!(text instanceof Text)) throw new Error('没有文字');
    selectAcross(text, 0, text, text.length);
    const md = captureQuote(document, PAGE).quote?.markdown ?? '';
    expect(md.startsWith('```')).toBe(true);
    expect(md).toContain('if ready:\n    run()\nelse:\n    wait()');
  });

  it('代码块被高亮拆成多个 span：跨 span 选区同样保留换行和缩进', () => {
    document.body.innerHTML = '<pre><code><span>if</span> ready:\n    <span>run</span>()</code></pre>';
    const spans = document.querySelectorAll('span');
    const first = spans[0]?.firstChild;
    const last = spans[1]?.firstChild;
    if (!(first instanceof Text) || !(last instanceof Text)) throw new Error('没有文字');
    selectAcross(first, 0, last, last.length);
    const md = captureQuote(document, PAGE).quote?.markdown ?? '';
    expect(md.startsWith('```')).toBe(true);
    expect(md).toContain('if ready:\n    run');
  });

  it('不改动页面真实选区，连续采集结果一致', () => {
    document.body.innerHTML = '<p id="p">The full report is ready.</p>';
    selectAcross(textOf('#p'), 5, textOf('#p'), 7);
    const before = document.getSelection()?.getRangeAt(0);
    const snapshot = { start: before?.startOffset, end: before?.endOffset, text: before?.toString() };
    const first = captureQuote(document, PAGE).quote?.markdown;
    const second = captureQuote(document, PAGE).quote?.markdown;
    const after = document.getSelection()?.getRangeAt(0);
    expect({ start: after?.startOffset, end: after?.endOffset, text: after?.toString() }).toEqual(snapshot);
    expect(first).toBe('ul');
    expect(second).toBe('ul');
  });
});

describe('captureQuote：相对地址按文档 baseURI 解析', () => {
  it('<base href> 下，链接与图片按 base 转绝对地址；片段链接仍接在页面地址后', () => {
    // jsdom 里往 head 加 <base> 会改变 document.baseURI；测完移除
    const base = document.createElement('base');
    base.href = 'https://cdn.example.net/docs/';
    document.head.append(base);
    try {
      document.body.innerHTML = '<p id="p">前文 <a href="guide.html">阅读指南</a> 与图 <img src="fig.png"> 后文</p>';
      selectAcross(textOf('#p'), 0, textOf('#p').parentElement?.lastChild as Node, 3);
      const res = captureQuote(document, 'https://example.com/article');
      expect(res.quote?.markdown).toContain('[阅读指南](https://cdn.example.net/docs/guide.html)');
      expect(res.quote?.markdown).toContain('[图片](https://cdn.example.net/docs/fig.png)');
      expect(res.quote?.fragmentUrl?.startsWith('https://example.com/article#:~:text=')).toBe(true);
    } finally {
      base.remove();
    }
  });
});
