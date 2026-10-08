/* eslint-disable @typescript-eslint/no-explicit-any -- 参考实现原样采用（brief ALAG-3 决策 3），不改函数体 */
// src/page/x/annotate.ts —— 只能通过 executeScript({world:'MAIN', func}) 运行，必须自包含
// 主世界标注器：收到 alayo-get:annotate-x 时，从 React fiber 的帖子对象里读出原帖地址、t.co 映射和视频时长，
// 写成每个 article 的 data-alayo-x 属性（ADR-0003 修订）。executeScript 只序列化函数本身，函数体不能引用外部标识符。
export function installXAnnotator(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__alayoGetXAnnotator) return;
  w.__alayoGetXAnnotator = true;
  document.addEventListener('alayo-get:annotate-x', () => {
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      const el = a as unknown as Record<string, unknown>;
      const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      let f = (fk ? el[fk] : null) as { memoizedProps?: { tweet?: Record<string, any> }; return?: unknown } | null;
      let t: Record<string, any> | null = null;
      for (let i = 0; f && i < 60; i++, f = f.return as typeof f) {
        const tw = f.memoizedProps?.tweet;
        if (tw && typeof tw.id_str === 'string') { t = tw; break; }
      }
      if (!t) continue;
      const tco: Record<string, string> = {};
      const addUrls = (list: any) => { for (const u of list ?? []) if (u && u.url && u.expanded_url) tco[u.url] = u.expanded_url; };
      for (const tw of [t, t.quoted_status]) {
        if (!tw) continue;
        addUrls(tw.entities?.urls);
        addUrls(tw.note_tweet?.note_tweet_results?.result?.entity_set?.urls);
      }
      const videos: { type: string; durationMs: number | null }[] = [];
      for (const m of t.extended_entities?.media ?? []) {
        if (m.type === 'video' || m.type === 'animated_gif') videos.push({ type: m.type, durationMs: m.video_info?.duration_millis ?? null });
      }
      a.setAttribute('data-alayo-x', JSON.stringify({ id: t.id_str, quote: t.quoted_status_permalink?.expanded ?? '', tco, videos }));
    }
  });
}
