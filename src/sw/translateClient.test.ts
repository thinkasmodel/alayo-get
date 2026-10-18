import { describe, expect, it, vi } from 'vitest';
import type { TranslateHandlers, TranslateResult } from '@/core/translate/types';
import type { SwToTranslateHost, TranslateHostToSw } from '@/shared/messages';
import type { PortLike } from './ports';
import { ACK_TIMEOUT_MS, CONNECT_ATTEMPTS, CONNECT_RETRY_MS, createTranslateClient, type TranslateClientDeps } from './translateClient';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class FakeClock {
  now = 0;
  private nextId = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();

  set = (fn: () => void, ms: number): unknown => {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };

  clear = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  async advance(ms: number): Promise<void> {
    this.now += ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= this.now).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) return;
      this.timers.delete(due[0]);
      due[1].fn();
      // 让计时器回调触发的 Promise 链跑完，再看有没有新的到期计时器。
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}

class FakePort<In, Out> implements PortLike<In, Out> {
  readonly sent: Out[] = [];
  disconnectCalls = 0;
  disconnectOnHello = false;
  throwOnTranslate = false;
  private messageListeners: Array<(message: In) => void> = [];
  private disconnectListeners: Array<() => void> = [];

  constructor(readonly name = 'translate') {}

  postMessage(message: Out): void {
    if (this.throwOnTranslate && (message as { type?: string }).type === 'translate') {
      throw new Error('translate post failed');
    }
    this.sent.push(message);
    if (this.disconnectOnHello && (message as { type?: string }).type === 'hello') {
      queueMicrotask(() => this.remoteDisconnect());
    }
  }

  onMessage = { addListener: (fn: (message: In) => void) => void this.messageListeners.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => void this.disconnectListeners.push(fn) };

  receive(message: In): void {
    for (const fn of this.messageListeners) fn(message);
  }

  remoteDisconnect(): void {
    for (const fn of this.disconnectListeners) fn();
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.remoteDisconnect();
  }
}

type ClientPort = FakePort<TranslateHostToSw, SwToTranslateHost>;

function setup(overrides: Partial<TranslateClientDeps> = {}) {
  const clock = new FakeClock();
  const ports: ClientPort[] = [];
  const hasDocument = vi.fn(async () => true);
  const createDocument = vi.fn(async () => undefined);
  let nextId = 0;
  const connect = vi.fn(() => {
    const port: ClientPort = new FakePort();
    ports.push(port);
    return port;
  });
  const deps: TranslateClientDeps = {
    hasDocument,
    createDocument,
    connect,
    newId: () => `job-${++nextId}`,
    setTimer: clock.set,
    clearTimer: clock.clear,
    ...overrides,
  };
  return { deps, clock, ports, hasDocument, createDocument, connect };
}

const request = { segments: ['Hello'], target: 'zh', source: 'en' };

function start(service: ReturnType<typeof createTranslateClient>, handlers?: TranslateHandlers) {
  return service.translate(request, handlers);
}

describe('createTranslateClient', () => {
  it('已有文档时不 createDocument；source/segment/result 转给 handlers', async () => {
    const { deps, ports, createDocument } = setup();
    const service = createTranslateClient(deps);
    const sources: string[] = [];
    const segments: Array<{ index: number; text: string }> = [];
    const job = start(service, {
      onSource: (source) => sources.push(source),
      onSegment: (index, text) => segments.push({ index, text }),
    });
    await flush();
    expect(createDocument).not.toHaveBeenCalled();
    const port = ports[0];
    expect(port?.sent).toEqual([{ type: 'hello' }]);

    port?.receive({ type: 'hello-ack' });
    await flush();
    expect(port?.sent[1]).toEqual({ type: 'translate', jobId: job.id, request });

    port?.receive({ type: 'source', jobId: job.id, source: 'en' });
    port?.receive({ type: 'segment', jobId: job.id, index: 0, text: '你好' });
    port?.receive({ type: 'result', jobId: job.id, result: { status: 'complete', source: 'en' } });
    await expect(job.result).resolves.toEqual({ status: 'complete', source: 'en' });
    expect(sources).toEqual(['en']);
    expect(segments).toEqual([{ index: 0, text: '你好' }]);
  });

  it('没有文档时两个并发任务只 create 一次、只 connect 一次', async () => {
    const { deps, ports, createDocument, connect } = setup();
    deps.hasDocument = vi.fn(async () => false);
    const service = createTranslateClient(deps);
    const first = start(service);
    const second = start(service);
    await flush();

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    const port = ports[0];
    expect(port?.sent).toEqual([{ type: 'hello' }]);

    port?.receive({ type: 'hello-ack' });
    await flush();
    const sent = port?.sent.filter((message) => message.type === 'translate') ?? [];
    expect(sent).toHaveLength(2);
    port?.receive({ type: 'result', jobId: first.id, result: { status: 'complete', source: 'en' } });
    port?.receive({ type: 'result', jobId: second.id, result: { status: 'complete', source: 'en' } });
    await expect(Promise.all([first.result, second.result])).resolves.toEqual([
      { status: 'complete', source: 'en' },
      { status: 'complete', source: 'en' },
    ]);
  });

  it('ack 前断开会重连，第 3 次连上后任务正常完成', async () => {
    const { deps, ports, connect, clock } = setup();
    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    expect(connect).toHaveBeenCalledTimes(1);

    ports[0]?.remoteDisconnect();
    await flush();
    await clock.advance(CONNECT_RETRY_MS);
    expect(connect).toHaveBeenCalledTimes(2);

    ports[1]?.remoteDisconnect();
    await flush();
    await clock.advance(CONNECT_RETRY_MS);
    expect(connect).toHaveBeenCalledTimes(3);

    ports[2]?.receive({ type: 'hello-ack' });
    await flush();
    expect(ports[2]?.sent.some((message) => message.type === 'translate')).toBe(true);
    ports[2]?.receive({ type: 'source', jobId: job.id, source: 'en' });
    ports[2]?.receive({ type: 'result', jobId: job.id, result: { status: 'complete', source: 'en' } });
    await expect(job.result).resolves.toEqual({ status: 'complete', source: 'en' });
  });

  it('连上但不回 ack → ACK_TIMEOUT_MS 后 disconnect 并算一次失败', async () => {
    const { deps, ports, connect, clock } = setup();
    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    const port = ports[0];

    await clock.advance(ACK_TIMEOUT_MS - 1);
    expect(port?.disconnectCalls).toBe(0);
    await clock.advance(1);
    expect(port?.disconnectCalls).toBe(1);

    await clock.advance(CONNECT_RETRY_MS);
    expect(connect).toHaveBeenCalledTimes(2);
    ports[1]?.receive({ type: 'hello-ack' });
    await flush();
    ports[1]?.receive({ type: 'result', jobId: job.id, result: { status: 'complete', source: 'en' } });
    await expect(job.result).resolves.toEqual({ status: 'complete', source: 'en' });
  });

  it('ack 前文档关闭：下一次尝试前重新确认并创建文档，之后不再重复创建', async () => {
    const { deps, ports, createDocument, connect, clock } = setup();
    let hasDocumentCalls = 0;
    const hasDocument = vi.fn(async () => {
      hasDocumentCalls += 1;
      return hasDocumentCalls === 1;
    });
    deps.hasDocument = hasDocument;

    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    expect(hasDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).not.toHaveBeenCalled();

    ports[0]?.remoteDisconnect();
    await flush();
    await clock.advance(CONNECT_RETRY_MS);
    expect(hasDocument).toHaveBeenCalledTimes(2);
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);

    ports[1]?.receive({ type: 'hello-ack' });
    await flush();
    ports[1]?.receive({ type: 'result', jobId: job.id, result: { status: 'complete', source: 'en' } });
    await expect(job.result).resolves.toEqual({ status: 'complete', source: 'en' });

    const next = start(service);
    await flush();
    expect(hasDocument).toHaveBeenCalledTimes(2);
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(ports[1]?.sent.filter((message) => message.type === 'translate')).toHaveLength(2);
    ports[1]?.receive({ type: 'result', jobId: next.id, result: { status: 'complete', source: 'en' } });
    await expect(next.result).resolves.toEqual({ status: 'complete', source: 'en' });
  });

  it('CONNECT_ATTEMPTS 次都失败 → host-lost（done: 0）', async () => {
    const { deps, ports, clock } = setup();
    deps.connect = vi.fn(() => {
      const port: ClientPort = new FakePort();
      port.disconnectOnHello = true;
      ports.push(port);
      return port;
    });
    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    for (let attempt = 1; attempt < CONNECT_ATTEMPTS; attempt += 1) await clock.advance(CONNECT_RETRY_MS);
    expect(deps.connect).toHaveBeenCalledTimes(CONNECT_ATTEMPTS);
    await expect(job.result).resolves.toEqual({ status: 'failed', error: { code: 'host-lost' }, done: 0 });
  });

  it('连上后断开 → 未结束任务 host-lost 且 done 为已收段数，下一个任务重新连接', async () => {
    const { deps, ports, connect, createDocument } = setup();
    deps.hasDocument = vi.fn(async () => false);
    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    const firstPort = ports[0];
    firstPort?.receive({ type: 'hello-ack' });
    await flush();
    firstPort?.receive({ type: 'source', jobId: job.id, source: 'en' });
    firstPort?.receive({ type: 'segment', jobId: job.id, index: 0, text: '你' });
    firstPort?.receive({ type: 'segment', jobId: job.id, index: 1, text: '好' });
    firstPort?.remoteDisconnect();
    await expect(job.result).resolves.toEqual({ status: 'failed', error: { code: 'host-lost' }, done: 2 });

    const next = start(service);
    await flush();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(createDocument).toHaveBeenCalledTimes(2);
    const secondPort = ports[1];
    secondPort?.receive({ type: 'hello-ack' });
    await flush();
    secondPort?.receive({ type: 'result', jobId: next.id, result: { status: 'complete', source: 'en' } });
    await expect(next.result).resolves.toEqual({ status: 'complete', source: 'en' });
  });

  it('取消还没发出去的任务：立即 cancelled 且不发消息', async () => {
    const { deps, ports } = setup();
    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    service.cancel(job.id);
    await expect(job.result).resolves.toEqual({ status: 'cancelled', done: 0 });

    const port = ports[0];
    port?.receive({ type: 'hello-ack' });
    await flush();
    expect(port?.sent).toEqual([{ type: 'hello' }]);
  });

  it('发出后未收到任何消息即断开：新连接上重发一次并正常完成', async () => {
    const { deps, ports, connect } = setup();
    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    const first = ports[0];
    first?.receive({ type: 'hello-ack' });
    await flush();
    expect(first?.sent.some((message) => message.type === 'translate')).toBe(true);

    first?.remoteDisconnect();
    await flush();
    expect(connect).toHaveBeenCalledTimes(2);
    const second = ports[1];
    expect(second?.sent).toEqual([{ type: 'hello' }]);

    second?.receive({ type: 'hello-ack' });
    await flush();
    expect(second?.sent.filter((message) => message.type === 'translate')).toEqual([{ type: 'translate', jobId: job.id, request }]);
    second?.receive({ type: 'result', jobId: job.id, result: { status: 'complete', source: 'en' } });
    await expect(job.result).resolves.toEqual({ status: 'complete', source: 'en' });
  });

  it('重发后再次断开：host-lost，不再重发', async () => {
    const { deps, ports, connect } = setup();
    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    ports[0]?.receive({ type: 'hello-ack' });
    await flush();

    ports[0]?.remoteDisconnect();
    await flush();
    ports[1]?.receive({ type: 'hello-ack' });
    await flush();
    expect(ports[1]?.sent.some((message) => message.type === 'translate')).toBe(true);

    ports[1]?.remoteDisconnect();
    await expect(job.result).resolves.toEqual({ status: 'failed', error: { code: 'host-lost' }, done: 0 });
    await flush();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('握手后发送第一个任务抛错：未发出的第二个任务保留，重连后两个各发一次并完成', async () => {
    const { deps, ports, connect, clock } = setup();
    const service = createTranslateClient(deps);
    const first = start(service);
    const second = start(service);
    await flush();

    const firstPort = ports[0];
    if (firstPort) firstPort.throwOnTranslate = true;
    firstPort?.receive({ type: 'hello-ack' });
    await flush();
    expect(firstPort?.sent.filter((message) => message.type === 'translate')).toEqual([]);

    await clock.advance(CONNECT_RETRY_MS);
    expect(connect).toHaveBeenCalledTimes(2);
    const secondPort = ports[1];
    secondPort?.receive({ type: 'hello-ack' });
    await flush();

    const sent = secondPort?.sent.filter((message) => message.type === 'translate') ?? [];
    expect(sent).toHaveLength(2);
    expect(sent.map((message) => (message.type === 'translate' ? message.jobId : '')).sort()).toEqual([first.id, second.id].sort());
    secondPort?.receive({ type: 'result', jobId: first.id, result: { status: 'complete', source: 'en' } });
    secondPort?.receive({ type: 'result', jobId: second.id, result: { status: 'complete', source: 'en' } });
    await expect(Promise.all([first.result, second.result])).resolves.toEqual([
      { status: 'complete', source: 'en' },
      { status: 'complete', source: 'en' },
    ]);
  });

  it('两次连接都在发送时抛错：已重发的第一个 host-lost，未发出的第二个保留到下一次连接', async () => {
    const { deps, ports, connect, clock } = setup();
    const service = createTranslateClient(deps);
    const first = start(service);
    const second = start(service);
    await flush();

    const firstPort = ports[0];
    if (firstPort) firstPort.throwOnTranslate = true;
    firstPort?.receive({ type: 'hello-ack' });
    await flush();
    await clock.advance(CONNECT_RETRY_MS);
    expect(connect).toHaveBeenCalledTimes(2);

    const secondPort = ports[1];
    if (secondPort) secondPort.throwOnTranslate = true;
    secondPort?.receive({ type: 'hello-ack' });
    await flush();

    // 第一个任务已用掉唯一一次重发额度，第二次发送又失败 → host-lost。
    await expect(first.result).resolves.toEqual({ status: 'failed', error: { code: 'host-lost' }, done: 0 });
    // 第二个任务从未发出过，不能被判 host-lost；第三次连接应该还能把它发出去。
    // 若第三次连接的发送也失败，它这时才第一次 sent=true、没有收到消息、没有重发过，按规则获得一次重发额度，
    // 仍不会立即 host-lost；这里让第三次连接成功，验证它能完成。
    let secondSettled = false;
    void second.result.then(() => {
      secondSettled = true;
    });
    await flush();
    expect(secondSettled).toBe(false);

    await clock.advance(CONNECT_RETRY_MS);
    expect(connect).toHaveBeenCalledTimes(3);
    const thirdPort = ports[2];
    thirdPort?.receive({ type: 'hello-ack' });
    await flush();
    expect(thirdPort?.sent.filter((message) => message.type === 'translate')).toEqual([{ type: 'translate', jobId: second.id, request }]);
    thirdPort?.receive({ type: 'result', jobId: second.id, result: { status: 'complete', source: 'en' } });
    await expect(second.result).resolves.toEqual({ status: 'complete', source: 'en' });
  });

  it('收到过 segment 后断开：不重发，host-lost 且 done 为已收段数', async () => {
    const { deps, ports, connect } = setup();
    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    const port = ports[0];
    port?.receive({ type: 'hello-ack' });
    await flush();
    port?.receive({ type: 'segment', jobId: job.id, index: 0, text: '你' });

    port?.remoteDisconnect();
    await expect(job.result).resolves.toEqual({ status: 'failed', error: { code: 'host-lost' }, done: 1 });
    await flush();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('收到 keepalive 不算任务消息：断线时仍重发并正常完成', async () => {
    const { deps, ports, connect } = setup();
    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    const first = ports[0];
    first?.receive({ type: 'hello-ack' });
    await flush();
    expect(first?.sent.some((message) => message.type === 'translate')).toBe(true);

    first?.receive({ type: 'keepalive' });
    first?.remoteDisconnect();
    await flush();
    expect(connect).toHaveBeenCalledTimes(2);

    const second = ports[1];
    second?.receive({ type: 'hello-ack' });
    await flush();
    expect(second?.sent.filter((message) => message.type === 'translate')).toEqual([{ type: 'translate', jobId: job.id, request }]);
    second?.receive({ type: 'result', jobId: job.id, result: { status: 'complete', source: 'en' } });
    await expect(job.result).resolves.toEqual({ status: 'complete', source: 'en' });
  });

  it('result 原样 resolve，done 以 host 给的为准', async () => {
    const { deps, ports } = setup();
    const service = createTranslateClient(deps);
    const job = start(service);
    await flush();
    const port = ports[0];
    port?.receive({ type: 'hello-ack' });
    await flush();
    const result: TranslateResult = { status: 'cancelled', source: 'en', done: 3 };
    port?.receive({ type: 'result', jobId: job.id, result });
    await expect(job.result).resolves.toBe(result);
  });
});
