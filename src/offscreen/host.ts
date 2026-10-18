// offscreen 文档一侧的翻译 Port 处理（ALAG-25 §8）：把 SW 的 jobId 映射到执行器任务 id，
// 转发源语言、逐段译文和最终结果。offscreen 文档断开时取消它上面所有未结束的任务。
import type { SwToTranslateHost, TranslateHostToSw } from '@/shared/messages';
import type { TranslationService } from '@/core/translate/types';
import type { PortLike } from '@/sw/ports';

export function handleTranslateHostPort(port: PortLike<SwToTranslateHost, TranslateHostToSw>, service: TranslationService): void {
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
        const job = service.translate(request, {
          onSource: (source) => send({ type: 'source', jobId, source }),
          onSegment: (index, text) => send({ type: 'segment', jobId, index, text }),
        });
        jobs.set(jobId, job.id);
        void job.result.then(
          (result) => {
            jobs.delete(jobId);
            send({ type: 'result', jobId, result });
          },
          (err: unknown) => {
            // 接口约定 result 不 reject（§3）；真出现只记日志，不留悬挂的映射。
            jobs.delete(jobId);
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
