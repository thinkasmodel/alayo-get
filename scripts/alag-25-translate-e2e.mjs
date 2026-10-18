// ALAG-25 编排者真机验收：加载构建产物（.output/chrome-mv3），选项页上真实点击下载 en↔zh 语言包与语言检测模型，
// 再从 SW 里按 chromeTranslateClientDeps 的同样参数建 offscreen 文档、连 'translate' Port，跑完整/检测/跳过/取消/长段/未下载六类任务。
// 用法：npx wxt build && node scripts/alag-25-translate-e2e.mjs --ext .output/chrome-mv3 --profile <新的空目录> --out <输出目录>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const EXT = path.resolve(argv.ext);
const PROFILE = path.resolve(argv.profile);
const OUT = path.resolve(argv.out);
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'e2e.log');
const log = (...a) => { const l = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, [`--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--window-size=1100,800'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const pipeIn = proc.stdio[3];
let nextId = 1; const pending = new Map(); let buf = Buffer.alloc(0);
proc.stdio[4].on('data', (d) => {
  buf = Buffer.concat([buf, d]); let i;
  while ((i = buf.indexOf(0)) >= 0) {
    const msg = JSON.parse(buf.subarray(0, i).toString('utf8')); buf = buf.subarray(i + 1);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result); }
  }
});
const send = (method, params = {}, sessionId, timeoutMs = 120000) => new Promise((resolve, reject) => {
  const id = nextId++;
  const t = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
  pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
  pipeIn.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
proc.once('exit', () => { for (const p of pending.values()) p.reject(new Error('Chrome exited')); pending.clear(); });
const evaluate = async (sid, expression, timeoutMs) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: false }, sid, timeoutMs);
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
};
const attach = async (targetId) => (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
async function waitTarget(pred, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const { targetInfos } = await send('Target.getTargets'); const t = targetInfos.find(pred); if (t) return t; await sleep(300); }
  throw new Error('target not found');
}

// SW 里执行：与 chromeTranslateClientDeps 相同的建文档参数，Port 握手（ack 前断开就重连），然后跑一个任务、收集全部消息。
const swJob = (request, { cancelAfterSegments } = {}) => `(async () => {
  const has = (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
  if (!has) await chrome.offscreen.createDocument({ url: chrome.runtime.getURL('/offscreen.html'), reasons: ['DOM_PARSER'], justification: 'e2e' });
  let port; let attempts = 0;
  for (; attempts < 50; attempts++) {
    port = chrome.runtime.connect({ name: 'translate' });
    const ok = await new Promise((res) => {
      const t = setTimeout(() => res(false), 2000);
      port.onDisconnect.addListener(() => { clearTimeout(t); res(false); });
      port.onMessage.addListener((m) => { if (m.type === 'hello-ack') { clearTimeout(t); res(true); } });
      port.postMessage({ type: 'hello' });
    });
    if (ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const msgs = []; const t0 = Date.now();
  const result = await new Promise((res) => {
    let segs = 0;
    port.onMessage.addListener((m) => {
      if (m.type === 'hello-ack') return;
      msgs.push({ ...m, ms: Date.now() - t0 });
      if (m.type === 'segment' && ${JSON.stringify(cancelAfterSegments ?? -1)} >= 0 && ++segs === ${JSON.stringify(cancelAfterSegments ?? -1)}) port.postMessage({ type: 'cancel', jobId: 'j1' });
      if (m.type === 'result') res(m.result);
    });
    port.onDisconnect.addListener(() => res({ disconnected: true }));
    port.postMessage({ type: 'translate', jobId: 'j1', request: ${JSON.stringify(request)} });
  });
  port.disconnect();
  return { attempts: attempts + 1, result, msgs: msgs.map((m) => m.type === 'segment' ? { type: m.type, index: m.index, text: m.text.slice(0, 80), ms: m.ms } : m) };
})()`;

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 600) : ''); };

try {
  log('chrome', (await send('Browser.getVersion')).product);
  const { id: extId } = await send('Extensions.loadUnpacked', { path: EXT });
  log('ext', extId);
  const sw = await waitTarget((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
  const swSid = await attach(sw.targetId);
  const manifest = await evaluate(swSid, 'chrome.runtime.getManifest()');
  check('manifest 有 offscreen 权限、无 minimum_chrome_version', manifest.permissions.includes('offscreen') && !manifest.minimum_chrome_version);

  // 下载前：offscreen 里 en>zh 不可用 → needs-download
  const pre = await evaluate(swSid, swJob({ segments: ['Hello world.'], source: 'en', target: 'zh' }), 60000);
  check('下载前 → needs-download translator', pre.result.status === 'failed' && pre.result.error?.code === 'needs-download' && pre.result.error.model?.kind === 'translator', pre);

  // 选项页里注入一个按钮，真实点击后下载 en>zh、zh>en、语言检测模型（扩展页面＋手势，正是 ALAG-27 要走的路）。
  // 每个模型单独点一次：同一次点击里并发 create en>zh 与 zh>en（共用一个语言包）时，后者报 NotAllowedError；
  // 一次点击里「一个语言对＋检测模型」并发或先后 create 都能成功（2026-10-18 实测）。
  const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options.html` });
  const opt = await attach(targetId); await sleep(1500);
  await evaluate(opt, `(() => { window.dl = {}; const mk = { 'en>zh': () => Translator.create({ sourceLanguage: 'en', targetLanguage: 'zh' }), 'zh>en': () => Translator.create({ sourceLanguage: 'zh', targetLanguage: 'en' }), detector: () => LanguageDetector.create() };
    const b = document.createElement('button'); b.id = 'dl'; b.textContent = 'DL'; b.style.cssText = 'position:fixed;left:20px;top:20px;width:120px;height:60px;z-index:99999';
    b.onclick = () => { const k = window.next; window.dl[k] = mk[k]().then(() => 'ok', (e) => e.name + ': ' + e.message); };
    document.body.appendChild(b); })()`);
  await send('Target.activateTarget', { targetId }); await send('Page.bringToFront', {}, opt);
  const dlr = {};
  for (const k of ['en>zh', 'zh>en', 'detector']) {
    await evaluate(opt, `window.next = ${JSON.stringify(k)}`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 80, y: 50, button: 'left', clickCount: 1 }, opt);
    dlr[k] = await evaluate(opt, `window.dl[${JSON.stringify(k)}]`, 300000);
    log('download', k, dlr[k]);
  }
  const dl = Object.values(dlr).every((v) => v === 'ok') ? 'ok' : dlr;
  check('选项页点击下载 en↔zh＋检测模型', dl === 'ok', dl);

  const full = await evaluate(swSid, swJob({ segments: ['The library opens at nine in the morning.', '   ', 'The reading room closes an hour before midnight.'], source: 'en-US', target: 'zh-CN' }), 120000);
  const segs = full.msgs.filter((m) => m.type === 'segment');
  check('完整翻译：source=en、3 段按下标、空白段原样、complete', full.result.status === 'complete' && full.result.source === 'en' && full.msgs.some((m) => m.type === 'source' && m.source === 'en') && segs.map((s) => s.index).join() === '0,1,2' && segs[1].text === '   ' && /[一-鿿]/.test(segs[0].text), full);

  const det = await evaluate(swSid, swJob({ segments: ['Reading is to the mind what exercise is to the body, and a good library is the gymnasium of a free people.'], target: 'zh' }), 120000);
  check('不传 source → 检测为 en 并翻译', det.result.status === 'complete' && det.result.source === 'en', det);

  const zh = await evaluate(swSid, swJob({ segments: ['图书馆早上九点开门，阅览室在午夜前一个小时关闭。'], target: 'en' }), 120000);
  check('中文检测为 zh 并译成英文', zh.result.status === 'complete' && zh.result.source === 'zh' && /library/i.test(zh.msgs.find((m) => m.type === 'segment')?.text || ''), zh);

  const same = await evaluate(swSid, swJob({ segments: ['This is already English, so nothing should be translated here.'], target: 'en-GB' }), 120000);
  check('同语言 → skipped，无 segment', same.result.status === 'skipped' && !same.msgs.some((m) => m.type === 'segment'), same);

  const many = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: the quiet reading room fills slowly as the morning light moves across the long wooden tables.`);
  const can = await evaluate(swSid, swJob({ segments: many, source: 'en', target: 'zh' }, { cancelAfterSegments: 3 }), 120000);
  check('进行中取消 → cancelled，done < 60', can.result.status === 'cancelled' && can.result.done >= 3 && can.result.done < 60, { result: can.result, segs: can.msgs.filter((m) => m.type === 'segment').length });

  const longPara = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} describes the library in some detail.`).join(' ');
  const lp = await evaluate(swSid, swJob({ segments: [longPara], source: 'en', target: 'zh' }), 120000);
  check(`超长段（${longPara.length} 字符）切块翻译后拼成一段`, lp.result.status === 'complete' && lp.msgs.filter((m) => m.type === 'segment').length === 1, lp.result);

  const fr = await evaluate(swSid, swJob({ segments: ['Bonjour.'], source: 'fr', target: 'zh' }), 60000);
  check('未下载的语言对 fr>zh → needs-download', fr.result.status === 'failed' && fr.result.error?.code === 'needs-download', fr.result);

  const ctx = await evaluate(swSid, `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length)`);
  check('全程只有一个 offscreen 文档', ctx === 1, ctx);
} catch (e) {
  log('FATAL', e.stack || e.message);
  checks.push({ name: 'fatal', ok: false });
} finally {
  fs.writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(checks, null, 2));
  log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
  try { await send('Browser.close', {}, undefined, 5000); } catch { /* ignore */ }
  await sleep(1000); proc.kill('SIGKILL'); process.exit(checks.every((c) => c.ok) ? 0 : 1);
}
