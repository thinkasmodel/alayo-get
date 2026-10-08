// 响应体的有上限读取（ALAG-17）：边读边计数，超过上限就取消读取，不把整个响应先读进内存。
// 媒体剪藏、正文图片、链接页与视频页的抓取共用；中止请求（AbortController）由调用方负责。

/** 链接页、视频页 HTML 的字节上限：超过它按抓取失败处理，不截断解析。 */
export const HTML_MAX_BYTES = 4 * 1024 * 1024;

type CappedBody = { kind: 'ok'; chunks: Uint8Array[]; bytes: number } | { kind: 'too-large'; received: number };

/**
 * 逐块读响应体并累计字节数；累计超过 maxBytes 时取消读取，返回 too-large（已读部分丢弃）。
 * onProgress 每读到一块（未超限）回调一次已读字节数。res.body 为 null 时退回 arrayBuffer() 再比大小。
 */
export async function readBodyCapped(
  res: Response,
  maxBytes: number,
  onProgress?: (received: number) => void,
): Promise<CappedBody> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return { kind: 'too-large', received: buf.byteLength };
    return { kind: 'ok', chunks: [buf], bytes: buf.byteLength };
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { kind: 'too-large', received };
    }
    chunks.push(value);
    onProgress?.(received);
  }
  return { kind: 'ok', chunks, bytes: received };
}

/** 有上限地读文本（UTF-8，与 Response.text() 相同）；超过 maxBytes 返回 null。 */
export async function readTextCapped(res: Response, maxBytes: number): Promise<string | null> {
  const body = await readBodyCapped(res, maxBytes);
  if (body.kind === 'too-large') return null;
  const all = new Uint8Array(body.bytes);
  let offset = 0;
  for (const chunk of body.chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}
