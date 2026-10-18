// 翻译层的公共类型（ALAG-25，ADR-0011）：引擎接口、请求/结果/错误、执行器与 SW 客户端共同实现的接口。

/** 模型在本机的状态，取值同 Chrome 的 availability()。 */
export type ModelAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

/** 要下载的模型：一个语言对的翻译模型，或语言检测模型。 */
export type ModelSpec = { kind: 'translator'; source: string; target: string } | { kind: 'detector' };

export interface DetectedLanguage {
  language: string;
  confidence: number;
}

/**
 * 翻译引擎：实际完成翻译的那一方（CONTEXT.md「翻译引擎」）。第一期只有本机引擎（id 'local'），
 * 第二期云端引擎实现同一接口，availability 恒为 available、download 为空操作。
 * 传入的语言标签都已经过 toApiTag 规范化。
 */
export interface TranslationEngine {
  readonly id: string;
  /** 当前环境有没有这个引擎可用（本机引擎：有没有 Translator 全局）。 */
  supported(): boolean;
  detectorAvailability(): Promise<ModelAvailability>;
  /** 按置信度从高到低。 */
  detect(text: string): Promise<DetectedLanguage[]>;
  availability(source: string, target: string): Promise<ModelAvailability>;
  /** 下载模型。本机引擎要求用户手势：只能在扩展页面里由用户点击触发，offscreen 里调用会失败。onProgress 参数为 0–1。 */
  download(model: ModelSpec, onProgress?: (fraction: number) => void): Promise<void>;
  translate(source: string, target: string, text: string, signal?: AbortSignal): Promise<string>;
}

export interface TranslateRequest {
  /** 按段切好的原文；空白段原样返回、不调引擎。 */
  segments: string[];
  /** 目标语言（任意 BCP 47，内部规范化）。 */
  target: string;
  /** 已知源语言时传入，跳过语言检测。 */
  source?: string;
}

export type TranslateErrorCode = 'unsupported-browser' | 'needs-download' | 'unsupported-pair' | 'source-unknown' | 'engine-failed' | 'host-lost';

export type TranslateError =
  | { code: 'unsupported-browser' }
  | { code: 'needs-download'; model: ModelSpec }
  | { code: 'unsupported-pair'; source: string; target: string }
  | { code: 'source-unknown' }
  | { code: 'engine-failed'; message: string }
  | { code: 'host-lost' };

/** done：已经通过 onSegment 交出的段数。source：规范化后的源语言，检测前失败或取消时没有。 */
export type TranslateResult =
  | { status: 'complete'; source: string }
  | { status: 'skipped'; source: string }
  | { status: 'cancelled'; source?: string; done: number }
  | { status: 'failed'; error: TranslateError; source?: string; done: number };

export interface TranslateHandlers {
  /** 确定源语言后调用一次（含跳过的情况）。 */
  onSource?(source: string): void;
  /** 每段译完调用一次，index 为 segments 下标，按下标递增顺序。 */
  onSegment?(index: number, text: string): void;
}

export interface TranslateJob {
  id: string;
  result: Promise<TranslateResult>;
}

/** 执行器与 SW 客户端共同实现的接口；调用方不关心翻译在哪里跑。 */
export interface TranslationService {
  translate(request: TranslateRequest, handlers?: TranslateHandlers): TranslateJob;
  /** 排队中的任务立即以 cancelled 结束；进行中的任务中止正在翻译的这一段并以 cancelled 结束，已交出的段不受影响；未知或已结束的 id 无操作。 */
  cancel(jobId: string): void;
}
