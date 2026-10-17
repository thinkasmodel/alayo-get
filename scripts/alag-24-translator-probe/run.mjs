// ALAG-24 实测运行器：用独立 profile 启动本机 Chrome 稳定版，经 --remote-debugging-pipe 走 CDP，
// 用 Extensions.loadUnpacked 装探针扩展，按阶段跑各项探测，结果写成 JSON，全程记 netlog。
//
// 用法：
//   node scripts/alag-24-translator-probe/run.mjs --mode online  --profile <dir> --out <dir> --texts <dir>
//   node scripts/alag-24-translator-probe/run.mjs --mode offline --profile <同一 dir> --out <dir> --texts <dir>
// offline 模式用不可达代理（127.0.0.1:9）挡住所有外网请求，回环地址照常直连。
// 所有 Runtime.evaluate 都显式传 userGesture:false，只有「点击」一步用 Input.dispatchMouseEvent 产生真实手势。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(HERE, 'extension');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const MODE = argv.mode || 'online';
const PROFILE = path.resolve(argv.profile);
const OUT = path.resolve(argv.out);
const TEXTS = path.resolve(argv.texts);
fs.mkdirSync(OUT, { recursive: true });

const PROGRESS = path.join(OUT, `progress-${MODE}.log`);
const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(line); fs.appendFileSync(PROGRESS, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, sleep(ms).then(() => ({ runnerTimeout: true, what, ms }))]);
const marks = [];
const mark = (name) => { marks.push({ name, iso: new Date().toISOString(), epochMs: Date.now() }); log('MARK', name); };

const SAMPLES = {
  en: 'The library opens at nine in the morning, and the reading room closes an hour before midnight.',
  zh: '图书馆早上九点开门，阅览室在午夜前一个小时关闭。',
  'zh-Hant': '圖書館早上九點開門，閱覽室在午夜前一個小時關閉。',
  ja: '図書館は朝九時に開館し、閲覧室は午前零時の一時間前に閉まります。',
  ko: '도서관은 아침 아홉 시에 문을 열고, 열람실은 자정 한 시간 전에 닫습니다.',
  fr: 'La bibliothèque ouvre à neuf heures du matin et la salle de lecture ferme une heure avant minuit.',
  de: 'Die Bibliothek öffnet um neun Uhr morgens, und der Lesesaal schließt eine Stunde vor Mitternacht.',
  es: 'La biblioteca abre a las nueve de la mañana y la sala de lectura cierra una hora antes de la medianoche.',
};
const P = (s) => s.split(' ').map((x) => x.split('>'));
const ALL_PAIRS = P('en>zh zh>en en>zh-Hans zh-Hans>en en>zh-CN en>zh-Hant zh-Hant>en en>ja ja>en en>ko ko>en en>fr fr>en en>de de>en en>es es>en zh>ja ja>zh zh>ko ko>zh zh-Hant>ja ja>zh-Hant zh>zh-Hant fr>de');
// 下载顺序：先装 en↔zh、en↔ja、en↔ko，再看 zh↔ja 是否已可用（判断是否经英文中转），最后才单独下 zh↔ja / zh↔ko。
// 首轮实测 zh-Hans 在 availability() 里报 downloadable、create() 却报 NotSupportedError，所以主力用 zh，zh-Hans 在 zh 装好后再试一次。
// --first 可改下载顺序（用来区分「zh 有问题」和「全新 profile 第一次 create 失败」）。
const DOWNLOAD_FIRST = P(argv.first || 'en>zh zh>en en>ja ja>en en>ko ko>en');
const RETRY_HANS = P('en>zh-Hans zh-Hans>en en>zh-CN');
const PIVOT_CHECK = P('zh>ja ja>zh zh>ko ko>zh zh-Hant>ja');
const DOWNLOAD_REST = P('en>zh-Hant zh-Hant>en en>fr fr>en en>de de>en en>es es>en zh>ja ja>zh zh>ko ko>zh');

// ---------- 本地测试页（内容脚本用） ----------
const server = http.createServer((req, res) => {
  const headers = { 'Content-Type': 'text/html; charset=utf-8' };
  if (req.url.startsWith('/blocked')) headers['Permissions-Policy'] = 'translator=(), language-detector=()';
  res.writeHead(200, headers);
  res.end(`<!doctype html><meta charset="utf-8"><title>${req.url}</title><p>ALAG-24 content-script page ${req.url}</p>`);
});
await new Promise((r) => server.listen(8766, '127.0.0.1', r));

// ---------- 启动 Chrome ----------
const flags = [
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  `--log-net-log=${path.join(OUT, `netlog-${MODE}.json`)}`, '--net-log-capture-mode=Default',
  '--window-size=1100,800',
];
if (MODE === 'offline') flags.push('--proxy-server=http://127.0.0.1:9');
const proc = spawn(CHROME, flags, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
proc.stdio[2].on('data', (d) => fs.appendFileSync(path.join(OUT, `chrome-stderr-${MODE}.log`), d));
const pipeIn = proc.stdio[3];
const pipeOut = proc.stdio[4];
let nextId = 1;
const pending = new Map();
const listeners = [];
let buf = Buffer.alloc(0);
pipeOut.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  let i;
  while ((i = buf.indexOf(0)) >= 0) {
    const msg = JSON.parse(buf.subarray(0, i).toString('utf8'));
    buf = buf.subarray(i + 1);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data || ''}`));
      else resolve(msg.result);
    } else listeners.forEach((fn) => fn(msg));
  }
});
// 每条 CDP 命令都有截止时间；Chrome 退出时让所有在途命令立即失败，避免扩展失去响应时运行器永远挂住。
const send = (method, params = {}, sessionId, timeoutMs = 60000) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${timeoutMs}ms: ${method}`)); }, timeoutMs);
  pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  pipeIn.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
proc.once('exit', () => { for (const { reject } of pending.values()) reject(new Error('Chrome exited')); pending.clear(); });
const evaluate = async (sid, expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: false }, sid);
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};

const results = { mode: MODE, marks, chrome: null, extId: null, swResults: null, snapshots: {} };
const save = () => fs.writeFileSync(path.join(OUT, `results-${MODE}.json`), JSON.stringify(results, null, 2));
// 每个阶段结束时把 SW 汇总的结果一并落盘（首轮发现后面的步骤可能卡住整个扩展进程）。
const snap = async () => { const r = await withTimeout(swResults(), 15000, 'swResults'); if (!r.runnerTimeout) results.swResults = r; save(); };

async function attach(targetId) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return sessionId;
}
async function waitTarget(pred, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { targetInfos } = await send('Target.getTargets');
    const t = targetInfos.find(pred);
    if (t) return t;
    await sleep(300);
  }
  throw new Error('target not found');
}

let swSid;
const swResults = async () => JSON.parse(await evaluate(swSid, 'JSON.stringify(self.results)'));
async function waitResult(id, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await evaluate(swSid, `JSON.stringify(self.results[${JSON.stringify(id)}] || null)`);
    if (r !== 'null') return JSON.parse(r);
    await sleep(500);
  }
  return { timeout: true, id };
}
async function off(id, cmd, args = {}, timeoutMs = 120000) {
  await evaluate(swSid, `runOffscreen(${JSON.stringify(id)}, ${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
  const r = await waitResult(id, timeoutMs);
  log('off', id, JSON.stringify(r).slice(0, 300));
  return r;
}
async function openPage(url) {
  const { targetId } = await send('Target.createTarget', { url });
  const sid = await attach(targetId);
  await sleep(1500);
  return { targetId, sid };
}
async function click(page, selector) {
  await send('Target.activateTarget', { targetId: page.targetId });
  await send('Page.bringToFront', {}, page.sid);
  const rect = await evaluate(page.sid, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, page.sid);
  }
}
async function pageText(url) {
  const page = await openPage(url);
  await sleep(2500);
  const text = await evaluate(page.sid, 'document.body ? document.body.innerText : ""');
  await send('Target.closeTarget', { targetId: page.targetId });
  return text;
}
const availOf = async (pairs, id) => (await off(id, 'availability', { pairs })).data;

try {
  results.chrome = await send('Browser.getVersion');
  log('chrome', JSON.stringify(results.chrome));
  const { id: extId } = await send('Extensions.loadUnpacked', { path: EXT });
  results.extId = extId;
  log('extension loaded', extId);
  const sw = await waitTarget((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
  swSid = await attach(sw.targetId);
  results.offscreenReasons = await evaluate(swSid, 'self.offscreenReasons');
  mark('start');

  const enParas = fs.readFileSync(path.join(TEXTS, 'en-5000.txt'), 'utf8').split('\n\n');
  const zhParas = fs.readFileSync(path.join(TEXTS, 'zh-5000.txt'), 'utf8').split('\n\n');

  if (MODE === 'online') {
    // A：各上下文是否有 API；下载前的可用性矩阵。
    await off('off:env', 'env');
    await off('off:worker', 'worker');
    await off('off:avail-before', 'availability', { pairs: ALL_PAIRS });
    await snap();
    mark('A-done');

    // B：无手势 create。offscreen 用 en>zh，扩展页面（加载时、无点击）用 en>ja。
    await off('off:nogesture-create:en>zh', 'create', { s: 'en', t: 'zh', timeoutMs: 180000 }, 200000);
    await off('off:nogesture-detector', 'detect', { text: '这是一段用来检测语言的中文句子。' }, 200000);
    const ng = await openPage(`chrome-extension://${extId}/probe.html?tag=pageNG&nogesture=${encodeURIComponent('en>ja')}`);
    log('pageNG', JSON.stringify(await waitResult('pageNG:nogesture-create', 140000)).slice(0, 300));
    await send('Target.closeTarget', { targetId: ng.targetId });
    await snap();
    mark('B-done');

    // C：扩展页面里真实点击后下载（有手势）。
    mark('C-download-start');
    const gp = await openPage(`chrome-extension://${extId}/probe.html?tag=pageG`);
    const gestureCreate = async (key) => {
      await evaluate(gp.sid, `window.pendingPair = ${JSON.stringify(key)}; window.lastId = null;`);
      await click(gp, '#go');
      await sleep(300);
      const id = await evaluate(gp.sid, 'window.lastId');
      if (!id) { log('click did not register for', key); return { clickFailed: true }; }
      const r = await waitResult(id, 15 * 60000);
      log('gesture', key, JSON.stringify(r).slice(0, 300));
      return r;
    };
    const downloadAll = async (pairs) => {
      for (const [s, t] of pairs) {
        const a = await availOf([[s, t]], `off:avail-pre:${s}>${t}`);
        if (a[`${s}>${t}`] === 'available') { log('already available', `${s}>${t}`); continue; }
        const r = await gestureCreate(`${s}>${t}`);
        if (r && r.data && r.data.ok === false) {
          // 失败的隔 10 秒再点一次，看是不是一次性的。
          await sleep(10000);
          await availOf([[s, t]], `off:avail-retry:${s}>${t}`);
          await gestureCreate(`${s}>${t}`);
        }
      }
    };
    await downloadAll(DOWNLOAD_FIRST);
    await availOf(RETRY_HANS, 'off:hans-after-zh');
    for (const [s, t] of RETRY_HANS) await gestureCreate(`${s}>${t}`);
    await availOf(PIVOT_CHECK, 'off:pivot-check');
    await downloadAll(DOWNLOAD_REST);
    const det = await availOf([], 'off:avail-detector');
    if (det.detector !== 'available') await gestureCreate('detector');
    await snap();
    mark('C-download-done');

    // D：模型都在本机后，offscreen（无手势）里的 create / translate / translateStreaming / detect。
    mark('D-translate-start');
    await off('off:avail-after', 'availability', { pairs: ALL_PAIRS });
    for (const [s, t] of ALL_PAIRS) {
      const src = SAMPLES[s] || SAMPLES[s.startsWith('zh') ? 'zh' : 'en'];
      await off(`off:translate:${s}>${t}`, 'translate', { s, t, text: src }, 180000);
    }
    await off('off:stream:en>zh', 'stream', { s: 'en', t: 'zh', text: enParas.slice(0, 12).join('\n\n') }, 600000);
    await off('off:stream:zh>en', 'stream', { s: 'zh', t: 'en', text: zhParas.slice(0, 8).join('\n\n') }, 600000);
    await off('off:detect', 'detect', { text: '这是一段用来检测语言的中文句子。' });
    await snap();
    mark('D-translate-done');

    // E：内容脚本，测试页有无 Permissions-Policy 两种。
    mark('E-cs-start');
    for (const p of ['/plain', '/blocked']) {
      const page = await openPage(`http://127.0.0.1:8766${p}`);
      log('cs', p, JSON.stringify(await waitResult(`cs:${p}`, 120000)).slice(0, 400));
      await send('Target.closeTarget', { targetId: page.targetId });
    }
    await snap();
    mark('E-cs-done');

    // F：长文，各跑两遍。
    mark('F-long-start');
    for (const run of [1, 2]) {
      await off(`off:long:en>zh:run${run}`, 'long', { s: 'en', t: 'zh', paragraphs: enParas }, 60 * 60000);
      await off(`off:long:zh>en:run${run}`, 'long', { s: 'zh', t: 'en', paragraphs: zhParas }, 60 * 60000);
      await snap();
    }
    mark('F-long-done');

  } else {
    // offline：外网全部不可达，只用已下载的模型。
    mark('O-start');
    await off('off:env', 'env');
    await off('off:avail', 'availability', { pairs: ALL_PAIRS });
    for (const [s, t] of P('en>zh zh>en en>ja zh-Hant>en en>fr')) {
      await off(`off:translate:${s}>${t}`, 'translate', { s, t, text: SAMPLES[s] }, 180000);
    }
    await off('off:stream:en>zh', 'stream', { s: 'en', t: 'zh', text: enParas.slice(0, 6).join('\n\n') }, 600000);
    await off('off:detect', 'detect', { text: '这是一段用来检测语言的中文句子。' });
    await off('off:long:en>zh', 'long', { s: 'en', t: 'zh', paragraphs: enParas.slice(0, 30) }, 30 * 60000);
    const page = await openPage('http://127.0.0.1:8766/plain');
    log('cs', JSON.stringify(await waitResult('cs:/plain', 120000)).slice(0, 400));
    await send('Target.closeTarget', { targetId: page.targetId });
    await snap();
    mark('O-done');
  }

  // G：内部页快照。
  for (const u of ['chrome://on-device-translation-internals', 'chrome://components', 'chrome://version']) {
    try { results.snapshots[u] = await pageText(u); } catch (e) { results.snapshots[u] = 'ERR ' + e.message; }
  }

  if (MODE === 'online') {
    // H：Worker 与 service worker 里实际调用（放最后：首轮发现 offscreen 里 Worker 调用后 offscreen 不再响应）。
    mark('H-workers-start');
    results.swTranslate = await withTimeout(evaluate(swSid, `swTranslate('en', 'zh', ${JSON.stringify(SAMPLES.en)})`), 90000, 'sw translate');
    log('sw translate', JSON.stringify(results.swTranslate).slice(0, 400));
    results.workerTranslate = await withTimeout(off('off:worker-translate', 'worker', { s: 'en', t: 'zh', text: SAMPLES.en }, 90000), 120000, 'worker translate');
    log('worker translate', JSON.stringify(results.workerTranslate).slice(0, 400));
    results.offscreenAfterWorker = await withTimeout(off('off:env-after-worker', 'env', {}, 20000), 30000, 'offscreen after worker');
    results.swAliveAfterWorker = await withTimeout(evaluate(swSid, '1 + 1'), 10000, 'sw alive');
    log('after worker: offscreen', JSON.stringify(results.offscreenAfterWorker).slice(0, 200), 'sw', JSON.stringify(results.swAliveAfterWorker));
    save();
    await snap();
    mark('H-workers-done');
  }
  mark('end');
} catch (e) {
  log('FATAL', e.stack || e.message);
  results.fatal = String(e.stack || e.message);
} finally {
  if (!results.swAliveAfterWorker || !results.swAliveAfterWorker.runnerTimeout) await snap().catch((e) => log('snap failed', e.message));
  save();
  await withTimeout(send('Browser.close').catch(() => {}), 10000, 'close');
  await new Promise((r) => { proc.once('exit', r); setTimeout(r, 15000); });
  if (proc.exitCode === null) proc.kill('SIGKILL');
  server.close();
  log('done');
  process.exit(0);
}
