// offscreen 里开的专用 Worker：API 是否存在；收到 {s,t,text} 时再试一次 create + translate。
const step = async (out, name, p) => {
  const t0 = Date.now();
  out.steps = out.steps || [];
  try {
    const v = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 20s')), 20000))]);
    out.steps.push({ name, ok: true, ms: Date.now() - t0 });
    return v;
  } catch (e) { out.steps.push({ name, ok: false, ms: Date.now() - t0, error: { name: e.name, message: e.message } }); throw e; }
};
self.onmessage = async (ev) => {
  const a = ev.data || {};
  const out = { hasTranslator: typeof self.Translator !== 'undefined', hasLanguageDetector: typeof self.LanguageDetector !== 'undefined' };
  if (out.hasTranslator && a.s) {
    try {
      out.availability = await step(out, 'availability', self.Translator.availability({ sourceLanguage: a.s, targetLanguage: a.t }));
      const tr = await step(out, 'create', self.Translator.create({ sourceLanguage: a.s, targetLanguage: a.t }));
      out.output = await step(out, 'translate', tr.translate(a.text));
      out.ok = true;
    } catch (e) { out.ok = false; out.error = { name: e.name, message: e.message }; }
  }
  postMessage(out);
};
