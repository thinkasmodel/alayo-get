/* global chrome */
// service worker：记录自身环境，转发命令给 offscreen 文档，汇总各上下文的报告。
self.results = {};
self.results['sw:env'] = { hasTranslator: typeof self.Translator !== 'undefined', hasLanguageDetector: typeof self.LanguageDetector !== 'undefined' };

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'report') self.results[msg.id] = { at: new Date().toISOString(), from: sender.url && sender.url.slice(0, 100), data: msg.data };
});

const OFFSCREEN_REASONS = ['DOM_PARSER'];
self.offscreenReasons = OFFSCREEN_REASONS;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: OFFSCREEN_REASONS, justification: 'ALAG-24 probe: run on-device Translator API in the background' });
}

// 运行器在 SW 里调用：runOffscreen(id, cmd, args)，结果以 results[id] 回来。
self.runOffscreen = async (id, cmd, args) => {
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ target: 'offscreen', id, cmd, args });
  return 'sent';
};
self.closeOffscreen = async () => { if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); return 'closed'; };

const step = async (out, name, p) => {
  const t0 = Date.now();
  out.steps = out.steps || [];
  try {
    const v = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 20s')), 20000))]);
    out.steps.push({ name, ok: true, ms: Date.now() - t0 });
    return v;
  } catch (e) { out.steps.push({ name, ok: false, ms: Date.now() - t0, error: { name: e.name, message: e.message } }); throw e; }
};

// service worker 里直接试 create + translate（文档说 Worker 不可用，首轮却发现 Translator 存在）。
self.swTranslate = async (s, t, text) => {
  const out = { hasTranslator: typeof self.Translator !== 'undefined' };
  if (!out.hasTranslator) return out;
  try {
    out.availability = await step(out, 'availability', self.Translator.availability({ sourceLanguage: s, targetLanguage: t }));
    const tr = await step(out, 'create', self.Translator.create({ sourceLanguage: s, targetLanguage: t }));
    out.output = await step(out, 'translate', tr.translate(text));
    out.ok = true;
  } catch (e) { out.ok = false; out.error = { name: e.name, message: e.message }; }
  return out;
};
