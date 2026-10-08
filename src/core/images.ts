// 正文图片：找出要下载的远程图片、按下载结果重写成本地相对路径、由 content-type 定扩展名。

/** 一篇最多下载的图片张数。 */
export const MAX_IMAGES = 100;

export interface PlannedImage {
  url: string;
  /** 从 1 开始，按正文中首次出现的顺序。 */
  index: number;
}

/** 正文里一处图片引用：url 是解码后的地址，[start, end) 是原文里地址那一段的位置。 */
export interface ImageRef {
  url: string;
  start: number;
  end: number;
}

// 围栏可以出现在引用块（`> ` 前缀）和列表（任意缩进）里；先剥掉这些容器前缀再判断。
// 宁可多认出围栏（少改写），也不改坏代码示例。
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** 去掉行首的引用块标记（可多层、可带空格）。 */
function stripContainers(line: string): string {
  return line.replace(/^(?:\s*>)+/, '');
}

/** Markdown 里反斜杠可转义的 ASCII 标点。 */
function unescapeMarkdown(raw: string): string {
  return raw.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/** 从 i（指向 `[`）找到配对的 `]`，处理转义和嵌套；找不到返回 -1。 */
function closingBracket(md: string, i: number, limit: number): number {
  let depth = 0;
  for (let j = i; j < limit; j++) {
    const c = md[j];
    if (c === '\\') {
      j++;
    } else if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** 解析 `(` 之后的链接地址，返回地址在原文里的范围；不是合法地址返回 null。 */
function parseDestination(md: string, open: number, limit: number): { start: number; end: number; raw: string } | null {
  let i = open + 1;
  while (i < limit && (md[i] === ' ' || md[i] === '\t')) i++;
  if (md[i] === '<') {
    const close = md.indexOf('>', i + 1);
    if (close === -1 || close > limit || md.slice(i + 1, close).includes('\n')) return null;
    return { start: i + 1, end: close, raw: md.slice(i + 1, close) };
  }
  const start = i;
  let depth = 0;
  for (; i < limit; i++) {
    const c = md[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n') break;
    if (c === '(') depth++;
    if (c === ')') {
      if (depth === 0) break;
      depth--;
    }
  }
  if (i === start) return null;
  return { start, end: i, raw: md.slice(start, i) };
}

/**
 * 按 Markdown 结构找出正文里的图片引用：跳过围栏代码块和行内代码；
 * 地址里的转义字符（如 Turndown 输出的 `\(`）和成对括号都按地址的一部分处理。
 */
export function findImages(markdown: string): ImageRef[] {
  const refs: ImageRef[] = [];
  const lines = markdown.split('\n');
  let offset = 0;
  let fence: { char: string; length: number } | null = null;
  // 跨行的图片引用（alt 里有换行）识别后，跳过它已经覆盖的位置。
  let skipUntil = 0;

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;

    const content = stripContainers(line);
    const fenceMatch = FENCE_RE.exec(content);
    if (fence) {
      if (fenceMatch?.[1] && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length && content.trim() === fenceMatch[1]) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch?.[1]) {
      fence = { char: fenceMatch[1][0] ?? '`', length: fenceMatch[1].length };
      continue;
    }

    for (let i = Math.max(lineStart, skipUntil); i < lineEnd; i++) {
      const c = markdown[i];
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '`') {
        let run = 1;
        while (markdown[i + run] === '`') run++;
        const ticks = '`'.repeat(run);
        const close = markdown.indexOf(ticks, i + run);
        if (close !== -1 && close < lineEnd) {
          i = close + run - 1;
          continue;
        }
        i += run - 1;
        continue;
      }
      if (c === '!' && markdown[i + 1] === '[') {
        // alt 可以跨行（Turndown 会保留 alt 里的换行），但不跨空行（段落边界）。
        const blank = markdown.indexOf('\n\n', i);
        const altLimit = blank === -1 ? markdown.length : blank;
        const altEnd = closingBracket(markdown, i + 1, altLimit);
        if (altEnd === -1 || markdown[altEnd + 1] !== '(') continue;
        const destLineEnd = markdown.indexOf('\n', altEnd + 1);
        const dest = parseDestination(markdown, altEnd + 1, destLineEnd === -1 ? markdown.length : destLineEnd);
        if (!dest) continue;
        refs.push({ url: unescapeMarkdown(dest.raw), start: dest.start, end: dest.end });
        if (dest.end > lineEnd) {
          skipUntil = dest.end;
          break;
        }
        i = dest.end - 1;
      }
    }
  }
  return refs;
}

/** 去重、按首次出现编号，最多 MAX_IMAGES 张；data: 等非 http(s) 地址不在其中。 */
export function planImages(markdown: string, max = MAX_IMAGES): PlannedImage[] {
  const seen = new Set<string>();
  const plan: PlannedImage[] = [];
  for (const ref of findImages(markdown)) {
    if (!/^https?:\/\//i.test(ref.url)) continue;
    if (seen.has(ref.url)) continue;
    seen.add(ref.url);
    if (plan.length >= max) break;
    plan.push({ url: ref.url, index: plan.length + 1 });
  }
  return plan;
}

/** 附件相对路径：`.assets/<id>/<name>.<ext>`。 */
export function assetPath(id: string, name: string | number, ext: string): string {
  return `.assets/${id}/${name}.${ext}`;
}

/** 把下载成功的图片地址换成本地相对路径；不在 map 里的（失败、data:）保持原样；代码块里的不动。 */
export function rewriteImages(markdown: string, local: ReadonlyMap<string, string>): string {
  let out = markdown;
  const refs = findImages(markdown);
  for (let k = refs.length - 1; k >= 0; k--) {
    const ref = refs[k];
    if (!ref) continue;
    const path = local.get(ref.url);
    if (path === undefined) continue;
    out = out.slice(0, ref.start) + path + out.slice(ref.end);
  }
  return out;
}

const TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

/** 明确不是图片的 content-type：text/*、xhtml、json。 */
const NOT_IMAGE = /^(text\/|application\/(xhtml\+xml|json)$)/;

/**
 * 按 URL 后缀回退时接受的图片扩展名（ALAG-17）：不含 svg——SVG 是主动内容，只有服务器明确声明 image/svg+xml 才认。
 * jpeg 先归一为 jpg 再查。
 */
const IMAGE_URL_EXTS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp']);

/** 图片 mime（已去参数、小写）对应的扩展名；不认识返回 null。只做映射，不看 URL。 */
export function extFromImageMime(mime: string): string | null {
  return TYPE_EXT[mime] ?? null;
}

/**
 * 扩展名三级回退：content-type 映射 → URL 路径里的扩展名（只认图片白名单 IMAGE_URL_EXTS）→ null（判为下载失败）。
 * content-type 明确不是图片（网页、文本、JSON）时直接返回 null。
 */
export function extFromContentType(contentType: string | null, url: string): string | null {
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const mapped = extFromImageMime(mime);
  if (mapped) return mapped;
  // 服务器明确说是网页、文本或 JSON 时不是图片，不按 URL 后缀回退（ALAG-8：维基百科 /wiki/File:X.png 说明页被存成了 .png）
  if (NOT_IMAGE.test(mime)) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const m = /\.([a-z0-9]{1,5})$/i.exec(pathname);
  if (!m?.[1]) return null;
  const ext = m[1].toLowerCase();
  // 服务器没说清类型时，URL 后缀只决定白名单内的图片扩展名（ALAG-17：/x.bat、/x.svg 不认）
  if (!IMAGE_URL_EXTS.has(ext)) return null;
  return ext === 'jpeg' ? 'jpg' : ext;
}
