// 消息与 Port 协议的字面量和类型。冻结于 tasks/briefs/ALAG-2A.md「协议」段，Brief B 依赖，不改字面量。
import type { Capture, EditFields, PanelState, QuoteCaptureInfo, SaveOutcome } from './types';

// ---- 页面内消息（tabs.sendMessage / runtime.onMessage）

/** SW → 页面：请求采集。页面回 Capture，或 CaptureError。 */
export interface CaptureRequest {
  type: 'capture';
}
export interface CaptureError {
  error: string;
}
export type CaptureResponse = Capture | CaptureError;

/** SW → 页面：显示页面提示（界面由 Brief B 做）。 */
export interface ToastMessage {
  type: 'toast';
  outcome: SaveOutcome;
  /** 这条提示对应的保存请求；提示上的按钮回传它，后台据此重放同一份采集结果（codex review 第 6 轮）。 */
  requestId?: string;
}

/** 选项页 → SW：已授权，触发补写。 */
export interface LibraryGrantedMessage {
  type: 'library-granted';
}

/** 面板、页面提示 → SW：打开选项页的某一节（ALAG-2B 追加）。 */
export interface OpenOptionsMessage {
  type: 'open-options';
  section: 'reauth' | 'library';
}

/**
 * 页面提示 → SW：提示上的按钮。snapshot / retry 按 sender.tab.id 重跑保存（ALAG-2B 追加）；
 * note 记下这个标签页要编辑 clipId 这条剪藏，并打开工具栏面板（ALAG-16，ADR-0008）。
 */
export interface ToastActionMessage {
  type: 'toast-action';
  action: 'snapshot' | 'retry' | 'note';
  /** 由采集脚本按所属提示附上。 */
  requestId?: string;
  /** action 为 'note' 时必带：要编辑的剪藏。 */
  clipId?: string;
}

/** SW → 页面提示：只有 action 'note' 有响应；opened 为面板是否打开了。 */
export interface ToastActionResponse {
  opened: boolean;
}

/** SW → 页面：采集 X 帖子里的视频，存成流媒体剪藏（ALAG-4）。页面回 Capture（kind 'stream'），或 CaptureError。 */
export interface CaptureXVideoRequest {
  type: 'capture-x-video';
  statusId: string;
  /** 右键的视频的 src（info.srcUrl）；有就按这个 video 所在的帖子采集，没有按 statusId 找焦点帖 */
  srcUrl?: string;
}

/** SW → 页面（只发给顶层 frame）：采集当前选区，存成摘录剪藏（ALAG-4）。页面回 QuoteCaptureResponse。 */
export interface CaptureQuoteRequest {
  type: 'capture-quote';
}

/** 页面 → SW：页面地址、标题与选区的摘录信息；取不到选区（没有选区、选区在输入框里）时 quote 为 null。 */
export interface QuoteCaptureResponse {
  url: string;
  title: string;
  quote: QuoteCaptureInfo | null;
}

export type PageMessage = CaptureRequest | ToastMessage | CaptureXVideoRequest | CaptureQuoteRequest;
export type RuntimeMessage = LibraryGrantedMessage | OpenOptionsMessage | ToastActionMessage;

// ---- Port 'panel'（工具栏面板）

export const PANEL_PORT = 'panel';

export type PanelToSw =
  | { type: 'start'; tabId: number }
  | { type: 'snapshot' }
  | { type: 'draft'; fields: EditFields }
  /** 面板仍开着、service worker 被终止导致断线后，面板重连并接着编辑同一条剪藏（不重新保存）。 */
  | { type: 'resume'; clipId: string };

export type SwToPanel = { type: 'state'; state: PanelState };

export function isCaptureError(r: CaptureResponse): r is CaptureError {
  return typeof (r as CaptureError).error === 'string';
}
