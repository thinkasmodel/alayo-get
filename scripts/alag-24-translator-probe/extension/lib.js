// 各上下文共用的探测函数（页面、offscreen、内容脚本、worker 都以经典脚本加载）。
(() => {
  const errOf = (e) => ({ name: e && e.name, message: String((e && e.message) || e) });
  const now = () => performance.now();
  const translators = new Map();
  const probe = {
    env() {
      const ua = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;
      return {
        href: String(self.location && self.location.href).slice(0, 100),
        hasTranslator: typeof self.Translator !== 'undefined',
        hasLanguageDetector: typeof self.LanguageDetector !== 'undefined',
        userActivation: ua ? { isActive: ua.isActive, hasBeenActive: ua.hasBeenActive } : null,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      };
    },
    async availability(pairs) {
      const out = {};
      for (const [s, t] of pairs) {
        try { out[`${s}>${t}`] = await Translator.availability({ sourceLanguage: s, targetLanguage: t }); }
        catch (e) { out[`${s}>${t}`] = { error: errOf(e) }; }
      }
      try { out.detector = await LanguageDetector.availability(); } catch (e) { out.detector = { error: errOf(e) }; }
      return out;
    },
    async create(s, t, timeoutMs = 900000) {
      const key = `${s}>${t}`;
      const progress = [];
      const env = probe.env();
      const t0 = now();
      let before;
      try { before = await Translator.availability({ sourceLanguage: s, targetLanguage: t }); } catch (e) { before = { error: errOf(e) }; }
      try {
        const p = Translator.create({
          sourceLanguage: s, targetLanguage: t,
          monitor(m) { m.addEventListener('downloadprogress', (ev) => progress.push({ ms: Math.round(now() - t0), loaded: ev.loaded })); },
        });
        const tr = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + timeoutMs)), timeoutMs))]);
        translators.set(key, tr);
        return { ok: true, pair: key, before, ms: Math.round(now() - t0), progressEvents: progress.length, progress: progress.slice(0, 3).concat(progress.slice(-2)), inputQuota: tr.inputQuota, userActivationAtCall: env.userActivation };
      } catch (e) {
        return { ok: false, pair: key, before, ms: Math.round(now() - t0), error: errOf(e), progressEvents: progress.length, userActivationAtCall: env.userActivation };
      }
    },
    async translate(s, t, text) {
      const key = `${s}>${t}`;
      let tr = translators.get(key);
      const r = { pair: key };
      if (!tr) { const c = await probe.create(s, t, 60000); r.create = c; if (!c.ok) return r; tr = translators.get(key); }
      const t0 = now();
      try { r.output = await tr.translate(text); r.ok = true; } catch (e) { r.ok = false; r.error = errOf(e); }
      r.ms = Math.round(now() - t0);
      return r;
    },
    async stream(s, t, text) {
      const key = `${s}>${t}`;
      let tr = translators.get(key);
      const r = { pair: key, chunks: [] };
      if (!tr) { const c = await probe.create(s, t, 60000); r.create = c; if (!c.ok) return r; tr = translators.get(key); }
      const t0 = now();
      try {
        let all = '';
        for await (const chunk of tr.translateStreaming(text)) { r.chunks.push({ ms: Math.round(now() - t0), len: chunk.length }); all += chunk; }
        r.ok = true; r.output = all.slice(0, 300);
      } catch (e) { r.ok = false; r.error = errOf(e); }
      r.ms = Math.round(now() - t0);
      return r;
    },
    async long(s, t, paragraphs) {
      const key = `${s}>${t}`;
      let tr = translators.get(key);
      const r = { pair: key, n: paragraphs.length, inputChars: paragraphs.join('').length, perChunk: [], failures: [] };
      if (!tr) { const c = await probe.create(s, t, 60000); r.create = c; if (!c.ok) return r; tr = translators.get(key); }
      const t0 = now();
      let outChars = 0;
      for (let i = 0; i < paragraphs.length; i++) {
        const c0 = now();
        try { const o = await tr.translate(paragraphs[i]); outChars += o.length; if (i < 2) r['sample' + i] = o.slice(0, 200); }
        catch (e) { r.failures.push({ i, error: errOf(e) }); }
        r.perChunk.push(Math.round(now() - c0));
      }
      r.totalMs = Math.round(now() - t0);
      r.outputChars = outChars;
      const sorted = [...r.perChunk].sort((a, b) => a - b);
      r.chunkMs = { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] };
      return r;
    },
    async detect(text) {
      const t0 = now();
      try {
        const d = await LanguageDetector.create();
        const res = await d.detect(text);
        return { ok: true, ms: Math.round(now() - t0), top: res.slice(0, 3) };
      } catch (e) { return { ok: false, ms: Math.round(now() - t0), error: errOf(e) }; }
    },
  };
  self.probe = probe;
})();
