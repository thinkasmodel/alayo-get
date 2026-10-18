// service worker 一侧的翻译客户端（ALAG-25 §9）：按需创建 offscreen 文档、连接并握手、
// 把任务发给 offscreen 的 host，转发进度、取消，断线时把未结束任务折成 host-lost，空闲时关闭文档。
import type { TranslateHandlers, TranslateRequest, TranslateResult, TranslationService } from '@/core/translate/types';
import { TRANSLATE_PORT, type SwToTranslateHost, type TranslateHostToSw } from '@/shared/messages';
import type { PortLike } from './ports';

export interface TranslateClientDeps {
  /** 是否已有 offscreen 文档（真实实现：runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })）。 */
  hasDocument(): Promise<boolean>;
  createDocument(): Promise<void>;
  closeDocument(): Promise<void>;
  /** PortLike 之外还要 disconnect()，用于握手超时时主动断开。 */
  connect(): PortLike<TranslateHostToSw, SwToTranslateHost> & { disconnect(): void };
  newId?: () => string;
  /** 便于测试注入假计时器；缺省 setTimeout/clearTimeout。 */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const CONNECT_ATTEMPTS = 50;
export const CONNECT_RETRY_MS = 100;
export const ACK_TIMEOUT_MS = 2000;
export const IDLE_CLOSE_MS = 60_000;

type Port = PortLike<TranslateHostToSw, SwToTranslateHost> & { disconnect(): void };

interface Job {
  id: string;
  request: TranslateRequest;
  handlers?: TranslateHandlers;
  /** 是否已经发出 translate 消息。 */
  sent: boolean;
  /** host 送来的 segment 条数。 */
  done: number;
  settled: boolean;
  resolve: (result: TranslateResult) => void;
}

export function createTranslateClient(deps: TranslateClientDeps): TranslationService {
  const newId = deps.newId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const jobs = new Map<string, Job>();
  let port: Port | null = null;
  let connecting: Promise<boolean> | null = null;
  /** 建文档过程的 Promise 缓存：并发调用只建一次（offscreen 文档只能有一个）。 */
  let documentPromise: Promise<void> | null = null;
  /** 空闲关闭的 Promise：关闭完成（或失败）前，新任务必须等它结束再判断文档是否存在。 */
  let closing: Promise<void> | null = null;
  let idleTimer: unknown = null;

  const hostLost = (): TranslateResult => ({ status: 'failed', error: { code: 'host-lost' }, done: 0 });

  const cancelIdleClose = (): void => {
    if (idleTimer !== null) {
      clearTimer(idleTimer);
      idleTimer = null;
    }
  };

  /** 关掉 offscreen 文档；失败忽略（文档可能已经自己关闭，或正被别处关闭）。 */
  const startClosingDocument = (): void => {
    let closingDocument: Promise<void>;
    try {
      closingDocument = deps.closeDocument();
    } catch (err) {
      console.debug('[Alayo Get] 关闭翻译 offscreen 文档失败', err);
      return;
    }
    const tracked = closingDocument.catch((err: unknown) => {
      console.debug('[Alayo Get] 关闭翻译 offscreen 文档失败', err);
    });
    closing = tracked;
    void tracked.finally(() => {
      if (closing === tracked) closing = null;
    });
  };

  const scheduleIdleClose = (): void => {
    if (idleTimer !== null || jobs.size > 0) return;
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (jobs.size > 0) return;
      const closed = port;
      port = null;
      documentPromise = null;
      if (closed) {
        try {
          closed.disconnect();
        } catch (err) {
          console.debug('[Alayo Get] 断开空闲的翻译 Port 失败', err);
        }
      }
      startClosingDocument();
    }, IDLE_CLOSE_MS);
  };

  const settle = (job: Job, result: TranslateResult): void => {
    if (job.settled) return;
    job.settled = true;
    job.resolve(result);
    jobs.delete(job.id);
    if (jobs.size === 0) scheduleIdleClose();
  };

  const send = (target: Port, message: SwToTranslateHost): boolean => {
    try {
      target.postMessage(message);
      return true;
    } catch (err) {
      console.debug('[Alayo Get] 翻译 Port 已断开', err);
      return false;
    }
  };

  const sendJob = (job: Job, target: Port): void => {
    if (job.sent || job.settled) return;
    job.sent = true;
    if (!send(target, { type: 'translate', jobId: job.id, request: job.request })) {
      handlePortLost(target);
    }
  };

  const sendWaiting = (): void => {
    if (!port) return;
    for (const job of [...jobs.values()]) {
      if (!port) return;
      if (!job.settled && !job.sent) sendJob(job, port);
    }
  };

  /** 连接失败：还在等待发送的任务以 host-lost 结束。已发出的任务在断线处理里结束。 */
  const failWaiting = (): void => {
    for (const job of [...jobs.values()]) {
      if (!job.sent) settle(job, hostLost());
    }
  };

  const handleHostMessage = (message: TranslateHostToSw): void => {
    switch (message.type) {
      case 'hello-ack':
        return;
      case 'source': {
        const job = jobs.get(message.jobId);
        if (!job || job.settled) return;
        try {
          job.handlers?.onSource?.(message.source);
        } catch (err) {
          console.debug('[Alayo Get] 翻译源语言处理出错', err);
        }
        return;
      }
      case 'segment': {
        const job = jobs.get(message.jobId);
        if (!job || job.settled) return;
        job.done += 1;
        try {
          job.handlers?.onSegment?.(message.index, message.text);
        } catch (err) {
          console.debug('[Alayo Get] 翻译进度处理出错', err);
        }
        return;
      }
      case 'result': {
        const job = jobs.get(message.jobId);
        if (!job || job.settled) return;
        settle(job, message.result);
        return;
      }
    }
  };

  /** 已连上的 Port 断开：所有未结束任务以 host-lost 结束，丢掉缓存的 Port，下一个任务重新建文档/连接。 */
  const handlePortLost = (lost: Port): void => {
    if (port !== lost) return;
    port = null;
    documentPromise = null;
    for (const job of [...jobs.values()]) {
      settle(job, { status: 'failed', error: { code: 'host-lost' }, done: job.done });
    }
  };

  const ensureDocument = async (): Promise<void> => {
    // 空闲关闭还没完成时，hasDocument() 仍可能为 true；要先等它关完，再判断并建新文档。
    if (closing) {
      try {
        await closing;
      } catch (err) {
        // 关闭失败已在 startClosingDocument 里吞掉；这里只是防御
        console.debug('[Alayo Get] 等待翻译 offscreen 文档关闭失败', err);
      }
    }
    if (!documentPromise) {
      documentPromise = (async () => {
        if (await deps.hasDocument()) return;
        await deps.createDocument();
      })().catch((err: unknown) => {
        documentPromise = null;
        throw err;
      });
    }
    return documentPromise;
  };

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimer(resolve, ms);
    });

  /** 一次连接尝试：发出 hello，收到 hello-ack 才算成功；超时或 ack 前断开算失败并主动断开。 */
  const attemptConnect = (): Promise<Port | null> =>
    new Promise((resolve) => {
      let settled = false;
      let timer: unknown = null;
      let target: Port;
      try {
        target = deps.connect();
      } catch (err) {
        console.warn('[Alayo Get] 连接翻译 offscreen 文档失败', err);
        resolve(null);
        return;
      }

      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          clearTimer(timer);
          timer = null;
        }
        if (!ok) {
          try {
            target.disconnect();
          } catch (err) {
            console.debug('[Alayo Get] 断开翻译 Port 失败', err);
          }
          resolve(null);
          return;
        }
        port = target;
        sendWaiting();
        if (port !== target) {
          // 发送待发任务时 Port 就断了：算这次连接失败，让上层重试。
          resolve(null);
          return;
        }
        resolve(target);
      };

      target.onMessage.addListener((message) => {
        if (!settled) {
          if (message.type === 'hello-ack') finish(true);
          return;
        }
        if (port === target) handleHostMessage(message);
      });

      target.onDisconnect.addListener(() => {
        if (!settled) {
          finish(false);
          return;
        }
        handlePortLost(target);
      });

      timer = setTimer(() => finish(false), ACK_TIMEOUT_MS);
      try {
        target.postMessage({ type: 'hello' });
      } catch (err) {
        console.warn('[Alayo Get] 翻译 Port 握手消息发送失败', err);
        finish(false);
      }
    });

  const connectLoop = async (): Promise<boolean> => {
    try {
      await ensureDocument();
    } catch (err) {
      console.warn('[Alayo Get] 创建翻译 offscreen 文档失败', err);
      return false;
    }
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
      if (port) return true;
      const connected = await attemptConnect();
      if (connected) return true;
      if (attempt < CONNECT_ATTEMPTS) await delay(CONNECT_RETRY_MS);
    }
    return false;
  };

  const ensureConnected = (): Promise<boolean> => {
    if (port) return Promise.resolve(true);
    if (!connecting) {
      connecting = connectLoop().then(
        (ok) => {
          connecting = null;
          return ok;
        },
        (err: unknown) => {
          connecting = null;
          console.warn('[Alayo Get] 连接翻译 offscreen 文档失败', err);
          return false;
        },
      );
    }
    return connecting;
  };

  return {
    translate(request: TranslateRequest, handlers?: TranslateHandlers) {
      cancelIdleClose();
      const id = newId();
      let resolve!: (result: TranslateResult) => void;
      const result = new Promise<TranslateResult>((done) => {
        resolve = done;
      });
      const job: Job = { id, request, handlers, sent: false, done: 0, settled: false, resolve };
      jobs.set(id, job);

      void ensureConnected().then(
        (ok) => {
          if (job.settled) return;
          if (!ok || !port) {
            failWaiting();
            return;
          }
          if (!job.sent) sendJob(job, port);
        },
        (err: unknown) => {
          console.warn('[Alayo Get] 翻译连接失败', err);
          failWaiting();
        },
      );

      return { id, result };
    },

    cancel(jobId: string): void {
      const job = jobs.get(jobId);
      if (!job || job.settled) return;
      if (!job.sent) {
        // 还没发出去：直接结束，不发任何消息
        settle(job, { status: 'cancelled', done: 0 });
        return;
      }
      if (port && !send(port, { type: 'cancel', jobId })) handlePortLost(port);
    },
  };
}

/**
 * 真实依赖：browser.offscreen / browser.runtime。url 'offscreen.html'，reasons ['DOM_PARSER']。
 * offscreen 没有翻译专用的 reason，DOM_PARSER 是占位；真实用途写在 justification 里
 * （ALAG-24 实测此 reason 可用）。
 */
export function chromeTranslateClientDeps(): TranslateClientDeps {
  return {
    async hasDocument(): Promise<boolean> {
      const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      return contexts.length > 0;
    },
    createDocument(): Promise<void> {
      return browser.offscreen.createDocument({
        url: browser.runtime.getURL('/offscreen.html'),
        reasons: ['DOM_PARSER'],
        justification:
          "Runs the browser's built-in on-device Translator and LanguageDetector APIs, which are only available in a window context.",
      });
    },
    closeDocument(): Promise<void> {
      return browser.offscreen.closeDocument();
    },
    connect(): Port {
      return browser.runtime.connect({ name: TRANSLATE_PORT }) as unknown as Port;
    },
  };
}
