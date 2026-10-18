import { describe, expect, it, vi } from 'vitest';
import type { SwToTranslateHost, TranslateHostToSw } from '@/shared/messages';
import type { TranslateHandlers, TranslateRequest, TranslateResult, TranslationService } from '@/core/translate/types';
import type { PortLike } from '@/sw/ports';
import { createIdleCloser, handleTranslateHostPort, IDLE_CLOSE_MS, type HostActivity } from './host';

class FakePort<In, Out> implements PortLike<In, Out> {
  readonly sent: Out[] = [];
  throwOnPost = false;
  private messageListeners: Array<(message: In) => void> = [];
  private disconnectListeners: Array<() => void> = [];

  constructor(readonly name: string) {}

  postMessage(message: Out): void {
    if (this.throwOnPost) throw new Error('port disconnected');
    this.sent.push(message);
  }

  onMessage = { addListener: (fn: (message: In) => void) => void this.messageListeners.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => void this.disconnectListeners.push(fn) };

  send(message: In): void {
    for (const fn of this.messageListeners) fn(message);
  }

  disconnect(): void {
    for (const fn of this.disconnectListeners) fn();
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeTimers() {
  let nextId = 0;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = ++nextId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (handle: unknown): void => {
      timers.delete(handle as number);
    },
    fire(): void {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.fn();
      }
    },
    pending(): number[] {
      return [...timers.values()].map((timer) => timer.ms);
    },
  };
}

class FakeService implements TranslationService {
  readonly calls: Array<{ request: TranslateRequest; handlers?: TranslateHandlers }> = [];
  readonly cancel = vi.fn();
  private pending = new Map<string, (result: TranslateResult) => void>();
  private count = 0;

  translate(request: TranslateRequest, handlers?: TranslateHandlers) {
    const id = `task-${++this.count}`;
    this.calls.push({ request, handlers });
    const result = new Promise<TranslateResult>((resolve) => {
      this.pending.set(id, resolve);
    });
    return { id, result };
  }

  resolve(id: string, result: TranslateResult): void {
    this.pending.get(id)?.(result);
    this.pending.delete(id);
  }
}

type HostPort = FakePort<SwToTranslateHost, TranslateHostToSw>;

function open(service: TranslationService, activity?: HostActivity): HostPort {
  const port: HostPort = new FakePort('translate');
  handleTranslateHostPort(port, service, activity);
  return port;
}

describe('handleTranslateHostPort', () => {
  it('hello → hello-ack', () => {
    const service = new FakeService();
    const port = open(service);
    port.send({ type: 'hello' });
    expect(port.sent).toEqual([{ type: 'hello-ack' }]);
  });

  it('translate 的 source/segment/result 都带 SW 的 jobId', async () => {
    const service = new FakeService();
    const port = open(service);
    const request: TranslateRequest = { segments: ['Hello', 'World'], target: 'zh', source: 'en' };
    port.send({ type: 'translate', jobId: 'sw-1', request });
    expect(service.calls[0]?.request).toEqual(request);

    service.calls[0]?.handlers?.onSource?.('en');
    service.calls[0]?.handlers?.onSegment?.(0, '你好');
    service.calls[0]?.handlers?.onSegment?.(1, '世界');
    service.resolve('task-1', { status: 'complete', source: 'en' });
    await flush();

    expect(port.sent).toEqual([
      { type: 'source', jobId: 'sw-1', source: 'en' },
      { type: 'segment', jobId: 'sw-1', index: 0, text: '你好' },
      { type: 'segment', jobId: 'sw-1', index: 1, text: '世界' },
      { type: 'result', jobId: 'sw-1', result: { status: 'complete', source: 'en' } },
    ]);
  });

  it('cancel 映射到正确的执行器任务 id，未知 jobId 无操作', () => {
    const service = new FakeService();
    const port = open(service);
    port.send({ type: 'translate', jobId: 'sw-1', request: { segments: ['a'], target: 'zh', source: 'en' } });
    port.send({ type: 'translate', jobId: 'sw-2', request: { segments: ['b'], target: 'zh', source: 'en' } });
    port.send({ type: 'cancel', jobId: 'sw-2' });
    expect(service.cancel).toHaveBeenCalledWith('task-2');
    port.send({ type: 'cancel', jobId: 'missing' });
    expect(service.cancel).toHaveBeenCalledTimes(1);
  });

  it('Port 断开 → 取消该 Port 上所有未结束的任务，之后不再 postMessage', async () => {
    const service = new FakeService();
    const port = open(service);
    port.send({ type: 'translate', jobId: 'sw-1', request: { segments: ['a'], target: 'zh', source: 'en' } });
    port.send({ type: 'translate', jobId: 'sw-2', request: { segments: ['b'], target: 'zh', source: 'en' } });
    port.disconnect();
    expect(service.cancel).toHaveBeenCalledWith('task-1');
    expect(service.cancel).toHaveBeenCalledWith('task-2');

    const sent = port.sent.length;
    service.calls[0]?.handlers?.onSource?.('en');
    service.calls[0]?.handlers?.onSegment?.(0, '译');
    service.resolve('task-1', { status: 'complete', source: 'en' });
    await flush();
    expect(port.sent.length).toBe(sent);
  });

  it('postMessage 抛错不外泄', async () => {
    const service = new FakeService();
    const port = open(service);
    port.throwOnPost = true;
    expect(() => port.send({ type: 'hello' })).not.toThrow();
    port.send({ type: 'translate', jobId: 'sw-1', request: { segments: ['a'], target: 'zh', source: 'en' } });
    expect(() => service.calls[0]?.handlers?.onSource?.('en')).not.toThrow();
    expect(() => service.calls[0]?.handlers?.onSegment?.(0, '译')).not.toThrow();
    service.resolve('task-1', { status: 'complete', source: 'en' });
    await flush();
  });

  it('带 activity 时每个任务 begin/end 恰好一次（含 Port 断开取消的任务）', async () => {
    const service = new FakeService();
    const activity: HostActivity = { begin: vi.fn(), end: vi.fn() };
    const port = open(service, activity);
    port.send({ type: 'translate', jobId: 'sw-1', request: { segments: ['a'], target: 'zh', source: 'en' } });
    port.send({ type: 'translate', jobId: 'sw-2', request: { segments: ['b'], target: 'zh', source: 'en' } });
    expect(activity.begin).toHaveBeenCalledTimes(2);

    service.resolve('task-1', { status: 'complete', source: 'en' });
    await flush();
    expect(activity.end).toHaveBeenCalledTimes(1);

    port.disconnect();
    expect(service.cancel).toHaveBeenCalledWith('task-2');
    service.resolve('task-2', { status: 'cancelled', done: 0 });
    await flush();
    expect(activity.end).toHaveBeenCalledTimes(2);
    expect(activity.begin).toHaveBeenCalledTimes(2);
  });
});

describe('createIdleCloser', () => {
  it('创建后无活动到点 → close 一次', () => {
    const timers = fakeTimers();
    const close = vi.fn();
    createIdleCloser({ close, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    expect(timers.pending()).toEqual([IDLE_CLOSE_MS]);
    timers.fire();
    expect(close).toHaveBeenCalledTimes(1);
    timers.fire();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('有任务进行中不关；全部结束后重新计时', () => {
    const timers = fakeTimers();
    const close = vi.fn();
    const activity = createIdleCloser({ close, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

    activity.begin();
    activity.begin();
    expect(timers.pending()).toEqual([]);
    timers.fire();
    expect(close).not.toHaveBeenCalled();

    activity.end();
    expect(timers.pending()).toEqual([]);
    activity.end();
    expect(timers.pending()).toEqual([IDLE_CLOSE_MS]);
    timers.fire();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
