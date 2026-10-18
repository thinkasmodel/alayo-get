// service worker 一侧的翻译客户端（ALAG-25 §9）：按需创建 offscreen 文档、连接并握手、
// 把任务发给 offscreen 的 host，转发进度、取消。文档自己空闲关闭后 Port 断开，客户端丢掉 Port，
// 下一个任务重新建文档、重新连接；关闭时刚发出的任务在新连接上重发一次。
import type { TranslateHandlers, TranslateRequest, TranslateResult, TranslationService } from '@/core/translate/types';
import { TRANSLATE_PORT, type SwToTranslateHost, type TranslateHostToSw } from '@/shared/messages';
import type { PortLike } from './ports';

export interface TranslateClientDeps {
  /** 是否已有 offscreen 文档（真实实现：runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })）。 */
  hasDocument(): Promise<boolean>;
  createDocument(): Promise<void>;
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

type Port = PortLike<TranslateHostToSw, SwToTranslateHost> & { disconnect(): void };

interface Job {
  id: string;
  request: TranslateRequest;
  handlers?: TranslateHandlers;
  /** 是否已经发出 translate 消息。 */
  sent: boolean;
  /** 是否收到过这个任务的任何消息（source 或 segment）。 */
  received: boolean;
  /** 是否已经因断线重发过一次。 */
  resent: boolean;
  /** 用户已经请求取消；断线时不再重发。 */
  cancelRequested: boolean;
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

  const hostLost = (done: number): TranslateResult => ({ status: 'failed', error: { code: 'host-lost' }, done });

  const settle = (job: Job, result: TranslateResult): void => {
    if (job.settled) return;
    job.settled = true;
    job.resolve(result);
    jobs.delete(job.id);
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
      if (!job.sent) settle(job, hostLost(job.done));
    }
  };

  const handleHostMessage = (message: TranslateHostToSw): void => {
    switch (message.type) {
      case 'hello-ack':
        return;
      case 'source': {
        const job = jobs.get(message.jobId);
        if (!job || job.settled) return;
        job.received = true;
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
        job.received = true;
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

  /**
   * 已连上的 Port 断开：丢掉缓存的 Port，下一个任务重新建文档/连接。
   * 已发出但还没收到任何消息的任务在新连接上重发一次；收到过消息、已重发过或已请求取消的照旧 host-lost。
   */
  const handlePortLost = (lost: Port): void => {
    if (port !== lost) return;
    port = null;
    documentPromise = null;
    for (const job of [...jobs.values()]) {
      if (job.sent && !job.received && !job.resent && !job.cancelRequested) {
        job.sent = false;
        job.resent = true;
        scheduleJob(job);
        continue;
      }
      settle(job, hostLost(job.done));
    }
  };

  const ensureDocument = (): Promise<void> => {
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

  /** 等待/建立连接后把任务发出去；连接失败时把所有还没发出的任务以 host-lost 结束。 */
  const scheduleJob = (job: Job): void => {
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
  };

  return {
    translate(request: TranslateRequest, handlers?: TranslateHandlers) {
      const id = newId();
      let resolve!: (result: TranslateResult) => void;
      const result = new Promise<TranslateResult>((done) => {
        resolve = done;
      });
      const job: Job = {
        id,
        request,
        handlers,
        sent: false,
        received: false,
        resent: false,
        cancelRequested: false,
        done: 0,
        settled: false,
        resolve,
      };
      jobs.set(id, job);
      scheduleJob(job);
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
      // 已发出的任务等待 host 的 result；期间断线也不重发。
      job.cancelRequested = true;
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
    connect(): Port {
      return browser.runtime.connect({ name: TRANSLATE_PORT }) as unknown as Port;
    },
  };
}
