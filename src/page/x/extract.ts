// X 专门适配的总调度：只在 X 帖子页上调用（ADR-0003：只读当前页 DOM 和主世界标注的 data-alayo-x，不调接口）。
// 长文直接解析焦点 article；单帖和作者串交给采集器。产出 medium: x 的文章剪藏（kind 仍是 'page'）。
import type { Capture, XCaptureInfo } from '@/shared/types';
import { articleToMarkdown, READ_VIEW } from './article';
import { classifyCell, parsePost, readAlayoX } from './cells';
import { collectThread, type XPageDriver } from './collect';
import { plainText, postsToMarkdown } from './markdown';
import { parseXStatusUrl, xStatusUrl } from './url';

const SITE = 'x.com';
const TITLE_CODE_POINTS = 30;

/** 找不到焦点帖时：书签退化（markdown: null，不带 x 字段）。 */
function bookmark(doc: Document, url: string): Capture {
  return {
    url,
    title: doc.title.trim(),
    site: SITE,
    author: '',
    published: '',
    description: '',
    coverUrl: '',
    markdown: null,
    textLength: 0,
    kind: 'page',
  };
}

function capture(fields: { url: string; title: string; author: string; published: string; markdown: string; x: XCaptureInfo }): Capture {
  return {
    url: fields.url,
    title: fields.title,
    site: SITE,
    author: fields.author,
    published: fields.published,
    description: '',
    coverUrl: '',
    markdown: fields.markdown,
    // X 路径不套用 MIN_TEXT_LENGTH：短帖也存成文章剪藏
    textLength: plainText(fields.markdown).length,
    kind: 'page',
    x: fields.x,
  };
}

/** 当前 DOM 里的焦点 article。 */
function focalArticle(driver: XPageDriver, id: string): Element | null {
  for (const cell of driver.cells()) {
    const c = classifyCell(cell);
    if (c.kind === 'post' && c.id === id) return c.article;
  }
  return null;
}

/**
 * 焦点 article 带 read view 时按长文转换：form article、posts 1；嵌入帖被截断时 partial 记截断条数，否则为 null。
 * 不是长文返回 null。
 */
function longformCapture(article: Element): Capture | null {
  const readView = article.querySelector(READ_VIEW);
  if (!readView) return null;
  const post = parsePost(article);
  if (!post) return null;
  const { title, markdown, truncated } = articleToMarkdown(readView, readAlayoX(article)?.tco ?? {});
  const heading = title || post.id;
  return capture({
    url: xStatusUrl(post.handle, post.id),
    title: `@${post.handle} - ${heading}`,
    author: `${post.name} (@${post.handle})`,
    published: post.datetime,
    markdown,
    x: { form: 'article', posts: 1, partial: truncated > 0 ? { limit: false, timeout: false, truncated } : null, heading },
  });
}

/** 从 X 帖子页抽出剪藏。 */
export async function extractX(doc: Document, url: string, driver: XPageDriver): Promise<Capture> {
  const target = parseXStatusUrl(url);
  if (!target) return bookmark(doc, url);

  // 快速路径：当前 DOM 里的焦点 article 就带 read view（长文），不进采集器
  driver.annotate();
  const current = focalArticle(driver, target.id);
  const fast = current ? longformCapture(current) : null;
  if (fast) return fast;

  const result = await collectThread(driver, target.id);
  // 开始时焦点 cell 可能不在 DOM 里（被虚拟滚动回收）：按采集结束后焦点帖最新的元素再判断一次是不是长文
  const longform = result ? longformCapture(result.focalArticle) : null;
  if (longform) return longform;
  const head = result?.posts[0];
  if (!result || !head) return bookmark(doc, xStatusUrl(target.handle, target.id));

  const text = plainText(head.textMd);
  const lead = text === '' ? head.id : Array.from(text).slice(0, TITLE_CODE_POINTS).join('');
  return capture({
    url: xStatusUrl(head.handle, head.id),
    title: `@${head.handle} - ${lead}`,
    author: `${head.name} (@${head.handle})`,
    published: head.datetime,
    markdown: postsToMarkdown(result.posts),
    x: { form: result.form, posts: result.posts.length, partial: result.partial },
  });
}
