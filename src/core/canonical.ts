// 出处规范化：同一篇内容的不同分享链接归一成一个出处，用于已保存记录去重。

const DROP_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref_src',
  'spm',
  'si',
]);

const WEIXIN_KEEP = new Set(['__biz', 'mid', 'idx', 'sn']);

function paramKey(segment: string): string {
  const raw = segment.split('=', 1)[0] ?? '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/**
 * 协议、主机名小写；去默认端口和 #fragment；去跟踪参数（其余参数保持原顺序与原编码）；
 * 微信文章只留 __biz、mid、idx、sn；查询串空了连 `?` 一起去掉。
 * 解析不了的 URL 原样返回（去首尾空白）。
 */
export function canonicalizeUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  // URL 解析已经把协议、主机名转小写并去掉了默认端口。
  url.hash = '';

  const isWeixin = url.hostname === 'mp.weixin.qq.com' && (url.pathname === '/s' || url.pathname === '/s/');
  const query = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  const kept = query
    .split('&')
    .filter((segment) => segment !== '')
    .filter((segment) => {
      const key = paramKey(segment);
      if (isWeixin) return WEIXIN_KEEP.has(key);
      const lower = key.toLowerCase();
      return !lower.startsWith('utm_') && !DROP_PARAMS.has(lower);
    });
  url.search = kept.length ? `?${kept.join('&')}` : '';
  return url.href;
}
