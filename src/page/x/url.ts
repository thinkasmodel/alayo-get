// X 状态页地址：识别 `/{handle}/status/{id}`，并生成规范的 x.com 帖子地址。

const X_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);

/** handle 不会是这些站内路径（`/i/…`、`/search` 等不是用户页）。 */
const RESERVED = new Set(['i', 'search', 'home', 'explore', 'notifications', 'messages', 'settings', 'hashtag', 'compose', 'intent', 'share']);

const HANDLE_RE = /^[A-Za-z0-9_]{1,50}$/;
const ID_RE = /^\d{1,25}$/;

/** X 帖子页地址 → handle 与帖子 id；不是帖子页返回 null。后面跟 `/photo/1`、`/video/1`、`/history`、查询串、锚点也认。 */
export function parseXStatusUrl(url: string): { handle: string; id: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!X_HOSTS.has(u.hostname.toLowerCase())) return null;
  const parts = u.pathname.split('/').filter((p) => p !== '');
  const [handle, status, id] = parts;
  if (handle === undefined || status === undefined || id === undefined) return null;
  if (status !== 'status' || !HANDLE_RE.test(handle) || RESERVED.has(handle.toLowerCase()) || !ID_RE.test(id)) return null;
  return { handle, id };
}

/** 规范的帖子地址：`https://x.com/{handle}/status/{id}`。 */
export function xStatusUrl(handle: string, id: string): string {
  return `https://x.com/${handle}/status/${id}`;
}
