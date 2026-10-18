// offscreen 文档一侧的翻译 Port 处理（ALAG-25 §8）：把 SW 的 jobId 映射到执行器任务 id，
// 转发源语言、逐段译文和最终结果。offscreen 文档断开时取消它上面所有未结束的任务。
import type { SwToTranslateHost, TranslateHostToSw } from '@/shared/messages';
import type { TranslateJob, TranslationService } from '@/core/translate/types';
import type { PortLike } from '@/sw/ports';

/** offscreen 文档无活动时自行关闭的等待时间（SW 的计时器会随休眠丢失，所以放在文档里）。 */
export const IDLE_CLOSE_MS = 60_000;

export interface HostActivity {
  begin(): void;
  end(): void;
}

/**
 * 无活动计时器：创建时就开始计时；begin 计数加一并取消计时，end 计数减一，
 * 减到 0 时重新计时；计时到点且计数为 0 时 close()，只调一次。
 */
export function createIdleCloser(deps: {
  close(): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): HostActivity {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let active = 0;
  let timer: unknown = null;
  let closed = false;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const start = (): void => {
    if (closed || active > 0 || timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      if (closed || active > 0) return;
      closed = true;
      deps.close();
    }, IDLE_CLOSE_MS);
  };

  start();

  return {
    begin(): void {
      if (closed) return;
      active += 1;
      cancel();
    },
    end(): void {
      if (closed) return;
      active -= 1;
      if (active <= 0) {
        active = 0;
        start();
      }
    },
  };
}

export function handleTranslateHostPort(
  port: PortLike<SwToTranslateHost, TranslateHostToSw>,
  service: TranslationService,
  activity?: HostActivity,
): void {
  let connected = true;
  /** SW 的 jobId → 执行器任务 id；结果送达后删除。 */
  const jobs = new Map<string, string>();

  const send = (message: TranslateHostToSw): void => {
    if (!connected) return;
    try {
      port.postMessage(message);
    } catch (err) {
      // 对端刚断开时 postMessage 会抛错，忽略即可（同 src/sw/ports.ts 的 send）
      console.debug('[Alayo Get] 翻译 Port 已断开', err);
    }
  };

  port.onMessage.addListener((message) => {
    if (!connected) return;
    switch (message.type) {
      case 'hello':
        send({ type: 'hello-ack' });
        return;
      case 'translate': {
        const { jobId, request } = message;
        activity?.begin();
        let job: TranslateJob;
        try {
          job = service.translate(request, {
            onSource: (source) => send({ type: 'source', jobId, source }),
            onSegment: (index, text) => send({ type: 'segment', jobId, index, text }),
          });
        } catch (err) {
          activity?.end();
          console.error('[Alayo Get] 提交翻译任务失败', err);
          return;
        }
        jobs.set(jobId, job.id);
        void job.result.then(
          (result) => {
            jobs.delete(jobId);
            activity?.end();
            send({ type: 'result', jobId, result });
          },
          (err: unknown) => {
            // 接口约定 result 不 reject（§3）；真出现只记日志，不留悬挂的映射。
            jobs.delete(jobId);
            activity?.end();
            console.error('[Alayo Get] 翻译任务异常结束', err);
          },
        );
        return;
      }
      case 'cancel': {
        const jobId = jobs.get(message.jobId);
        if (jobId !== undefined) service.cancel(jobId);
        return;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (!connected) return;
    connected = false;
    for (const jobId of jobs.values()) service.cancel(jobId);
    jobs.clear();
  });
}
