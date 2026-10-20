// 保存后的后台翻译（ALAG-26）：先照常存原文，再逐块把译文插入同一个文件，frontmatter 记翻译状态。
// 每次写回都在剪藏库锁内重新定位文件（标题被改过时文件名会变）、重读、核对 id，再插入译文；
// 原文一字不改，失败或中断时已写进去的译文保留、状态如实（ADR-0011）。
import { applyTranslations, planBilingual, renderTranslation, type BilingualPlan, type Unit } from '@/core/bilingual';
import { removeTranslationFields, setTranslationFields } from '@/core/frontmatter';
import { sameLanguage, toApiTag } from '@/core/translate/language';
import type { TranslateResult, TranslationService } from '@/core/translate/types';
import type { Library } from '@/io/library';
import type { SavedIndex } from '@/io/savedIndex';
import type { Medium, TranslationOutcome } from '@/shared/types';
import { frontmatterId } from './applyEdits';
import type { Lock } from './lock';

/** 两次写回之间的最短间隔：第一个单元完成后开始计时。 */
export const FLUSH_MS = 15_000;

export type { TranslationOutcome, TranslationStatus } from '@/shared/types';

export interface TranslateClipRequest {
  /** 剪藏 id（frontmatter id）。 */
  id: string;
  /** 已保存记录的键（规范化出处）。 */
  source: string;
  medium: Medium;
  /** 目标语言（任意 BCP 47，内部规范化）。 */
  target: string;
}

export interface TranslateClipDeps {
  library: Library;
  index: SavedIndex;
  /** 与保存、写回共用的剪藏库锁。 */
  lock: Lock;
  translator: TranslationService;
  /** 规划完成后以 (0, total) 调一次，之后每个单元的段全部到齐时调一次 (已完成单元数, total)。 */
  onProgress?: (done: number, total: number) => void;
  /** 便于测试注入假计时器；缺省 setTimeout/clearTimeout。 */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => Date;
}

type Located = { file: string; md: string } | { reason: string; err?: unknown };

const messageOf = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

/** 读出 frontmatter 里的 translation 值；没有这个键或解析不了时返回 undefined。 */
function translationStateOf(md: string): string | undefined {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1];
  if (block === undefined) return undefined;
  const raw = /^translation: (.*)$/m.exec(block)?.[1]?.trim();
  if (raw === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return raw;
  }
}

/**
 * 启动一次后台翻译任务。返回的 done 在任务结束（含 aborted）时解析；调用方不 await 也不影响保存。
 * 不做 service worker 重启后的续翻，也不落任务记录（用户定：边翻边写，不自动续翻）。
 */
export function startClipTranslation(request: TranslateClipRequest, deps: TranslateClipDeps): { done: Promise<TranslationOutcome> } {
  const target = toApiTag(request.target.trim());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let resolveDone!: (outcome: TranslationOutcome) => void;
  const done = new Promise<TranslationOutcome>((resolve) => {
    resolveDone = resolve;
  });

  let finished = false;
  let aborted = false;
  let jobId: string | null = null;
  let sourceLang = '';
  let total = 0;
  let units: Unit[] = [];
  let timer: unknown = null;
  const applied = new Set<Unit>();
  const pending: Unit[] = [];
  const translations = new Map<number, string>();
  const completed = new Set<Unit>();
  const unitOfSegment = new Map<number, Unit>();
  const remaining = new Map<Unit, number>();
  let writeChain: Promise<void> = Promise.resolve();

  /** 进度回调出错不影响翻译本身。 */
  const reportProgress = (done: number, totalUnits: number): void => {
    try {
      deps.onProgress?.(done, totalUnits);
    } catch (err) {
      console.debug('[Alayo Get] 翻译进度回调出错', err);
    }
  };

  const finish = (outcome: TranslationOutcome): void => {
    if (finished) return;
    finished = true;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    resolveDone(outcome);
  };

  const cancelJob = (): void => {
    if (jobId === null) return;
    try {
      deps.translator.cancel(jobId);
    } catch (err) {
      console.debug('[Alayo Get] 取消翻译任务失败', err);
    }
  };

  const abort = (reason: string, err?: unknown): void => {
    if (aborted || finished) return;
    aborted = true;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    cancelJob();
    console.warn('[Alayo Get] 后台翻译中止：' + reason, err ?? '');
    finish({ status: 'aborted', reason, applied: applied.size, total, source: sourceLang || undefined });
  };

  const enqueue = (task: () => Promise<void>): void => {
    writeChain = writeChain.then(async () => {
      if (aborted || finished) return;
      try {
        await task();
      } catch (err) {
        abort('write-failed', err);
      }
    });
  };

  const locate = async (): Promise<Located> => {
    let entry;
    try {
      entry = await deps.index.get(request.source);
    } catch (err) {
      return { reason: 'record-missing', err };
    }
    if (!entry || entry.id !== request.id) return { reason: 'record-missing' };
    let md: string;
    try {
      md = await deps.library.readText(entry.file);
    } catch (err) {
      return { reason: 'file-missing', err };
    }
    if (frontmatterId(md) !== request.id) return { reason: 'id-mismatch' };
    return { file: entry.file, md };
  };

  const translationsFor = (unit: Unit): string[] => unit.segmentIndexes.map((index) => translations.get(index) ?? '');

  const itemsFor = (batch: Unit[]) =>
    batch.map((unit) => ({ unit, lines: renderTranslation(unit, translationsFor(unit), target) }));

  /** onSource 后的落盘标记：已开始、未完成。 */
  const writePartial = async (): Promise<void> => {
    await deps.lock(async () => {
      if (aborted || finished) return;
      const located = await locate();
      if ('reason' in located) {
        abort(located.reason, located.err);
        return;
      }
      const md = setTranslationFields(located.md, { lang: sourceLang, translated_to: target, translation: 'partial' });
      if (md !== located.md) await deps.library.write(located.file, md);
    });
  };

  /** 一次中间写回：只插入这一批新完成的单元，状态写 partial。 */
  const applyBatch = async (batch: Unit[]): Promise<void> => {
    await deps.lock(async () => {
      if (aborted || finished) return;
      const located = await locate();
      if ('reason' in located) {
        abort(located.reason, located.err);
        return;
      }
      const result = applyTranslations(located.md, itemsFor(batch), request.medium);
      const present = new Set(result.alreadyPresent);
      const candidates = result.applied.filter((unit) => !applied.has(unit) && !present.has(unit));
      const md = setTranslationFields(result.md, { lang: sourceLang, translated_to: target, translation: 'partial' });
      // 写成功（或确实不需要写）之后才算这些单元完成；写失败时 abort 的 applied 不含它们。
      if (md !== located.md) await deps.library.write(located.file, md);
      for (const unit of candidates) applied.add(unit);
    });
  };

  const armTimer = (): void => {
    if (timer !== null || aborted || finished) return;
    timer = setTimer(() => {
      timer = null;
      if (aborted || finished) return;
      const batch = pending.splice(0);
      if (batch.length === 0) return;
      enqueue(async () => {
        await applyBatch(batch);
        if (pending.length > 0 && !aborted && !finished) armTimer();
      });
    }, FLUSH_MS);
  };

  const onSource = (source: string): void => {
    if (aborted || finished || sourceLang !== '') return;
    sourceLang = toApiTag(source);
    // 同语言不写任何字段（理论上与最终 skipped 同时发生；两边都用 sameLanguage）。
    if (sameLanguage(sourceLang, target)) return;
    enqueue(writePartial);
  };

  const onSegment = (index: number, text: string): void => {
    if (aborted || finished) return;
    const unit = unitOfSegment.get(index);
    if (!unit || completed.has(unit)) return;
    translations.set(index, text);
    const left = (remaining.get(unit) ?? 1) - 1;
    remaining.set(unit, left);
    if (left !== 0) return;
    completed.add(unit);
    pending.push(unit);
    armTimer();
    reportProgress(completed.size, total);
  };

  /** 最后一次写回：插入剩下已完成的单元，并定 complete / partial / failed。 */
  const finalize = async (result: TranslateResult): Promise<void> => {
    if (aborted || finished) return;
    const batch = pending.splice(0);
    let status: 'complete' | 'partial' | 'failed' = 'failed';
    let outcomeSource = sourceLang;
    if (outcomeSource === '' && result.source !== undefined) outcomeSource = toApiTag(result.source);

    await deps.lock(async () => {
      if (aborted || finished) return;
      const located = await locate();
      if ('reason' in located) {
        abort(located.reason, located.err);
        return;
      }
      if (result.status === 'skipped') {
        const md = removeTranslationFields(located.md);
        if (md !== located.md) await deps.library.write(located.file, md);
        return;
      }
      let md = located.md;
      let candidates: Unit[] = [];
      if (batch.length > 0) {
        const inserted = applyTranslations(md, itemsFor(batch), request.medium);
        const present = new Set(inserted.alreadyPresent);
        candidates = inserted.applied.filter((unit) => !applied.has(unit) && !present.has(unit));
        md = inserted.md;
      }
      const appliedCount = applied.size + candidates.length;
      status = appliedCount >= total ? 'complete' : appliedCount > 0 ? 'partial' : 'failed';
      const next = setTranslationFields(md, { lang: outcomeSource, translated_to: target, translation: status });
      // 写成功（或确实不需要写）之后才把这些单元并入 applied；写失败时 abort 的 applied 不含它们。
      if (next !== located.md) await deps.library.write(located.file, next);
      for (const unit of candidates) applied.add(unit);
    });

    if (aborted || finished) return;
    if (result.status === 'skipped') {
      finish({ status: 'skipped', applied: 0, total, source: outcomeSource || undefined });
      return;
    }
    const outcome: TranslationOutcome = { status, applied: applied.size, total, source: outcomeSource || undefined };
    if (result.status === 'failed') outcome.error = result.error;
    finish(outcome);
  };

  const run = async (): Promise<void> => {
    const init: { plan: BilingualPlan } | { reason: string; err?: unknown } | { alreadyTranslated: true } = await deps.lock(async () => {
      const located = await locate();
      if ('reason' in located) return { reason: located.reason, err: located.err };
      // 已经有完整或部分译文：不翻、不写（failed 意味着正文没被改过，照常翻）。
      const state = translationStateOf(located.md);
      if (state === 'complete' || state === 'partial') return { alreadyTranslated: true };
      return { plan: planBilingual(located.md, request.medium) };
    });
    if ('reason' in init) {
      abort(init.reason, init.err);
      return;
    }
    if ('alreadyTranslated' in init) {
      finish({ status: 'aborted', reason: 'already-translated', applied: 0, total: 0 });
      return;
    }

    units = init.plan.units;
    total = units.length;
    reportProgress(0, total);
    if (total === 0 || init.plan.segments.length === 0) {
      finish({ status: 'skipped', applied: 0, total });
      return;
    }
    for (const unit of units) {
      remaining.set(unit, unit.segmentIndexes.length);
      for (const index of unit.segmentIndexes) unitOfSegment.set(index, unit);
    }

    let job: ReturnType<TranslationService['translate']> | null = null;
    let result: TranslateResult | null = null;
    try {
      job = deps.translator.translate({ segments: init.plan.segments, target }, { onSource, onSegment });
    } catch (err) {
      result = { status: 'failed', error: { code: 'engine-failed', message: messageOf(err) }, done: 0 };
    }
    if (job !== null) {
      jobId = job.id;
      if (aborted) {
        cancelJob();
        return;
      }
      try {
        result = await job.result;
      } catch (err) {
        result = { status: 'failed', error: { code: 'engine-failed', message: messageOf(err) }, done: 0 };
      }
    }
    if (result === null) result = { status: 'failed', error: { code: 'engine-failed', message: 'translate() threw' }, done: 0 };

    if (aborted || finished) return;
    // 翻译已经结束：先撤掉计时器，再把已排队的 onSource / 中间写回全部落盘（包括刚排进来的）。
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    let draining: Promise<void>;
    do {
      draining = writeChain;
      await draining;
    } while (draining !== writeChain);
    if (aborted || finished) return;
    await finalize(result);
  };

  void run().catch((err) => {
    abort('write-failed', err);
  });

  return { done };
}
