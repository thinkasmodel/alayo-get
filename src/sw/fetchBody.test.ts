import { describe, expect, it } from 'vitest';
import { HTML_MAX_BYTES, readBodyCapped, readTextCapped } from './fetchBody';

const MB = 1024 * 1024;

/** 重复同一块数据 count 次的流；highWaterMark 0：只在读的时候才拉，pulled 即已读块数。 */
function repeatedStream(chunk: Uint8Array, count: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (state.pulled >= count) {
          controller.close();
          return;
        }
        state.pulled++;
        controller.enqueue(chunk);
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

describe('readBodyCapped', () => {
  it('没有 content-length 的 24MB 流、20MB 上限：返回 too-large，取消源流，最多读 21 块', async () => {
    const { stream, state } = repeatedStream(new Uint8Array(MB), 24);
    const res = new Response(stream);
    expect(res.headers.get('content-length')).toBeNull();
    const got = await readBodyCapped(res, 20 * MB);
    expect(got).toEqual({ kind: 'too-large', received: 21 * MB });
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThanOrEqual(21);
  });

  it('不超限：返回全部块与字节数，每块回调一次进度', async () => {
    const { stream, state } = repeatedStream(new Uint8Array(MB), 3);
    const seen: number[] = [];
    const got = await readBodyCapped(new Response(stream), 3 * MB, (n) => seen.push(n));
    expect(got.kind).toBe('ok');
    if (got.kind !== 'ok') return;
    expect(got.bytes).toBe(3 * MB);
    expect(got.chunks).toHaveLength(3);
    expect(seen).toEqual([MB, 2 * MB, 3 * MB]);
    expect(state.cancelled).toBe(false);
  });

  it('没有响应体：按空内容返回 ok', async () => {
    const got = await readBodyCapped(new Response(null), 10);
    expect(got).toEqual({ kind: 'ok', chunks: [new Uint8Array(0)], bytes: 0 });
  });
});

describe('readTextCapped', () => {
  it('不超限：返回 UTF-8 解码后的字符串（跨块的多字节字符也完整）', async () => {
    const bytes = new TextEncoder().encode('<title>中文标题</title>');
    // 从“中”字的中间切开
    const cut = 8;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    expect(await readTextCapped(new Response(stream), HTML_MAX_BYTES)).toBe('<title>中文标题</title>');
  });

  it('超过上限返回 null', async () => {
    expect(await readTextCapped(new Response('x'.repeat(HTML_MAX_BYTES + 1)), HTML_MAX_BYTES)).toBeNull();
    expect(await readTextCapped(new Response('x'.repeat(HTML_MAX_BYTES)), HTML_MAX_BYTES)).toHaveLength(HTML_MAX_BYTES);
  });
});
