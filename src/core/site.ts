// 同站判定（ALAG-18，ADR-0009）：媒体请求只对与被保存页面同站的地址带 cookie。
// 同站按 schemeful site：协议相同，且按 Public Suffix List 算出的 eTLD+1 相同（私有后缀如 github.io 也算后缀）。
// 与 frontmatter.ts 的 siteFromUrl（只去 www.，用于显示）不是一回事，不要混用。
import { getDomain } from 'tldts';

function httpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}

/**
 * 两个地址是否同站：都是 http(s)、协议相同（端口不计）；hostname 相同即同站，
 * 否则两边的可注册域（eTLD+1，含私有后缀）都算得出且相等才同站。
 * IP、localhost 等算不出可注册域的主机，只有 hostname 完全相同才同站。
 */
export function sameSite(a: string, b: string): boolean {
  const ua = httpUrl(a);
  const ub = httpUrl(b);
  if (!ua || !ub) return false;
  if (ua.protocol !== ub.protocol) return false;
  if (ua.hostname === ub.hostname) return true;
  const da = getDomain(ua.hostname, { allowPrivateDomains: true });
  const db = getDomain(ub.hostname, { allowPrivateDomains: true });
  return da !== null && db !== null && da === db;
}

/** 媒体请求的 credentials：媒体地址与被保存页面同站才带 cookie。 */
export function mediaCredentials(pageUrl: string, mediaUrl: string): RequestCredentials {
  return sameSite(pageUrl, mediaUrl) ? 'include' : 'omit';
}
