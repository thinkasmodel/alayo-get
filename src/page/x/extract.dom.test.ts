import { describe, expect, it } from 'vitest';
import article0x from '../../../tests/fixtures/x/article-0xcodila.html?raw';
import articleCanghe from '../../../tests/fixtures/x/article-canghe.html?raw';
import articleIntuit from '../../../tests/fixtures/x/article-intuitmachine.html?raw';
import quoteMarcel from '../../../tests/fixtures/x/quote-marcelkargul.html?raw';
import videoP4n from '../../../tests/fixtures/x/video-p4nthera.html?raw';
import videoViktor from '../../../tests/fixtures/x/video-viktoroddy.html?raw';
import { extractX } from './extract';
import { localDate, plainText } from './markdown';
import { fixtureUrl, loadFixture, snapshotDriver } from './testkit';

async function run(html: string) {
  const doc = loadFixture(html);
  const driver = snapshotDriver([doc]);
  const capture = await extractX(doc, fixtureUrl(html), driver);
  return { capture, md: capture.markdown ?? '', driver };
}

/** 去掉围栏代码块（代码里的 `# ` 不是标题）。 */
const outsideFences = (md: string) => md.replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1$/gm, '');

describe('extractX', () => {
  it('video-p4nthera：单帖，视频封面和时长链接，不含评论区', async () => {
    const { capture, md } = await run(videoP4n);
    expect(capture.kind).toBe('page');
    expect(capture.url).toBe('https://x.com/p4nthera_/status/2107175720086589633');
    const lead = Array.from('I built a growing gallery of motion graphics made with Claude Opus 5.5').slice(0, 30).join('');
    expect(capture.title).toBe(`@p4nthera_ - ${lead}`);
    expect(capture.author).toBe('p4n (@p4nthera_)');
    expect(capture.published).toBe('2026-10-05T18:26:55.000Z');
    expect(capture.site).toBe('x.com');
    expect(capture.description).toBe('');
    expect(capture.coverUrl).toBe('');
    expect(capture.x).toEqual({ form: 'post', posts: 1, partial: null });
    expect(md).toContain('[▶ 视频 (0:12)](https://x.com/p4nthera_/status/2107175720086589633/video/1)');
    expect(md).toContain('![](https://pbs.twimg.com/amplify_video_thumb/2107174478845276160/img/QuEMiQF0P2B7UbVp.jpg)');
    expect(md).toContain('[prompt-motion.com](https://prompt-motion.com)');
    for (const comment of ['designzombie', 'Can I add this source', 'slvDev']) expect(md).not.toContain(comment);
    expect(md).not.toMatch(/^# /m);
    expect(capture.textLength).toBe(plainText(md).length);
    expect(capture.textLength).toBeGreaterThan(0);
  });

  it('video-viktoroddy：作者串 2 条，不含别人的回复文字与图片', async () => {
    const { capture, md } = await run(videoViktor);
    expect(capture.x).toMatchObject({ form: 'thread', posts: 2, partial: null });
    expect(capture.url).toBe('https://x.com/viktoroddy/status/2107279715195392141');
    expect(md).toContain('[▶ 视频 (0:13)](https://x.com/viktoroddy/status/2107279715195392141/video/1)');
    expect(md).toContain('Access this free prompt');
    for (const other of ['Summer', 'Astra’s bird literally', 'Yeah openai models', 'Astra is definitely weaker']) expect(md).not.toContain(other);
    // 别人的回复里的图片不在正文里
    const doc = loadFixture(videoViktor);
    const others = [...doc.querySelectorAll('article[data-testid="tweet"]')]
      .filter((a) => !/"id":"(2107279715195392141|2107282370500182194)"/.test(a.getAttribute('data-alayo-x') ?? ''))
      .flatMap((a) => [...a.querySelectorAll('img[src^="https://pbs.twimg.com/media/"]')].map((img) => (img.getAttribute('src') ?? '').split('?')[0]));
    for (const src of others) expect(md).not.toContain(src as string);
  });

  it('quote-marcelkargul：引用头带作者、日期、原帖链接', async () => {
    const { md } = await run(quoteMarcel);
    const date = localDate('2026-09-14T10:37:23.000Z');
    expect(md).toContain(`> **Marcel (@marcelkargul)** · ${date} · [原帖](https://x.com/marcelkargul/status/2099447410804035806)`);
    expect(md).toContain('[github.com/kargulstudio/sales-crm](https://github.com/kargulstudio/sales-crm)');
    expect(md).toContain('> built the full CRM dashboard');
  });

  it('article-0xcodila：长文，标题、小标题、列表、代码、引用、嵌入帖子，没有一级标题', async () => {
    const { capture, md, driver } = await run(article0x);
    expect(capture.x).toEqual({
      form: 'article',
      posts: 1,
      // 嵌入帖子 @nutlope、@altryne 在长文里被截断（codex review 第 8 轮：计入 partial）
      partial: { limit: false, timeout: false, truncated: 2 },
      heading: 'Jev Engineering: Full 10-Step Roadmap to Set Up and Use a New Brain for AI (from scratch)',
    });
    expect(capture.title).toBe('@0xCodila - Jev Engineering: Full 10-Step Roadmap to Set Up and Use a New Brain for AI (from scratch)');
    expect(capture.url).toBe('https://x.com/0xCodila/status/2100984487802708306');
    expect(capture.author).toBe('codila (@0xCodila)');
    expect(md).toMatch(/^## \S/m);
    expect(md).toMatch(/^- \S/m);
    expect(md).toMatch(/^```text\n[\s\S]+?\n```$/m);
    expect(md).toMatch(/^> \S/m);
    expect(md).toContain('**Gregor Zunic (@gregpr07)**');
    expect(md).toContain('[原帖](https://x.com/gregpr07/status/2100411066966749359)');
    expect(outsideFences(md)).not.toMatch(/^# /m);
    // 封面在最前；正文图片改成 name=large
    expect(md.startsWith('![](https://pbs.twimg.com/media/HSgY7VCXUAAWG9f?format=jpg&name=large)')).toBe(true);
    expect(md).toContain('![](https://pbs.twimg.com/media/HSgq7fkWMAAagx3?format=jpg&name=large)');
    expect(md).not.toContain('name=medium');
    // 行内加粗、斜体、链接保留
    expect(md).toContain('[TypeSafe Playground](https://console.typesafe.ai/playground)');
    expect(md).toMatch(/\*choose a worker/);
    // 长文不滚动
    expect(driver.index).toBe(0);
    // 嵌入帖子引用里折叠的视频预览（codex review 第 4 轮）
    expect(md).toContain('> > [▶ 视频 (0:05)](https://x.com/tamarajtran/status/2100694549362553153/video/1)');
  });

  it('article-0xcodila：开始时焦点 cell 不在 DOM 里（被回收），采集到之后仍按长文转换（codex review 第 1 轮）', async () => {
    const recycled = loadFixture(article0x);
    for (const cell of recycled.querySelectorAll('[data-testid="cellInnerDiv"]')) cell.remove();
    const original = loadFixture(article0x);
    const capture = await extractX(original, fixtureUrl(article0x), snapshotDriver([recycled, original]));
    expect(capture.x).toMatchObject({ form: 'article', posts: 1, partial: { limit: false, timeout: false, truncated: 2 } });
    expect(capture.title).toBe('@0xCodila - Jev Engineering: Full 10-Step Roadmap to Set Up and Use a New Brain for AI (from scratch)');
    const md = capture.markdown ?? '';
    expect(md).toMatch(/^## \S/m);
    expect(md).toMatch(/^```text\n/m);
  });

  it('长文嵌入帖被截断：x.partial.truncated 等于被截断的嵌入帖条数，form 仍为 article；没有截断的长文 partial 为 null（codex review 第 8 轮）', async () => {
    const { capture, md } = await run(article0x);
    expect(capture.x?.form).toBe('article');
    expect(capture.x?.partial).toEqual({ limit: false, timeout: false, truncated: 2 });
    // 被截断的正是这两条
    expect(md).toContain('[全文](https://x.com/nutlope/status/2100426999546184123)');
    expect(md).toContain('[全文](https://x.com/altryne/status/2100739055923425589)');
    expect((md.match(/\[全文\]\(/g) ?? []).length).toBe(2);
    expect((await run(articleCanghe)).capture.x?.partial).toBeNull();
  });

  it('article-canghe：中文正文，图片不少于 5 张，有 2 处引用块', async () => {
    const { capture, md } = await run(articleCanghe);
    expect(capture.x?.form).toBe('article');
    expect((md.match(/^!\[\]\(/gm) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(md).toMatch(/^> \S/m);
    expect(md).toMatch(/[一-鿿]/);
  });

  it('article-intuitmachine：两个以上 ## 小标题', async () => {
    const { md } = await run(articleIntuit);
    expect((md.match(/^## \S/gm) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(outsideFences(md)).not.toMatch(/^# /m);
  });

  it('采集开始前就已站内切页：不滚动，按找不到焦点帖退化为书签（codex review 第 3 轮）', async () => {
    const doc = loadFixture(videoP4n);
    const driver = snapshotDriver([doc]);
    driver.away = true;
    const capture = await extractX(doc, fixtureUrl(videoP4n), driver);
    expect(capture.markdown).toBeNull();
    expect(capture.x).toBeUndefined();
    expect(driver.restored).toBe(1);
  });

  it('找不到焦点帖：书签退化，markdown 为 null，不带 x', async () => {
    const doc = loadFixture(videoP4n);
    const capture = await extractX(doc, 'https://x.com/p4nthera_/status/1', snapshotDriver([doc]));
    expect(capture.markdown).toBeNull();
    expect(capture.x).toBeUndefined();
    expect(capture.kind).toBe('page');
  });
});
