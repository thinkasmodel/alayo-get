// SW 里的翻译任务登记（ALAG-27 §3）：面板/页面提示按 clipId 订阅进度与结果，
// 页面提示按标签页跟随（running 期间最多每 400ms 一条）。只在 SW 内存里，SW 被回收即丢（不持久化，用户已接受）。
import type { ToastTranslationMessage } from '@/shared/messages';
import type { Medium, TranslationOutcome, TranslationView } from '@/shared/types';
import type { TranslateClipRequest } from './translateClip';

export interface ClipRef {
  id: string;
  source: string;
  medium: Medium;
  title: string;
  /** 剪藏文件名；页面提示的「文件不见了」句要用（可选，面板测试的 ClipRef 可以不带）。 */
  file?: string;
}

export interface TranslationJobs {
  /** 开始翻译；同一 clip 已在 running 时什么都不做。 */
  run(clip: ClipRef, target: string): void;
  /** 只在最后一次结果是可重试的失败时重跑，否则什么都不做。 */
  retry(clipId: string): void;
  view(clipId: string): TranslationView | undefined;
  /** 立刻用当前 view 回调一次（有的话），之后每次变化回调；返回取消函数。 */
  subscribe(clipId: string, cb: (view: TranslationView) => void): () => void;
  /** 把这条翻译的进度与结果发到标签页提示：立刻发一次当前 view（有的话），之后每次变化发；
   *  running 期间两次发送至少隔 400ms（phase 变化与最终结果不节流）。 */
  showInTab(clipId: string, tabId: number): void;
}

export interface TranslationJobsDeps {
  start: (request: TranslateClipRequest, onProgress: (done: number, total: number) => void) => { done: Promise<TranslationOutcome> };
  sendToTab: (tabId: number, message: ToastTranslationMessage) => Promise<void>;
  now?: () => number;
}

/** running 期间两次页面提示之间至少隔这么久。 */
export const TAB_THROTTLE_MS = 400;
/** 最多保留多少条已结束的记录。 */
export const FINISHED_LIMIT = 20;

interface Entry {
  clip: ClipRef;
  view: TranslationView;
  /** 每次 run/retry 加一；旧任务迟到的 progress/结果不覆盖新任务。 */
  generation: number;
  /** 结束顺序（只对 finished 有意义）。 */
  finishedSeq: number;
}

interface Follow {
  tabId: number;
  lastSentAt: number;
  lastPhase: TranslationView['phase'] | undefined;
  timer: ReturnType<typeof setTimeout> | null;
}

const messageOf = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

/** 可重试的失败：一段都没写进去，且错误是引擎失败或 offscreen 断开。partial 不可重试（已写入的译文会被当原文再翻）。 */
function retryable(outcome: TranslationOutcome): boolean {
  return outcome.status === 'failed' && (outcome.error?.code === 'engine-failed' || outcome.error?.code === 'host-lost');
}

export function createTranslationJobs(deps: TranslationJobsDeps): TranslationJobs {
  const now = deps.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  /** clipId → 面板订阅者；剪藏还没有翻译任务时也可以先订阅，任务一出现就收到 running。 */
  const subscribers = new Map<string, Set<(view: TranslationView) => void>>();
  const follows = new Map<string, Follow>();
  let finishSeq = 0;

  const notify = (clipId: string, view: TranslationView): void => {
    const set = subscribers.get(clipId);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(view);
      } catch (err) {
        console.debug('[Alayo Get] 翻译订阅回调出错', err);
      }
    }
  };

  const sendFollow = (clipId: string, follow: Follow, entry: Entry): void => {
    follow.lastSentAt = now();
    follow.lastPhase = entry.view.phase;
    try {
      void deps
        .sendToTab(follow.tabId, {
          type: 'toast-translation',
          clipId,
          title: entry.clip.title,
          ...(entry.clip.file !== undefined ? { file: entry.clip.file } : {}),
          view: entry.view,
        })
        .catch(() => undefined);
    } catch {
      // 标签页已关、已跳走：静默
    }
  };

  const notifyFollow = (clipId: string): void => {
    const follow = follows.get(clipId);
    const entry = entries.get(clipId);
    if (!follow || !entry) return;
    const view = entry.view;
    // phase 变化与最终结果立刻发，其余在 running 期间按 400ms 节流。
    if (follow.lastPhase !== view.phase || view.phase === 'finished') {
      if (follow.timer !== null) {
        clearTimeout(follow.timer);
        follow.timer = null;
      }
      sendFollow(clipId, follow, entry);
      return;
    }
    const elapsed = now() - follow.lastSentAt;
    if (elapsed >= TAB_THROTTLE_MS) {
      if (follow.timer !== null) {
        clearTimeout(follow.timer);
        follow.timer = null;
      }
      sendFollow(clipId, follow, entry);
      return;
    }
    if (follow.timer !== null) return;
    follow.timer = setTimeout(() => {
      follow.timer = null;
      const latest = entries.get(clipId);
      if (!latest || latest.view.phase !== 'running') return;
      sendFollow(clipId, follow, latest);
    }, TAB_THROTTLE_MS - elapsed);
  };

  const removeEntry = (clipId: string): void => {
    entries.delete(clipId);
    const follow = follows.get(clipId);
    if (follow?.timer) clearTimeout(follow.timer);
    follows.delete(clipId);
  };

  const finish = (entry: Entry, outcome: TranslationOutcome): void => {
    entry.view = { phase: 'finished', target: entry.view.target, outcome };
    entry.finishedSeq = ++finishSeq;
    notify(entry.clip.id, entry.view);
    notifyFollow(entry.clip.id);
    // 已结束记录最多 20 条，超出丢最早结束的。
    const finished = [...entries.values()].filter((candidate) => candidate.view.phase === 'finished');
    if (finished.length > FINISHED_LIMIT) {
      finished.sort((a, b) => a.finishedSeq - b.finishedSeq);
      for (const stale of finished.slice(0, finished.length - FINISHED_LIMIT)) removeEntry(stale.clip.id);
    }
  };

  const startRun = (entry: Entry, target: string): void => {
    entry.generation += 1;
    const generation = entry.generation;
    entry.view = { phase: 'running', target, done: 0, total: 0 };
    notify(entry.clip.id, entry.view);
    notifyFollow(entry.clip.id);

    const onProgress = (done: number, total: number): void => {
      if (entries.get(entry.clip.id) !== entry || entry.generation !== generation) return;
      if (entry.view.phase !== 'running') return;
      const capped = total > 0 ? Math.min(done, total) : done;
      entry.view = { phase: 'running', target, done: capped, total };
      notify(entry.clip.id, entry.view);
      notifyFollow(entry.clip.id);
    };

    let started: { done: Promise<TranslationOutcome> };
    try {
      started = deps.start({ id: entry.clip.id, source: entry.clip.source, medium: entry.clip.medium, target }, onProgress);
    } catch (err) {
      if (entries.get(entry.clip.id) === entry && entry.generation === generation) {
        console.warn('[Alayo Get] 启动后台翻译失败', err);
        finish(entry, { status: 'failed', applied: 0, total: 0, error: { code: 'engine-failed', message: messageOf(err) } });
      }
      return;
    }
    started.done.then(
      (outcome) => {
        if (entries.get(entry.clip.id) !== entry || entry.generation !== generation) return;
        finish(entry, outcome);
      },
      (err: unknown) => {
        if (entries.get(entry.clip.id) !== entry || entry.generation !== generation) return;
        console.warn('[Alayo Get] 后台翻译失败', err);
        finish(entry, { status: 'failed', applied: 0, total: 0, error: { code: 'engine-failed', message: messageOf(err) } });
      },
    );
  };

  const run = (clip: ClipRef, target: string): void => {
    const current = entries.get(clip.id);
    if (current && current.view.phase === 'running') return;
    if (current) {
      // 重翻：保留旧订阅者，只换 clip 信息并重新开始。
      current.clip = clip;
      startRun(current, target);
      return;
    }
    const entry: Entry = { clip, view: { phase: 'running', target, done: 0, total: 0 }, generation: 0, finishedSeq: 0 };
    entries.set(clip.id, entry);
    startRun(entry, target);
  };

  return {
    run,
    retry: (clipId) => {
      const entry = entries.get(clipId);
      if (!entry || entry.view.phase !== 'finished') return;
      if (!retryable(entry.view.outcome)) return;
      startRun(entry, entry.view.target);
    },
    view: (clipId) => entries.get(clipId)?.view,
    subscribe: (clipId, cb) => {
      let set = subscribers.get(clipId);
      if (!set) {
        set = new Set();
        subscribers.set(clipId, set);
      }
      set.add(cb);
      const current = entries.get(clipId);
      if (current) {
        try {
          cb(current.view);
        } catch (err) {
          console.debug('[Alayo Get] 翻译订阅回调出错', err);
        }
      }
      return () => {
        const registered = subscribers.get(clipId);
        registered?.delete(cb);
        if (registered && registered.size === 0) subscribers.delete(clipId);
      };
    },
    showInTab: (clipId, tabId) => {
      const entry = entries.get(clipId);
      const follow: Follow = { tabId, lastSentAt: Number.NEGATIVE_INFINITY, lastPhase: undefined, timer: null };
      const previous = follows.get(clipId);
      if (previous?.timer) clearTimeout(previous.timer);
      follows.set(clipId, follow);
      if (entry) sendFollow(clipId, follow, entry);
    },
  };
}
