import { describe, expect, it } from 'vitest';
import articleCanghe from '../../../tests/fixtures/x/article-canghe.html?raw';
import videoP4n from '../../../tests/fixtures/x/video-p4nthera.html?raw';
import quoteMarcel from '../../../tests/fixtures/x/quote-marcelkargul.html?raw';
import videoViktor from '../../../tests/fixtures/x/video-viktoroddy.html?raw';
import { isCaptureError } from '@/shared/messages';
import { quoteBox } from './cells';
import { articleById, loadFixture } from './testkit';
import { captureXVideo } from './video';

const ID = '2107175720086589633';

describe('captureXVideo', () => {
  it('帖子页：按帖子 id 取作者、正文、第一个视频的封面与时长，存成 X 视频流媒体剪藏', () => {
    const doc = loadFixture(videoP4n);
    const res = captureXVideo(doc, ID, `https://x.com/p4nthera_/status/${ID}`);
    if (isCaptureError(res)) throw new Error(res.error);
    const lead = Array.from('I built a growing gallery of motion graphics made with Claude Opus 5.5').slice(0, 30).join('');
    expect(res).toMatchObject({
      url: `https://x.com/p4nthera_/status/${ID}/video/1`,
      title: `@p4nthera_ - ${lead}`,
      author: 'p4n (@p4nthera_)',
      published: '2026-10-05T18:26:55.000Z',
      coverUrl: 'https://pbs.twimg.com/amplify_video_thumb/2107174478845276160/img/QuEMiQF0P2B7UbVp.jpg',
      markdown: null,
      kind: 'stream',
      fetched: true,
      stream: { platform: 'x', videoId: ID, embed: '', duration: 12, medium: 'video' },
    });
    expect(res.description).toContain('I built a growing gallery of motion graphics');
  });

  it('视频专链：序号沿用地址里的 /video/<n>', () => {
    const doc = loadFixture(videoP4n);
    const res = captureXVideo(doc, ID, `https://x.com/p4nthera_/status/${ID}/video/2`);
    if (isCaptureError(res)) throw new Error(res.error);
    expect(res.url).toBe(`https://x.com/p4nthera_/status/${ID}/video/2`);
  });

  it('帖子里没有视频 → XVideoNeedsPost；找不到帖子 → XPostNotFound', () => {
    const doc = loadFixture(articleCanghe);
    const focal = [...doc.querySelectorAll('article[data-testid="tweet"]')]
      .map((a) => /"id":"(\d+)"/.exec(a.getAttribute('data-alayo-x') ?? '')?.[1])
      .find((id): id is string => id !== undefined);
    if (!focal) throw new Error('样本里没有帖子');
    const noVideo = captureXVideo(doc, focal, `https://x.com/h/status/${focal}`);
    expect(isCaptureError(noVideo) && noVideo.error.startsWith('XVideoNeedsPost')).toBe(true);
    const missing = captureXVideo(doc, '1', 'https://x.com/h/status/1');
    expect(isCaptureError(missing) && missing.error.startsWith('XPostNotFound')).toBe(true);
  });
});

describe('captureXVideo：右键视频带 srcUrl（回复里的视频不存成主帖的视频）', () => {
  const A = '2107279715195392141';
  const B = '2107282370500182194';
  const SRC_A = 'blob:https://x.com/aaaa-video';
  const SRC_B = 'blob:https://x.com/bbbb-video';

  /** 用 viktoroddy 样本里两条各有视频的帖子，各放一个 blob video（不改样本文件）。 */
  function twoVideoDoc(): Document {
    const doc = loadFixture(videoViktor);
    for (const [id, src] of [[A, SRC_A], [B, SRC_B]] as const) {
      const video = doc.createElement('video');
      video.setAttribute('src', src);
      articleById(doc, id).appendChild(video);
    }
    return doc;
  }

  it('传 B 的 srcUrl：结果是 B 的 status id 与作者（即使 statusId 是 A）', () => {
    const res = captureXVideo(twoVideoDoc(), A, `https://x.com/viktoroddy/status/${A}`, SRC_B);
    if (isCaptureError(res)) throw new Error(res.error);
    expect(res.url).toBe(`https://x.com/viktoroddy/status/${B}/video/1`);
    expect(res.stream?.videoId).toBe(B);
  });

  it('传 A 的 srcUrl：主帖；不传 srcUrl：按 statusId 找焦点帖', () => {
    const doc = twoVideoDoc();
    const withA = captureXVideo(doc, B, `https://x.com/viktoroddy/status/${B}`, SRC_A);
    if (isCaptureError(withA)) throw new Error(withA.error);
    expect(withA.stream?.videoId).toBe(A);
    const without = captureXVideo(doc, B, `https://x.com/viktoroddy/status/${B}`);
    if (isCaptureError(without)) throw new Error(without.error);
    expect(without.stream?.videoId).toBe(B);
  });

  it('srcUrl 对应的 video 所在帖子没有视频 → XVideoNeedsPost；页面上没有这个 src → XVideoNeedsPost（不退回焦点帖）', () => {
    const doc = twoVideoDoc();
    const noVideoArticle = [...doc.querySelectorAll('article[data-testid="tweet"]')].find((a) => !a.querySelector('video'));
    const stray = doc.createElement('video');
    stray.setAttribute('src', 'blob:https://x.com/stray');
    noVideoArticle?.appendChild(stray);
    const res = captureXVideo(doc, A, `https://x.com/viktoroddy/status/${A}`, 'blob:https://x.com/stray');
    expect(isCaptureError(res) && res.error.startsWith('XVideoNeedsPost')).toBe(true);
    const unknown = captureXVideo(doc, A, `https://x.com/viktoroddy/status/${A}`, 'blob:https://x.com/none');
    expect(isCaptureError(unknown) && unknown.error.startsWith('XVideoNeedsPost')).toBe(true);
  });

  it('被点的是回复的 video，随后它的 src 被改掉（播放器重建），用原 srcUrl 采集 → XVideoNeedsPost，不是主帖', () => {
    const doc = twoVideoDoc();
    const first = captureXVideo(doc, A, `https://x.com/viktoroddy/status/${A}`, SRC_B);
    if (isCaptureError(first)) throw new Error(first.error);
    expect(first.stream?.videoId).toBe(B);
    const clicked = [...doc.querySelectorAll('video')].find((v) => v.getAttribute('src') === SRC_B);
    if (!clicked) throw new Error('没找到被点的 video');
    clicked.setAttribute('src', 'blob:https://x.com/rebuilt');
    const res = captureXVideo(doc, A, `https://x.com/viktoroddy/status/${A}`, SRC_B);
    expect(isCaptureError(res) && res.error.startsWith('XVideoNeedsPost')).toBe(true);
  });
});

describe('captureXVideo：引用帖里的视频按引用帖存', () => {
  const OUTER = '2106706492317671503';
  const QUOTED = '2099447410804035806';
  const SRC_Q = 'blob:https://x.com/quoted-Q';
  const SRC_O = 'blob:https://x.com/outer-O';

  /** 给外层帖自己的视频和引用框里的视频各设一个 blob src；可选去掉 data-alayo-x。 */
  function quoteDoc(stripAnnotation = false): Document {
    const doc = loadFixture(quoteMarcel);
    const article = articleById(doc, OUTER);
    const box = quoteBox(article);
    if (!box) throw new Error('样本里没有引用框');
    const inQuote = box.querySelector('video');
    const own = [...article.querySelectorAll('video')].find((v) => !box.contains(v));
    if (!inQuote || !own) throw new Error('样本里缺视频');
    inQuote.setAttribute('src', SRC_Q);
    own.setAttribute('src', SRC_O);
    if (stripAnnotation) article.removeAttribute('data-alayo-x');
    return doc;
  }

  it('点引用框里的视频：status id 与作者是引用帖的；外层帖自己的视频仍按外层帖', () => {
    const doc = quoteDoc();
    const q = captureXVideo(doc, OUTER, `https://x.com/marcelkargul/status/${OUTER}`, SRC_Q);
    if (isCaptureError(q)) throw new Error(q.error);
    expect(q.stream?.videoId).toBe(QUOTED);
    expect(q.url).toBe(`https://x.com/marcelkargul/status/${QUOTED}/video/1`);
    expect(q.author).toContain('(@marcelkargul)');
    const o = captureXVideo(doc, OUTER, `https://x.com/marcelkargul/status/${OUTER}`, SRC_O);
    if (isCaptureError(o)) throw new Error(o.error);
    expect(o.stream?.videoId).toBe(OUTER);
  });

  it('引用地址读不到（没有 data-alayo-x）：点引用框里的视频 → XVideoNeedsPost', () => {
    const res = captureXVideo(quoteDoc(true), OUTER, `https://x.com/marcelkargul/status/${OUTER}`, SRC_Q);
    expect(isCaptureError(res) && res.error.startsWith('XVideoNeedsPost')).toBe(true);
  });
});
