// 'panel' 与 'toast-note' 两个 Port 的 service worker 一侧。协议字面量见 src/shared/messages.ts。
import { t } from '@/shared/i18n';
import type { PanelToSw, SwToPanel, SwToToastNote, ToastNoteToSw } from '@/shared/messages';
import type { Capture, ClipSummary, EditFields, PanelState, SaveOutcome } from '@/shared/types';
import { hasChanges } from './applyEdits';

/** Port 的最小接口（便于用假 Port 测试）。 */
export interface PortLike<In, Out> {
  name: string;
  postMessage(message: Out): void;
  onMessage: { addListener(listener: (message: In) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface PanelDeps {
  /** 采集并保存 tabId 的页面，保存中经 onState 推送 saving 状态。 */
  savePage(tabId: number, onState: (state: PanelState) => void): Promise<{ capture: Capture; outcome: SaveOutcome }>;
  /** 另存一份新快照。 */
  saveSnapshot(capture: Capture, onState: (state: PanelState) => void): Promise<SaveOutcome>;
  applyEdits(clip: ClipSummary, fields: EditFields): Promise<ClipSummary>;
  /** 断线重连（resume）时按 id 找回剪藏。 */
  findClip?(clipId: string): Promise<ClipSummary | undefined>;
}

/**
 * 工具栏面板：start → 走保存流程并推送 state；snapshot → 另存新快照；draft → 记下最后的修改。
 * 面板关闭（onDisconnect）时，若最后的 draft 与已存内容不同，调一次 applyEdits；
 * 关闭时保存还没结束的，等它结束再判断。
 */
export function handlePanelPort(port: PortLike<PanelToSw, SwToPanel>, deps: PanelDeps): void {
  let connected = true;
  let started = false;
  let capture: Capture | null = null;
  let clip: ClipSummary | null = null;
  let draft: EditFields = {};
  let busy: Promise<unknown> = Promise.resolve();
  let finished = false;

  const post = (state: PanelState) => {
    if (!connected) return;
    try {
      port.postMessage({ type: 'state', state });
    } catch (err) {
      // 面板刚关闭时 postMessage 会抛错，忽略即可
      console.debug('[Alayo Get] 面板已断开', err);
    }
  };
  const settle = (outcome: SaveOutcome) => {
    if (outcome.state === 'saved' || outcome.state === 'fallback') clip = outcome.clip;
    post(outcome);
  };
  const track = (task: Promise<void>) => {
    busy = busy.then(() => task);
    task.catch((err) => console.error('[Alayo Get] 面板保存流程出错', err));
  };

  port.onMessage.addListener((message) => {
    if (!connected) return;
    switch (message.type) {
      case 'start': {
        // 进行中或已经存成功的，忽略重复的 start；失败或需要授权结束后允许重试（codex review 第 5 轮）。
        if (started) return;
        started = true;
        track(
          deps.savePage(message.tabId, post).then((result) => {
            capture = result.capture;
            settle(result.outcome);
            if (result.outcome.state === 'failed' || result.outcome.state === 'needs-permission') started = false;
          }, (err) => {
            started = false;
            throw err;
          }),
        );
        return;
      }
      case 'resume': {
        // 面板断线重连：接着编辑同一条剪藏，不重新保存（codex review 第 8 轮）
        if (started || !deps.findClip) return;
        started = true;
        track(
          deps.findClip(message.clipId).then((found) => {
            clip = found ?? null;
          }),
        );
        return;
      }
      case 'snapshot': {
        if (!capture) return;
        const current = capture;
        // 另存的是一份新剪藏，之前的 draft 不带过去
        draft = {};
        track(deps.saveSnapshot(current, post).then(settle));
        return;
      }
      case 'draft': {
        draft = { ...draft, ...message.fields };
        return;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (!connected) return;
    connected = false;
    void busy
      .catch(() => undefined)
      .then(async () => {
        if (finished) return;
        finished = true;
        if (clip && hasChanges(clip, draft)) await deps.applyEdits(clip, draft);
      })
      .catch((err) => console.error('[Alayo Get] 面板修改写回失败', err));
  });
}

export interface ToastNoteDeps {
  findClip(clipId: string): Promise<ClipSummary | undefined>;
  applyEdits(clip: ClipSummary, fields: EditFields): Promise<ClipSummary>;
}

/**
 * 页面提示里的批注框：draft 记下最后一次批注；收到 commit 或断开（含页面跳走）时写入，同一次只写一次。
 */
export function handleToastNotePort(port: PortLike<ToastNoteToSw, SwToToastNote>, deps: ToastNoteDeps): void {
  let last: { clipId: string; note: string } | null = null;
  /** 本 Port 上已落盘的批注；同一段文字不重复写。 */
  let lastWritten: string | null = null;
  let connected = true;
  // 写入串行：重复的 commit 等前一次写完再判断，不会在写入还没落盘时就回复成功（codex review 第 8 轮）。
  let chain: Promise<string | null> = Promise.resolve(null);

  /** 把当前最新的 draft 写下去；返回已落盘的批注。 */
  const writeLatest = (): Promise<string | null> => {
    chain = chain
      .catch(() => null)
      .then(async () => {
        if (!last) return lastWritten;
        const { clipId, note } = last;
        if (note === lastWritten) return note;
        const clip = await deps.findClip(clipId);
        if (!clip) throw new Error(t('error_clipNotFound'));
        if (hasChanges(clip, { note })) await deps.applyEdits(clip, { note });
        lastWritten = note;
        return note;
      });
    return chain;
  };
  const reply = (message: SwToToastNote) => {
    if (!connected) return;
    try {
      port.postMessage(message);
    } catch (err) {
      console.debug('[Alayo Get] 批注 Port 已断开', err);
    }
  };

  port.onMessage.addListener((message) => {
    if (message.type === 'draft') {
      last = { clipId: message.clipId, note: message.note };
    } else if (message.type === 'commit') {
      writeLatest().then(
        (note) => reply({ type: 'committed', note: note ?? '' }),
        (err: unknown) => {
          console.error('[Alayo Get] 批注写回失败', err);
          reply({ type: 'commit-failed', message: err instanceof Error ? err.message : String(err) });
        },
      );
    }
  });
  port.onDisconnect.addListener(() => {
    connected = false;
    void writeLatest().catch((err) => console.error('[Alayo Get] 批注写回失败', err));
  });
}
