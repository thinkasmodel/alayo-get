// 右键保存链接时，service worker 抓到目标页 HTML 后用纯文本解析元数据（SW 里没有 DOM 解析器，ADR-0004）。

export interface HtmlMeta {
  title: string;
  description: string;
  /** 绝对地址；没有为空。 */
  image: string;
  siteName: string;
  published: string;
  author: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
};

/** 解码命名实体 &amp; &lt; &gt; &quot; &#39; 与数字实体（十进制、十六进制）。单遍解码，不会二次解码。 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 解析一个开始标签里的属性，键转小写。支持双引号、单引号和不加引号的值，属性顺序任意。 */
function parseAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const m of tag.matchAll(re)) {
    const key = (m[1] ?? '').toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (!attrs.has(key)) attrs.set(key, value);
  }
  return attrs;
}

function absolutize(url: string, base: string): string {
  if (url === '') return '';
  try {
    return new URL(url, base).href;
  } catch {
    return '';
  }
}

/** 从 HTML 文本解析标题、描述、封面、站点名、发布时间、作者。og 字段优先。 */
export function parseHtmlMeta(html: string, pageUrl: string): HtmlMeta {
  const metas = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(m[0]);
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    const content = attrs.get('content');
    if (key === '' || content === undefined) continue;
    // 同名取第一个
    if (!metas.has(key)) metas.set(key, collapse(decodeEntities(content)));
  }
  const get = (key: string) => metas.get(key) ?? '';

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const htmlTitle = titleMatch ? collapse(decodeEntities(titleMatch[1] ?? '')) : '';

  return {
    title: get('og:title') || htmlTitle,
    description: get('og:description') || get('description'),
    image: absolutize(get('og:image'), pageUrl),
    siteName: get('og:site_name'),
    published: get('article:published_time'),
    author: get('author'),
  };
}
