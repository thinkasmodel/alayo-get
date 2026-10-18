// 契约测试（ALAG-25 §10）：同一组用例分别跑「执行器直连」与「SW 客户端 ↔ 内存 Port ↔ offscreen host ↔ 执行器」，
// 两种接法的结果必须逐字段相同。
import { describe, expect, it } from 'vitest';
import { createTranslationRunner } from './runner';
import type { TranslateHandlers, TranslateRequest, TranslateResult, TranslationEngine, TranslationService } from './types';
import { handleTranslateHostPort } from '@/offscreen/host';
import { createTranslateClient } from '@/sw/translateClient';
import type { SwToTranslateHost, TranslateHostToSw } from '@/shared/messages';
import type { PortLike } from '@/sw/ports';

class MemoryPort<In, Out> implements PortLike<In, Out> {
  peer: MemoryPort<Out, In> | null = null;
  readonly name = 'translate';
  private messageListeners: Array<(message: In) => void> = [];
  private disconnectListeners: Array<() => void> = [];

  postMessage(message: Out): void {
    this.peer?.deliver(message);
  }

  onMessage = { addListener: (fn: (message: In) => void) => void this.messageListeners.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => void this.disconnectListeners.push(fn) };

  deliver(message: In): void {
    for (const fn of this.messageListeners) fn(message);
  }

  disconnect(): void {
    for (const fn of this.disconnectListeners) fn();
  }
}

function portPair(): { client: MemoryPort<TranslateHostToSw, SwToTranslateHost>; host: MemoryPort<SwToTranslateHost, TranslateHostToSw> } {
  const client = new MemoryPort<TranslateHostToSw, SwToTranslateHost>();
  const host = new MemoryPort<SwToTranslateHost, TranslateHostToSw>();
  client.peer = host;
  host.peer = client;
  return { client, host };
}

function fakeEngine(overrides: Partial<TranslationEngine> = {}): TranslationEngine {
  return {
    id: 'fake',
    supported: () => true,
    detectorAvailability: async () => 'available',
    detect: async () => [{ language: 'en', confidence: 0.99 }],
    availability: async () => 'available',
    download: async () => undefined,
    translate: async (_source, _target, text) => `[${text}]`,
    ...overrides,
  };
}

interface Snapshot {
  result: TranslateResult;
  sources: string[];
  segments: Array<{ index: number; text: string }>;
}

async function collect(service: TranslationService, request: TranslateRequest): Promise<Snapshot> {
  const sources: string[] = [];
  const segments: Array<{ index: number; text: string }> = [];
  const handlers: TranslateHandlers = {
    onSource: (source) => sources.push(source),
    onSegment: (index, text) => segments.push({ index, text }),
  };
  const job = service.translate(request, handlers);
  return { result: await job.result, sources, segments };
}

function connectedClient(makeEngine: () => TranslationEngine): TranslationService {
  const { client, host } = portPair();
  handleTranslateHostPort(host, createTranslationRunner(makeEngine()));
  let nextId = 0;
  return createTranslateClient({
    hasDocument: async () => true,
    createDocument: async () => undefined,
    closeDocument: async () => undefined,
    connect: () => client,
    newId: () => `job-${++nextId}`,
    // 连接都是即时的，不需要真的等计时器；避免留下 60 秒的空闲关闭定时器。
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
}

async function bothWays(makeEngine: () => TranslationEngine, request: TranslateRequest): Promise<Snapshot> {
  const direct = await collect(createTranslationRunner(makeEngine()), request);
  const viaClient = await collect(connectedClient(makeEngine), request);
  expect(viaClient).toEqual(direct);
  return direct;
}

async function cancelInProgress(service: TranslationService, request: TranslateRequest): Promise<Snapshot> {
  const sources: string[] = [];
  const segments: Array<{ index: number; text: string }> = [];
  let resolveFirst!: () => void;
  const firstSegment = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  const job = service.translate(request, {
    onSource: (source) => sources.push(source),
    onSegment: (index, text) => {
      segments.push({ index, text });
      if (index === 0) resolveFirst();
    },
  });
  await firstSegment;
  service.cancel(job.id);
  return { result: await job.result, sources, segments };
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

describe('翻译契约：执行器直连 vs 客户端 ↔ Port ↔ host ↔ 执行器', () => {
  it('完整翻译：onSource 一次、onSegment 按下标、结果 complete', async () => {
    const snapshot = await bothWays(() => fakeEngine(), { segments: ['Hello', 'World'], target: 'zh-CN', source: 'en' });
    expect(snapshot).toEqual({
      result: { status: 'complete', source: 'en' },
      sources: ['en'],
      segments: [
        { index: 0, text: '[Hello]' },
        { index: 1, text: '[World]' },
      ],
    });
  });

  it('同语言跳过：skipped，不翻译', async () => {
    const snapshot = await bothWays(() => fakeEngine(), { segments: ['Hello'], target: 'en-US', source: 'en' });
    expect(snapshot).toEqual({ result: { status: 'skipped', source: 'en' }, sources: ['en'], segments: [] });
  });

  it('语言对模型未下载：needs-download（translator）', async () => {
    const snapshot = await bothWays(
      () => fakeEngine({ availability: async () => 'downloadable' }),
      { segments: ['Hello'], target: 'zh', source: 'en' },
    );
    expect(snapshot).toEqual({
      result: {
        status: 'failed',
        error: { code: 'needs-download', model: { kind: 'translator', source: 'en', target: 'zh' } },
        source: 'en',
        done: 0,
      },
      sources: ['en'],
      segments: [],
    });
  });

  it('引擎抛错：engine-failed，结果不 reject', async () => {
    const snapshot = await bothWays(
      () =>
        fakeEngine({
          translate: async () => {
            throw new Error('boom');
          },
        }),
      { segments: ['Hello'], target: 'zh', source: 'en' },
    );
    expect(snapshot).toEqual({
      result: { status: 'failed', error: { code: 'engine-failed', message: 'Error: boom' }, source: 'en', done: 0 },
      sources: ['en'],
      segments: [],
    });
  });

  it('取消进行中的任务：cancelled，done 为已交出段数', async () => {
    const request: TranslateRequest = { segments: ['One', 'Two'], target: 'zh', source: 'en' };
    const makeEngine = (): TranslationEngine =>
      fakeEngine({
        translate: (source, target, text, signal) =>
          text === 'Two'
            ? new Promise<string>((_resolve, reject) => {
                const abort = () => reject(abortError());
                if (signal?.aborted) abort();
                else signal?.addEventListener('abort', abort);
              })
            : Promise.resolve(`[${text}]`),
      });

    const direct = await cancelInProgress(createTranslationRunner(makeEngine()), request);
    const viaClient = await cancelInProgress(connectedClient(makeEngine), request);
    expect(viaClient).toEqual(direct);
    expect(direct).toEqual({
      result: { status: 'cancelled', source: 'en', done: 1 },
      sources: ['en'],
      segments: [{ index: 0, text: '[One]' }],
    });
  });
});
