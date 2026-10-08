// 剪藏库写入的互斥：保存（查重 → 分配文件名 → 写入 → 提交已保存记录）与修改写回（改名）必须串行，
// 否则并发的同名或同源保存会互相覆盖（codex review ALAG-2A [high]）。

export type Lock = <T>(fn: () => Promise<T>) => Promise<T>;

/** 建一个先进先出的互斥：前一个任务结束（成功或失败）后才开始下一个。 */
export function createLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** service worker 里唯一的剪藏库锁；saveClip 与 applyEdits 默认共用它。 */
export const libraryLock: Lock = createLock();
