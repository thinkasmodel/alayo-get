// 页面内抽取：Defuddle 抽正文，Turndown 转 Markdown（只在页面里运行，ADR-0004）。
import Defuddle from 'defuddle';
import TurndownService from 'turndown';
import type { DefuddleResponse } from 'defuddle';
import type { Capture } from '@/shared/types';

/** 正文短于此长度时退化为书签剪藏。 */
export const MIN_TEXT_LENGTH = 200;

function absolute(url: string | null | undefined, base: string): string {
  const value = (url ?? '').trim();
  if (value === '') return '';
  try {
    return new URL(value, base).href;
  } catch {
    return '';
  }
}

function metaContent(doc: Document, selector: string): string {
  return doc.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? '';
}

/**
 * 去掉 img 上的 RDFa `resource`、`about` 属性（ALAG-8）。它们指“所描述的资源”，不是图片来源；
 * Defuddle 的懒加载图片规则会把 img 上任何像图片地址的属性值换进 src，
 * 维基百科的 `<img resource="…/wiki/File:X.png">` 因此被存成了图片说明页。
 */
export function stripImageRdfa(root: ParentNode): void {
  for (const img of root.querySelectorAll('img[resource], img[about]')) {
    img.removeAttribute('resource');
    img.removeAttribute('about');
  }
}

function parseWithDefuddle(doc: Document, url: string): DefuddleResponse | null {
  try {
    const clone = doc.cloneNode(true) as Document;
    stripImageRdfa(clone);
    return new Defuddle(clone, { url, useAsync: false }).parse();
  } catch (err) {
    console.warn('[Alayo Get] Defuddle 抽取失败，退化为书签剪藏', err);
    return null;
  }
}

/** 把正文 HTML 里 img[src]、a[href] 按页面 baseURI 转成绝对地址。 */
function absolutizeContent(container: HTMLElement, base: string): void {
  for (const img of container.querySelectorAll<HTMLImageElement>('img[src]')) {
    const abs = absolute(img.getAttribute('src'), base);
    if (abs) img.setAttribute('src', abs);
  }
  for (const a of container.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const abs = absolute(a.getAttribute('href'), base);
    if (abs) a.setAttribute('href', abs);
  }
}

export function extractFromDocument(doc: Document, url: string): Capture {
  const base = doc.baseURI || url;
  const result = parseWithDefuddle(doc, url);

  let markdown: string | null = null;
  let textLength = 0;
  if (result && result.content.trim() !== '') {
    const holder = doc.implementation.createHTMLDocument('');
    const container = holder.createElement('div');
    container.innerHTML = result.content;
    absolutizeContent(container, base);
    textLength = (container.textContent ?? '').replace(/\s+/g, ' ').trim().length;
    if (textLength >= MIN_TEXT_LENGTH) {
      const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
      markdown = turndown.turndown(container);
    }
  }

  const title = result?.title?.trim() || doc.title.trim();
  const description = result?.description?.trim() || metaContent(doc, 'meta[name="description" i]');
  const coverUrl = absolute(result?.image || metaContent(doc, 'meta[property="og:image" i]'), base);

  return {
    url,
    title,
    site: result?.site?.trim() || metaContent(doc, 'meta[property="og:site_name" i]'),
    author: result?.author?.trim() ?? '',
    published: result?.published?.trim() ?? '',
    description,
    coverUrl,
    markdown,
    textLength,
    kind: 'page',
  };
}
