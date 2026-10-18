import { describe, expect, it, vi } from 'vitest';
import type { TranslateHandlers, TranslateResult } from '@/core/translate/types';
import type { SwToTranslateHost, TranslateHostToSw } from '@/shared/messages';
import type { PortLike } from './ports';
import { ACK_TIMEOUT_MS, CONNECT_ATTEMPTS, CONNECT_RETRY_MS, createTranslateClient, IDLE_CLOSE_MS, type TranslateClientDeps } from './translateClient';

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
  private messageListeners: Array<(message: In) => void> = [];
  private disconnectListeners: Array<() => void> = [];

  constructor(readonly name = 'translate') {}

  postMessage(message: Out): void {
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
  const closeDocument = vi.fn(async () => undefined);
  let nextId = 0;
  const connect = vi.fn(() => {
    const port: ClientPort = new FakePort();
    ports.push(port);
    return port;
  });
  const deps: TranslateClientDeps = {
    hasDocument,
    createDocument,
    closeDocument,
    connect,
    newId: () => `job-${++nextId}`,
    setTimer: clock.set,
    clearTimer: clock.clear,
    ...overrides,
  };
  return { deps, clock, ports, hasDocument, createDocument, closeDocument, connect };
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

  it('空闲 IDLE_CLOSE_MS 后 closeDocument 被调用一次，期间有新任务则不关', async () => {
    const { deps, clock, ports, closeDocument } = setup();
    const service = createTranslateClient(deps);
    const first = start(service);
    await flush();
    const port = ports[0];
    port?.receive({ type: 'hello-ack' });
    await flush();
    port?.receive({ type: 'result', jobId: first.id, result: { status: 'complete', source: 'en' } });
    await first.result;

    await clock.advance(IDLE_CLOSE_MS - 1);
    expect(closeDocument).not.toHaveBeenCalled();
    await clock.advance(1);
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });

  it('空闲计时期间来了新任务就取消计时', async () => {
    const { deps, clock, ports, closeDocument } = setup();
    const service = createTranslateClient(deps);
    const first = start(service);
    await flush();
    const port = ports[0];
    port?.receive({ type: 'hello-ack' });
    await flush();
    port?.receive({ type: 'result', jobId: first.id, result: { status: 'complete', source: 'en' } });
    await first.result;

    await clock.advance(IDLE_CLOSE_MS / 2);
    const second = start(service);
    await flush();
    expect(port?.sent.filter((message) => message.type === 'translate')).toHaveLength(2);
    port?.receive({ type: 'result', jobId: second.id, result: { status: 'complete', source: 'en' } });
    await second.result;

    await clock.advance(IDLE_CLOSE_MS / 2);
    expect(closeDocument).not.toHaveBeenCalled();
    await clock.advance(IDLE_CLOSE_MS);
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });

  it('空闲关闭进行中来了新任务：等关闭完成后再建文档并完成翻译', async () => {
    const { deps, clock, ports, createDocument, connect } = setup();
    let documentOpen = true;
    let resolveClosing!: () => void;
    const closing = new Promise<void>((resolve) => {
      resolveClosing = resolve;
    });
    deps.hasDocument = vi.fn(async () => documentOpen);
    deps.closeDocument = vi.fn(() => closing);

    const service = createTranslateClient(deps);
    const first = start(service);
    await flush();
    const firstPort = ports[0];
    firstPort?.receive({ type: 'hello-ack' });
    await flush();
    firstPort?.receive({ type: 'result', jobId: first.id, result: { status: 'complete', source: 'en' } });
    await first.result;

    await clock.advance(IDLE_CLOSE_MS);
    expect(deps.closeDocument).toHaveBeenCalledTimes(1);

    const second = start(service);
    await flush();
    // 关闭还没完成：不建文档，也不去连马上要关掉的旧文档。
    expect(createDocument).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);

    documentOpen = false;
    resolveClosing();
    await flush();
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);

    const secondPort = ports[1];
    secondPort?.receive({ type: 'hello-ack' });
    await flush();
    secondPort?.receive({ type: 'result', jobId: second.id, result: { status: 'complete', source: 'en' } });
    await expect(second.result).resolves.toEqual({ status: 'complete', source: 'en' });
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
