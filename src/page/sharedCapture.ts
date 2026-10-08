// 进行中的采集挂在内容脚本隔离世界的全局上，跨注入共享：每次保存都会重新注入采集脚本，
// 同一页面的两次触发只让一个采集器操作页面（X 作者串会滚动、点开回复，restore 也只发生一次）。
// 按页面身份（收到请求时的 location.href）区分：站内切页后的新请求开新的采集，不复用上一帖的结果。

export const CAPTURE_IN_FLIGHT_KEY = '__alayoGetCaptureInFlight';

interface InFlight<T> {
  key: string;
  promise: Promise<T>;
}

/**
 * 全局里进行中的那一项 key 相同就复用它的 Promise；否则开新的采集并登记为当前项。
 * 完成后（无论成败）只在全局还是自己那一项时才清掉。
 */
export function sharedCapture<T>(scope: Record<string, unknown>, key: string, run: () => Promise<T>): Promise<T> {
  const current = scope[CAPTURE_IN_FLIGHT_KEY] as InFlight<T> | undefined;
  if (current && current.key === key) return current.promise;
  const entry: InFlight<T> = {
    key,
    promise: run().finally(() => {
      if (scope[CAPTURE_IN_FLIGHT_KEY] === entry) delete scope[CAPTURE_IN_FLIGHT_KEY];
    }),
  };
  scope[CAPTURE_IN_FLIGHT_KEY] = entry;
  return entry.promise;
}
