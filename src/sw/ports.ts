// 'panel' Port 的 service worker 一侧。协议字面量见 src/shared/messages.ts。
import type { PanelToSw, SwToPanel } from '@/shared/messages';
import type { Capture, ClipSummary, EditFields, PanelState, SaveOutcome, TagCount } from '@/shared/types';
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
  /** 断线重连（resume）、从页面提示进入编辑态时按 id 找回剪藏。 */
  findClip?(clipId: string): Promise<ClipSummary | undefined>;
  /** 页面提示「加批注…」为这个标签页记下的待编辑剪藏 id；取一次即清（ALAG-16）。 */
  takePendingEdit?(tabId: number): Promise<string | null>;
  /** 编辑态推送 state 时附带的标签建议。 */
  tagSuggestions?(): Promise<TagCount[]>;
}

/**
 * 工具栏面板：start → 有页面提示记下的待编辑剪藏时直接进入它的编辑态（不重新保存，ALAG-16），
 * 否则走保存流程并推送 state；snapshot → 另存新快照；draft → 记下最后的修改。
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

  /** 页面提示记下的待编辑剪藏；没有记录、找不到剪藏或读取出错时返回 undefined，回到保存流程。 */
  const pendingClip = async (tabId: number): Promise<ClipSummary | undefined> => {
    if (!deps.takePendingEdit || !deps.findClip) return undefined;
    try {
      const clipId = await deps.takePendingEdit(tabId);
      return clipId ? await deps.findClip(clipId) : undefined;
    } catch (err) {
      console.warn('[Alayo Get] 读取待编辑的剪藏失败，改为保存当前页', err);
      return undefined;
    }
  };

  port.onMessage.addListener((message) => {
    if (!connected) return;
    switch (message.type) {
      case 'start': {
        // 进行中或已经存成功的，忽略重复的 start；失败或需要授权结束后允许重试（codex review 第 5 轮）。
        if (started) return;
        started = true;
        const { tabId } = message;
        track(
          (async () => {
            const found = await pendingClip(tabId);
            if (found) {
              // 编辑态：不重新保存，capture 保持 null（没有“另存新快照”）
              clip = found;
              const state = found.extract === 'fallback' && found.medium === 'link' ? 'fallback' : 'saved';
              post({ state, clip: found, tagSuggestions: (await deps.tagSuggestions?.()) ?? [] });
              return;
            }
            await deps.savePage(tabId, post).then((result) => {
              capture = result.capture;
              settle(result.outcome);
              if (result.outcome.state === 'failed' || result.outcome.state === 'needs-permission') started = false;
            }, (err) => {
              started = false;
              throw err;
            });
          })(),
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
