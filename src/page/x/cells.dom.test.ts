import { describe, expect, it } from 'vitest';
import cardVerge from '../../../tests/fixtures/x/card-verge.html?raw';
import alchain from '../../../tests/fixtures/x/thread-alchainhust.html?raw';
import article0x from '../../../tests/fixtures/x/article-0xcodila.html?raw';
import quoteMarcel from '../../../tests/fixtures/x/quote-marcelkargul.html?raw';
import showMore from '../../../tests/fixtures/x/timeline-showmore.html?raw';
import naval2 from '../../../tests/fixtures/x/thread-naval-2.html?raw';
import videoP4n from '../../../tests/fixtures/x/video-p4nthera.html?raw';
import videoViktor from '../../../tests/fixtures/x/video-viktoroddy.html?raw';
import { classifyCell, listCells, parsePost, type XMediaVideo } from './cells';
import { articleById, loadFixture } from './testkit';

function focal(html: string, id: string) {
  const post = parsePost(articleById(loadFixture(html), id));
  if (!post) throw new Error('没有解析出帖子');
  return post;
}

describe('cell 分类', () => {
  it('naval 快照 2：帖子、按钮（“显示回复”）、分隔按结构识别', () => {
    const kinds = listCells(loadFixture(naval2)).map((c) => classifyCell(c).kind);
    expect(kinds.slice(22, 27)).toEqual(['post', 'post', 'button', 'separator', 'post']);
  });
});

describe('parsePost', () => {
  it('video-p4nthera 焦点帖：t.co 还原、1 个视频（封面、时长、链接）', () => {
    const post = focal(videoP4n, '2107175720086589633');
    expect(post.handle).toBe('p4nthera_');
    expect(post.name).toBe('p4n');
    expect(post.datetime).toBe('2026-10-05T18:26:55.000Z');
    expect(post.textMd).toContain('[prompt-motion.com](https://prompt-motion.com)');
    expect(post.textMd).not.toContain('t.co');
    expect(post.media).toHaveLength(1);
    const video = post.media[0] as XMediaVideo;
    expect(video.kind).toBe('video');
    expect(video.poster).toBe('https://pbs.twimg.com/amplify_video_thumb/2107174478845276160/img/QuEMiQF0P2B7UbVp.jpg');
    expect(video.durationMs).toBe(12836);
    expect(video.href.endsWith('/status/2107175720086589633/video/1')).toBe(true);
    expect(post.quote).toBeNull();
    expect(post.card).toBeNull();
    expect(post.truncated).toBe(false);
  });

  it('quote-marcelkargul 焦点帖：引用的原帖地址、正文、媒体各归各的', () => {
    const post = focal(quoteMarcel, '2106706492317671503');
    expect(post.quote?.url).toBe('https://x.com/marcelkargul/status/2099447410804035806');
    expect(post.textMd).toContain('https://github.com/kargulstudio/sales-crm');
    expect(post.textMd).not.toContain('skills.sh');
    expect(post.quote?.textMd).toContain('[skills.sh/jakubkrehel/skills/better-ui](https://skills.sh/jakubkrehel/skills/better-ui)');
    expect(post.quote?.textMd).not.toContain('…');
    expect(post.media).toHaveLength(1);
    expect(post.media[0]).toMatchObject({ kind: 'video', durationMs: 49280 });
    expect(post.quote?.media).toHaveLength(1);
    expect(post.quote?.media[0]).toMatchObject({
      kind: 'video',
      poster: 'https://pbs.twimg.com/amplify_video_thumb/2099445791454883840/img/eHYZyaXZ38YxAgz3.jpg',
      href: 'https://x.com/marcelkargul/status/2099447410804035806/video/1',
    });
    expect(post.quote).toMatchObject({ name: 'Marcel', handle: 'marcelkargul', datetime: '2026-09-14T10:37:23.000Z', truncated: false });
  });

  it('去掉 data-alayo-x 后再解析 quote-marcelkargul：quote.url 为空串，其余照常', () => {
    const doc = loadFixture(quoteMarcel);
    for (const a of doc.querySelectorAll('[data-alayo-x]')) a.removeAttribute('data-alayo-x');
    const post = parsePost(articleById(doc, '2106706492317671503'));
    expect(post?.quote?.url).toBe('');
    expect(post?.quote?.textMd).toContain('[skills.sh/jakubkrehel/skills/better-ui](https://skills.sh/jakubkrehel/skills/better-ui)');
    expect(post?.quote).toMatchObject({ name: 'Marcel', handle: 'marcelkargul', datetime: '2026-09-14T10:37:23.000Z' });
    // 外层正文：没有映射时按 textContent 去掉 … 还原
    expect(post?.textMd).toContain('[github.com/kargulstudio/sales-crm](https://github.com/kargulstudio/sales-crm)');
    expect(post?.media).toHaveLength(1);
    // 时长退回 DOM 角标（播放中的角标文本）
    expect(post?.media[0]).toMatchObject({ kind: 'video', durationMs: 48_000 });
    expect(post?.quote?.media).toHaveLength(1);
    // 不知道原帖地址时，引用的视频链接到外层帖子
    expect(post?.quote?.media[0]).toMatchObject({ href: 'https://x.com/marcelkargul/status/2106706492317671503' });
  });

  it('card-verge 焦点帖：卡片地址还原，标题取 aria-label 里域名之后的部分', () => {
    const post = focal(cardVerge, '2107614256485314622');
    expect(post.card?.url).toBe('https://www.theverge.com/ai-artificial-intelligence/1005004/openai-math-release-github');
    expect(post.card?.label).toBe('OpenAI drops another batch of mathematical breakthroughs');
    expect(post.media).toHaveLength(0);
  });

  it('没有链接元素的播放器卡片（thread-alchainhust 第 3 条）：地址取正文没用到的 t.co 映射，标题取说明区第二行', () => {
    const post = focal(alchain, '2031347566865166627');
    expect(post.card).toEqual({ url: 'https://www.youtube.com/watch?v=MAJ5BApYQT0', label: '🦞OpenClaw养虾指南：从入门到精通（赠98页pdf资料）' });
  });

  it('video-viktoroddy 焦点帖：时间链接带 /history 也能解析出 id', () => {
    const post = focal(videoViktor, '2107279715195392141');
    expect(post.id).toBe('2107279715195392141');
    expect(post.url).toBe('https://x.com/viktoroddy/status/2107279715195392141');
    expect(post.media[0]).toMatchObject({ kind: 'video', durationMs: 13866 });
  });

  it('timeline-showmore 的帖子：truncated 为 true', () => {
    const post = focal(showMore, '2031212582510674055');
    expect(post.truncated).toBe(true);
    expect(post.handle).toBe('AlchainHust');
  });

  it('折叠的视频预览（previewInterstitial）算视频：article-0xcodila 里 altryne 帖子引用的 tamarajtran（codex review 第 4 轮）', () => {
    const doc = loadFixture(article0x);
    const altryne = [...doc.querySelectorAll('article[data-testid="tweet"]')].find((a) =>
      (a.getAttribute('data-alayo-x') ?? '').includes('"id":"2100739055923425589"'),
    );
    const post = altryne ? parsePost(altryne) : null;
    // 外层自己的两张图不变
    expect(post?.media.map((m) => m.kind)).toEqual(['photo', 'photo']);
    expect(post?.quote?.media).toHaveLength(1);
    const video = post?.quote?.media[0] as XMediaVideo;
    expect(video).toMatchObject({ kind: 'video', durationMs: 5_000 });
    expect(video.poster).toBe('https://pbs.twimg.com/amplify_video_thumb/2100694537672998912/img/OF8vottg6-45ZgNl?format=jpg&name=240x240');
    expect(video.href).toBe('https://x.com/tamarajtran/status/2100694549362553153/video/1');
  });
});
