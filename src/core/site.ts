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

export interface SameSiteOptions {
  /** 不比协议（只用于重定向检查：http 媒体地址跳到同站的 https 很常见，ADR-0009）。默认 false。 */
  ignoreScheme?: boolean;
}

/**
 * 两个地址是否同站：都是 http(s)、协议相同（端口不计；ignoreScheme 时不比协议）；hostname 相同即同站，
 * 否则两边的可注册域（eTLD+1，含私有后缀）都算得出且相等才同站。
 * IP、localhost 等算不出可注册域的主机，只有 hostname 完全相同才同站。
 * 尾点：URL 标准里 `example.com.` 与 `example.com` 是不同的站（tldts 会去掉尾点，不能直接交给它）；
 * 只有一边带尾点 → 不同站，两边都带 → 去掉后照常比。
 */
export function sameSite(a: string, b: string, options: SameSiteOptions = {}): boolean {
  const ua = httpUrl(a);
  const ub = httpUrl(b);
  if (!ua || !ub) return false;
  if (!options.ignoreScheme && ua.protocol !== ub.protocol) return false;
  if (ua.hostname === ub.hostname) return true;
  const dotA = ua.hostname.endsWith('.');
  const dotB = ub.hostname.endsWith('.');
  if (dotA !== dotB) return false;
  const ha = dotA ? ua.hostname.slice(0, -1) : ua.hostname;
  const hb = dotB ? ub.hostname.slice(0, -1) : ub.hostname;
  if (ha === '' || hb === '') return false;
  if (ha === hb) return true;
  const da = getDomain(ha, { allowPrivateDomains: true });
  const db = getDomain(hb, { allowPrivateDomains: true });
  return da !== null && db !== null && da === db;
}

/** 媒体请求的 credentials：媒体地址与被保存页面同站才带 cookie。 */
export function mediaCredentials(pageUrl: string, mediaUrl: string): RequestCredentials {
  return sameSite(pageUrl, mediaUrl) ? 'include' : 'omit';
}
