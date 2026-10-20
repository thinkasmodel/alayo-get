import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToastTranslationMessage } from '@/shared/messages';
import type { TranslationOutcome } from '@/shared/types';
import { createTranslationJobs, FINISHED_LIMIT, TAB_THROTTLE_MS, type ClipRef, type TranslationJobsDeps } from './translationJobs';
import type { TranslateClipRequest } from './translateClip';

const clip = (id: string): ClipRef => ({ id, source: `https://example.com/${id}`, medium: 'web', title: `标题 ${id}` });

const complete: TranslationOutcome = { status: 'complete', applied: 3, total: 3, source: 'en' };
const failed = (code: 'engine-failed' | 'host-lost'): TranslationOutcome =>
  code === 'engine-failed'
    ? { status: 'failed', applied: 0, total: 3, error: { code, message: 'boom' } }
    : { status: 'failed', applied: 0, total: 3, error: { code } };
const partial: TranslationOutcome = { status: 'partial', applied: 1, total: 3, source: 'en', error: { code: 'host-lost' } };
const needsDownload: TranslationOutcome = {
  status: 'failed',
  applied: 0,
  total: 3,
  error: { code: 'needs-download', model: { kind: 'translator', source: 'en', target: 'zh' } },
};

interface Started {
  request: TranslateClipRequest;
  onProgress: (done: number, total: number) => void;
  resolve: (outcome: TranslationOutcome) => void;
  reject: (err: unknown) => void;
}

function fakeJobs(options: { now?: () => number } = {}) {
  const started: Started[] = [];
  const sent: Array<{ tabId: number; message: ToastTranslationMessage }> = [];
  const rejects = new Set<number>();
  let throwNext: Error | null = null;
  const deps: TranslationJobsDeps = {
    start: (request, onProgress) => {
      if (throwNext) {
        const err = throwNext;
        throwNext = null;
        throw err;
      }
      let resolve!: (outcome: TranslationOutcome) => void;
      let reject!: (err: unknown) => void;
      const done = new Promise<TranslationOutcome>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      started.push({ request, onProgress, resolve, reject });
      return { done };
    },
    sendToTab: vi.fn(async (tabId: number, message: ToastTranslationMessage) => {
      if (rejects.has(tabId)) throw new Error('tab gone');
      sent.push({ tabId, message });
    }),
    ...(options.now ? { now: options.now } : {}),
  };
  return {
    jobs: createTranslationJobs(deps),
    started,
    sent,
    deps,
    rejectTab: (tabId: number) => rejects.add(tabId),
    throwStart: (err: Error) => {
      throwNext = err;
    },
  };
}

const flush = async (turns = 4): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('translationJobs：run 与 subscribe', () => {
  it('run 后 subscribe 先收到 running，之后每次 progress 与最终 finished', async () => {
    const { jobs, started } = fakeJobs();
    jobs.run(clip('a'), 'zh');
    const views: string[] = [];
    const off = jobs.subscribe('a', (view) => {
      views.push(view.phase === 'running' ? `running ${view.done}/${view.total}` : `finished ${view.outcome.status}`);
    });
    expect(views).toEqual(['running 0/0']);
    started[0]?.onProgress(1, 3);
    started[0]?.onProgress(2, 3);
    expect(views).toEqual(['running 0/0', 'running 1/3', 'running 2/3']);
    started[0]?.resolve(complete);
    await flush();
    expect(views).toEqual(['running 0/0', 'running 1/3', 'running 2/3', 'finished complete']);
    expect(jobs.view('a')).toEqual({ phase: 'finished', target: 'zh', outcome: complete });
    off();
    started[0]?.onProgress(3, 3);
    expect(views).toHaveLength(4);
  });

  it('running 中重复 run 不再调 start；完成后可以再 run', async () => {
    const { jobs, started } = fakeJobs();
    jobs.run(clip('a'), 'zh');
    jobs.run(clip('a'), 'ja');
    expect(started).toHaveLength(1);
    expect(started[0]?.request).toMatchObject({ id: 'a', target: 'zh' });

    started[0]?.resolve(complete);
    await flush();
    jobs.run(clip('a'), 'ja');
    expect(started).toHaveLength(2);
    expect(started[1]?.request).toMatchObject({ id: 'a', target: 'ja' });
  });

  it('subscribe 时还没有任务也能先订阅，任务开始后收到 running', async () => {
    const { jobs } = fakeJobs();
    const cb = vi.fn();
    jobs.subscribe('later', cb);
    expect(cb).not.toHaveBeenCalled();
    jobs.run(clip('later'), 'zh');
    expect(cb).toHaveBeenCalledWith({ phase: 'running', target: 'zh', done: 0, total: 0 });
  });

  it('progress 的 done 不超过 total', async () => {
    const { jobs, started } = fakeJobs();
    jobs.run(clip('a'), 'zh');
    started[0]?.onProgress(9, 3);
    expect(jobs.view('a')).toMatchObject({ phase: 'running', done: 3, total: 3 });
  });
});

describe('translationJobs：启动失败', () => {
  it('start 同步抛错 → finished + engine-failed，console.warn 一行', async () => {
    const { jobs, throwStart } = fakeJobs();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    throwStart(new Error('kaput'));
    jobs.run(clip('a'), 'zh');
    const view = jobs.view('a');
    expect(view).toEqual({
      phase: 'finished',
      target: 'zh',
      outcome: { status: 'failed', applied: 0, total: 0, error: { code: 'engine-failed', message: 'Error: kaput' } },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('done reject → finished + engine-failed', async () => {
    const { jobs, started } = fakeJobs();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    jobs.run(clip('a'), 'zh');
    started[0]?.reject(new Error('lost'));
    await flush();
    expect(jobs.view('a')).toMatchObject({ phase: 'finished', outcome: { status: 'failed', applied: 0, total: 0, error: { code: 'engine-failed' } } });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('translationJobs：retry', () => {
  async function finishedWith(outcome: TranslationOutcome) {
    const fake = fakeJobs();
    fake.jobs.run(clip('a'), 'zh');
    fake.started[0]?.resolve(outcome);
    await flush();
    return fake;
  }

  it.each(['engine-failed', 'host-lost'] as const)('failed + %s 时重跑同一目标', async (code) => {
    const { jobs, started } = await finishedWith(failed(code));
    jobs.retry('a');
    expect(started).toHaveLength(2);
    expect(started[1]?.request.target).toBe('zh');
    expect(jobs.view('a')).toMatchObject({ phase: 'running', target: 'zh' });
  });

  it.each([
    ['partial', partial],
    ['needs-download', needsDownload],
    ['unsupported-pair', { status: 'failed', applied: 0, total: 3, error: { code: 'unsupported-pair', source: 'th', target: 'zh' } } as TranslationOutcome],
    ['complete', complete],
  ])('%s 不重跑', async (_name, outcome) => {
    const { jobs, started } = await finishedWith(outcome);
    jobs.retry('a');
    expect(started).toHaveLength(1);
  });

  it('未知 clip 或 running 中的 retry 什么都不做', async () => {
    const { jobs, started } = fakeJobs();
    jobs.retry('nope');
    jobs.run(clip('a'), 'zh');
    jobs.retry('a');
    expect(started).toHaveLength(1);
  });

  it('重跑保留订阅者，先推送新的 running 再推送最终结果', async () => {
    const { jobs, started } = await finishedWith(failed('engine-failed'));
    const views: string[] = [];
    jobs.subscribe('a', (view) => views.push(view.phase === 'running' ? 'running' : view.outcome.status));
    expect(views).toEqual(['failed']);
    jobs.retry('a');
    expect(views).toEqual(['failed', 'running']);
    started[1]?.resolve(complete);
    await flush();
    expect(views).toEqual(['failed', 'running', 'complete']);
  });
});

describe('translationJobs：showInTab', () => {
  it('立刻发一次当前 view；running 期间 400ms 内多次 progress 只发一次，窗口结束后补发最新的', async () => {
    const now = () => Date.now();
    const { jobs, started, sent } = fakeJobs({ now });
    jobs.run(clip('a'), 'zh');
    jobs.showInTab('a', 7);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.tabId).toBe(7);
    expect(sent[0]?.message).toMatchObject({ type: 'toast-translation', clipId: 'a', title: '标题 a', view: { phase: 'running', done: 0, total: 0 } });

    started[0]?.onProgress(1, 3);
    started[0]?.onProgress(2, 3);
    expect(sent).toHaveLength(1);

    vi.advanceTimersByTime(TAB_THROTTLE_MS / 2);
    started[0]?.onProgress(3, 3);
    expect(sent).toHaveLength(1);

    vi.advanceTimersByTime(TAB_THROTTLE_MS / 2);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.message.view).toEqual({ phase: 'running', target: 'zh', done: 3, total: 3 });
  });

  it('phase 变化与最终结果不节流', async () => {
    const { jobs, started, sent } = fakeJobs({ now: () => Date.now() });
    jobs.run(clip('a'), 'zh');
    jobs.showInTab('a', 7);
    expect(sent).toHaveLength(1);
    started[0]?.resolve(complete);
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.message.view).toMatchObject({ phase: 'finished', outcome: { status: 'complete' } });
  });

  it('sendToTab reject 不抛出；标签页关闭后不再影响任务', async () => {
    const { jobs, started, sent, rejectTab } = fakeJobs({ now: () => Date.now() });
    rejectTab(7);
    jobs.run(clip('a'), 'zh');
    jobs.showInTab('a', 7);
    expect(sent).toHaveLength(0);
    started[0]?.resolve(complete);
    await flush();
    expect(jobs.view('a')).toMatchObject({ phase: 'finished', outcome: { status: 'complete' } });
  });

  it('showInTab 时还没有任务：任务开始后立即发 running', () => {
    const { jobs, sent } = fakeJobs({ now: () => Date.now() });
    jobs.showInTab('a', 7);
    expect(sent).toHaveLength(0);
    jobs.run(clip('a'), 'zh');
    expect(sent).toHaveLength(1);
  });
});

describe('translationJobs：已结束记录上限', () => {
  it(`超过 ${FINISHED_LIMIT} 条时丢最早结束的`, async () => {
    const { jobs, started } = fakeJobs();
    for (let i = 0; i <= FINISHED_LIMIT; i += 1) {
      jobs.run(clip(`c${i}`), 'zh');
      started[i]?.resolve(complete);
      await flush();
    }
    expect(jobs.view('c0')).toBeUndefined();
    expect(jobs.view('c1')).toBeDefined();
    expect(jobs.view(`c${FINISHED_LIMIT}`)).toBeDefined();
  });
});
