// 'panel' Port 的 service worker 一侧。协议字面量见 src/shared/messages.ts。
import { lostEditReason } from '@/core/lostEditFile';
import type { LostEditStore } from '@/io/lostEdits';
import type { PanelToSw, SwToPanel } from '@/shared/messages';
import type { Capture, ClipSummary, ClipUnavailableState, EditFields, LostEdit, LostEditNotice, PanelState, SaveOutcome, TagCount } from '@/shared/types';
import { changedFields } from './applyEdits';
import type { ClipBook } from './clips';

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
  /** 从页面提示进入编辑态前严格核对文件（ALAG-20）；没有时沿用 findClip。 */
  checkClip?(clipId: string): ReturnType<ClipBook['checkClip']>;
  /** 写回失败留下的草稿（storage.local，ALAG-20）；没有时写回失败只记日志。 */
  lostEdits?: LostEditStore;
  /** 把草稿写成剪藏库根目录的批注草稿文件，返回写出的文件名。 */
  fileLostEdit?(edit: LostEdit): Promise<string>;
  /** 草稿条数变化后调用（background 用它开关角标的 !）。 */
  onLostEditsChanged?(count: number): void;
  newId?(): string;
  now?(): Date;
}

const errorInfo = (err: unknown): { name: string; message: string } =>
  err instanceof Error ? { name: err.name, message: err.message } : { name: 'Error', message: String(err) };

/**
 * 工具栏面板：start → 有页面提示记下的待编辑剪藏时直接进入它的编辑态（不重新保存，ALAG-16），
 * 否则走保存流程并推送 state；snapshot → 另存新快照；draft → 记下最后的修改。
 * 面板关闭（onDisconnect）时，若最后的 draft 与已存内容不同，调一次 applyEdits；
 * 关闭时保存还没结束的，等它结束再判断。
 * 写回失败时把改过的字段存进 lostEdits；连接后立刻推送草稿列表，面板上的恢复块按钮经 lost-edit 处理（ALAG-20）。
 */
export function handlePanelPort(port: PortLike<PanelToSw, SwToPanel>, deps: PanelDeps): void {
  let connected = true;
  let started = false;
  let capture: Capture | null = null;
  let clip: ClipSummary | null = null;
  let draft: EditFields = {};
  let busy: Promise<unknown> = Promise.resolve();
  let finished = false;
  /** 本次面板会话里已处理完的草稿（存成了草稿文件或重试写入成功），只在这个 Port 上显示。 */
  const notices: LostEditNotice[] = [];
  const newId = deps.newId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const now = deps.now ?? (() => new Date());

  const send = (message: SwToPanel) => {
    if (!connected) return;
    try {
      port.postMessage(message);
    } catch (err) {
      // 面板刚关闭时 postMessage 会抛错，忽略即可
      console.debug('[Alayo Get] 面板已断开', err);
    }
  };
  /** 编辑态基线号：每推一次 saved / fallback 加一；带旧基线的 draft 来自旧表单，丢弃（codex review ALAG-20 第 2 轮）。 */
  let baseline = 0;
  const post = (state: PanelState) => {
    if (state.state === 'saved' || state.state === 'fallback') {
      baseline += 1;
      send({ type: 'state', state, baseline });
    } else {
      send({ type: 'state', state });
    }
  };
  /** 推送草稿全量和本次会话的通知。 */
  const postLostEdits = async (store: LostEditStore): Promise<LostEdit[]> => {
    const edits = await store.list();
    send({ type: 'lost-edits', edits, notices: [...notices] });
    return edits;
  };
  const settle = (outcome: SaveOutcome) => {
    if (outcome.state === 'saved' || outcome.state === 'fallback') clip = outcome.clip;
    post(outcome);
  };
  const track = (task: Promise<void>) => {
    busy = busy.then(() => task);
    task.catch((err) => console.error('[Alayo Get] 面板保存流程出错', err));
  };
  /**
   * 排进同一条链、轮到时才开始执行（恢复块的动作、连接时推送草稿；codex review ALAG-20 第 1 轮）：
   * 连点两次不会并发执行同一条草稿。前一个任务失败也继续；本任务失败只记日志，不让链停在失败上。
   */
  const serial = (task: () => Promise<void>) => {
    busy = busy.then(task, task).catch((err) => console.error('[Alayo Get] 处理没写入的修改出错', err));
  };
  /** 编辑态推送的状态：书签剪藏为 fallback，其余为 saved。 */
  const editState = (c: ClipSummary): 'saved' | 'fallback' => (c.extract === 'fallback' && c.medium === 'link' ? 'fallback' : 'saved');

  /**
   * 页面提示记下的待编辑剪藏。没有记录、找不到剪藏或读取出错时返回 undefined，回到保存流程。
   * 有 checkClip 时严格核对（ALAG-20）：文件不在、已被替换或摘录找不到返回 unavailable；其他错误（如权限收回）回到保存流程。
   */
  const pendingClip = async (tabId: number): Promise<{ clip: ClipSummary } | { unavailable: ClipUnavailableState } | undefined> => {
    if (!deps.takePendingEdit || !(deps.checkClip || deps.findClip)) return undefined;
    try {
      const clipId = await deps.takePendingEdit(tabId);
      if (!clipId) return undefined;
      if (!deps.checkClip) {
        const found = await deps.findClip?.(clipId);
        return found ? { clip: found } : undefined;
      }
      const checked = await deps.checkClip(clipId);
      if (!checked) return undefined;
      if (checked.ok) return { clip: checked.clip };
      if (lostEditReason(checked.error) === 'other') {
        console.warn('[Alayo Get] 读取待编辑的剪藏出错，改为保存当前页', checked.error);
        return undefined;
      }
      return { unavailable: { state: 'clip-unavailable', clip: checked.clip, error: checked.error } };
    } catch (err) {
      console.warn('[Alayo Get] 读取待编辑的剪藏失败，改为保存当前页', err);
      return undefined;
    }
  };

  /** 写回失败：把改过的字段连同剪藏信息、错误存进草稿列表（ALAG-20）。记录本身失败只记日志。 */
  const keepLostEdit = async (failed: ClipSummary, fields: EditFields, err: unknown): Promise<void> => {
    const store = deps.lostEdits;
    if (!store) return;
    try {
      const edit: LostEdit = { id: newId(), clip: failed, fields: changedFields(failed, fields), error: errorInfo(err), at: now().toISOString() };
      await store.add(edit);
      deps.onLostEditsChanged?.((await store.list()).length);
    } catch (recordErr) {
      console.error('[Alayo Get] 记下没写入的修改失败', recordErr);
    }
  };

  /** 恢复块上的按钮：丢弃、重试写回原文件、存为批注草稿文件。找不到 id 的忽略。 */
  const handleLostEdit = async (store: LostEditStore, action: 'retry' | 'file' | 'discard', id: string): Promise<void> => {
    const edit = (await store.list()).find((e) => e.id === id);
    if (!edit) return;
    if (action === 'discard') {
      try {
        await store.remove(id);
      } catch (err) {
        console.error('[Alayo Get] 丢弃草稿失败', err);
      }
    } else if (action === 'retry') {
      // ① 写回；失败记下新的错误并结束
      let next: ClipSummary | null = null;
      try {
        next = await deps.applyEdits(edit.clip, edit.fields);
      } catch (err) {
        console.warn('[Alayo Get] 重试写入没写进去的修改失败', err);
        await store.update({ ...edit, error: errorInfo(err) });
      }
      if (next) {
        // ② 先切换基线：文件已写成，后面删草稿失败也不能让面板停在旧值上（codex review ALAG-20 第 3 轮）
        if (clip && clip.id === edit.clip.id) {
          // 面板正开着同一条剪藏：以写回后的内容为新基线，保留本次会话里用户还没提交的修改，
          // 否则关闭面板时会把刚恢复的内容覆盖回旧值（codex review ALAG-20 第 1 轮）。
          // 先等标签建议，再按等待结束时最新的 draft 算用户的修改、切换基线（第 2 轮）
          const tagSuggestions = (await deps.tagSuggestions?.()) ?? [];
          const current = clip;
          if (current && current.id === edit.clip.id) {
            const userEdits = changedFields(current, draft);
            clip = next;
            draft = userEdits;
            post({ state: editState(next), clip: { ...next, ...userEdits }, tagSuggestions });
          }
        }
        // ③ 删草稿、记通知；删不掉只记日志，草稿留在列表里，用户可以再丢弃
        try {
          await store.remove(id);
          notices.push({ id, kind: 'written', file: next.file });
        } catch (err) {
          console.error('[Alayo Get] 删除已写入的草稿失败', err);
        }
      }
    } else {
      if (!deps.fileLostEdit) return;
      // 与重试同形（codex review ALAG-20 第 4 轮）：① 写草稿文件，失败记下新的错误并结束
      let file: string | null = null;
      try {
        file = await deps.fileLostEdit(edit);
      } catch (err) {
        console.warn('[Alayo Get] 存为批注草稿文件失败', err);
        await store.update({ ...edit, error: errorInfo(err) });
      }
      if (file !== null) {
        // ② 文件已写成，先记通知；③ 删草稿失败只记日志，不当成写文件失败
        notices.push({ id, kind: 'filed', file });
        try {
          await store.remove(id);
        } catch (err) {
          console.error('[Alayo Get] 删除已存为草稿文件的草稿失败', err);
        }
      }
    }
    const edits = await postLostEdits(store);
    deps.onLostEditsChanged?.(edits.length);
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
            const pending = await pendingClip(tabId);
            if (pending && 'unavailable' in pending) {
              // 文件不在或已被替换：不进编辑态、不保存当前页，也没有重试入口（started 保持 true，ALAG-20）
              clip = null;
              capture = null;
              post(pending.unavailable);
              return;
            }
            if (pending) {
              // 编辑态：不重新保存，capture 保持 null（没有“另存新快照”）
              const found = pending.clip;
              clip = found;
              post({ state: editState(found), clip: found, tagSuggestions: (await deps.tagSuggestions?.()) ?? [] });
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
        // 基线号接着面板记下的数，之后推送的编辑态不会与旧表单的号相同（ALAG-20）
        baseline = message.baseline ?? 0;
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
        if (message.baseline !== undefined && baseline > 0 && message.baseline !== baseline) {
          console.debug('[Alayo Get] 忽略旧表单的修改', message.baseline, baseline);
          return;
        }
        draft = { ...draft, ...message.fields };
        return;
      }
      case 'lost-edit': {
        const store = deps.lostEdits;
        if (!store) return;
        // 与保存、写回同一条链串行，轮到时才执行并重新读草稿
        const { action, id } = message;
        serial(() => handleLostEdit(store, action, id));
        return;
      }
    }
  });

  // 连接后立刻（不等 start）推送写回失败留下的草稿
  if (deps.lostEdits) {
    const store = deps.lostEdits;
    serial(async () => {
      await postLostEdits(store);
    });
  }

  port.onDisconnect.addListener(() => {
    if (!connected) return;
    connected = false;
    void busy
      .catch(() => undefined)
      .then(async () => {
        if (finished) return;
        finished = true;
        if (!clip) return;
        // 只提交本会话里相对面板基线真正改过的字段：没动的字段不参与写回，
        // 不会把别的面板会话刚恢复的内容覆盖回旧值（codex review ALAG-20 第 4 轮）
        const target = clip;
        const changes = changedFields(target, draft);
        if (Object.keys(changes).length === 0) return;
        try {
          await deps.applyEdits(target, changes);
        } catch (err) {
          await keepLostEdit(target, changes, err);
          throw err;
        }
      })
      .catch((err) => console.error('[Alayo Get] 面板修改写回失败', err));
  });
}
