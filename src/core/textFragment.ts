// 文本片段链接（WICG Scroll-to-Text-Fragment，`#:~:text=`）的编码与拼接（ALAG-4 摘录剪藏）。纯函数，node 环境测试。
// 片段本身在页面里由 text-fragments-polyfill 生成（src/page/quote.ts），这里不引用那个库，service worker 产物里也不会有它。

/** 生成器给出的片段：textStart 必有，其余可无。 */
export interface TextFragmentParts {
  textStart: string;
  textEnd?: string;
  prefix?: string;
  suffix?: string;
}

/** 片段里的一段：encodeURIComponent 后把 `-` 也编码成 `%2D`（`,`、`&` 已被 encodeURIComponent 编码）。 */
export function encodeFragmentPart(s: string): string {
  return encodeURIComponent(s).replace(/-/g, '%2D');
}

/**
 * 拼出带 `#:~:text=` 的完整链接：`[prefix-,]textStart[,textEnd][,-suffix]`。
 * 去掉原地址里已有的 `:~:` 指令；原地址有 `#hash` 时接成 `#hash:~:text=…`，没有时接 `#:~:text=…`。
 */
export function fragmentUrl(pageUrl: string, fragment: TextFragmentParts): string {
  const hashAt = pageUrl.indexOf('#');
  const base = hashAt === -1 ? pageUrl : pageUrl.slice(0, hashAt);
  let hash = hashAt === -1 ? '' : pageUrl.slice(hashAt + 1);
  const directiveAt = hash.indexOf(':~:');
  if (directiveAt !== -1) hash = hash.slice(0, directiveAt);

  let text = '';
  if (fragment.prefix) text += `${encodeFragmentPart(fragment.prefix)}-,`;
  text += encodeFragmentPart(fragment.textStart);
  if (fragment.textEnd) text += `,${encodeFragmentPart(fragment.textEnd)}`;
  if (fragment.suffix) text += `,-${encodeFragmentPart(fragment.suffix)}`;
  return `${base}#${hash}:~:text=${text}`;
}
