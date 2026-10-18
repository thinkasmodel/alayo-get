// ALAG-40 编排者真机验收：加载构建产物，剪藏库指向扩展自己的 OPFS 目录，真实 Chrome 打开在线页面经 'panel' Port 保存，
// 检查剪藏文件里的表格（GFM 表格＋单行 HTML 表格的数量等于正文表格数），再对两个页面带翻译保存，确认表格行不被翻译、写回前后不变。
// 用法：npx wxt build && node scripts/alag-40-tables-e2e.mjs --ext <构建产物副本> --profile <新的空目录> --out <输出目录> [--only 页面名,页面名]（需要联网）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
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


const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 800) : ''); };
const fmValue = (md, key) => { const m = new RegExp(`^${key}: (.*)$`, 'm').exec(md.split('\n---\n')[0] || ''); return m ? JSON.parse(m[1]) : undefined; };
const cjk = (s) => /[一-鿿]/.test(s);

// 扩展页面里：经 panel Port 保存一个标签页（带 translateTo），收到 saved 后可选地发 draft 并断开（触发写回），返回 clip 与基线。
const panelSave = (tabId, edit) => `(async () => {
  const port = chrome.runtime.connect({ name: 'panel' });
  const states = [];
  const saved = await new Promise((res) => {
    const t = setTimeout(() => res({ timeout: true, states }), 90000);
    port.onMessage.addListener((m) => {
      if (m.type !== 'state') return;
      states.push(m.state.state);
      if (m.state.state === 'saved' || m.state.state === 'failed' || m.state.state === 'fallback' || m.state.state === 'needs-permission') { clearTimeout(t); res({ state: m.state, baseline: m.baseline, states }); }
    });
    port.postMessage({ type: 'start', tabId: ${JSON.stringify(tabId)}, translateTo: 'zh' });
  });
  const edit = ${JSON.stringify(edit ?? null)};
  if (edit && saved.state && saved.state.state === 'saved') {
    const c = saved.state.clip;
    await new Promise((r) => setTimeout(r, edit.delayMs));
    port.postMessage({ type: 'draft', fields: { title: edit.title ?? c.title, tags: edit.tags ?? c.tags, note: edit.note ?? c.note }, baseline: saved.baseline });
    await new Promise((r) => setTimeout(r, 200));
  }
  port.disconnect();
  return saved;
})()`;

// 选项页里读剪藏库（OPFS 下的 library 目录）的文件。
const readLib = (name) => `(async () => { const root = await navigator.storage.getDirectory(); const lib = await root.getDirectoryHandle('library'); try { const f = await (await lib.getFileHandle(${JSON.stringify(name)})).getFile(); return await f.text(); } catch { return null; } })()`;
const listLib = `(async () => { const root = await navigator.storage.getDirectory(); const lib = await root.getDirectoryHandle('library'); const out = []; for await (const [n, h] of lib.entries()) if (h.kind === 'file') out.push(n); return out; })()`;

// 轮询一个剪藏文件直到 translation 进入终态，记下见到的状态序列与第一次读到的内容。
async function watchClip(opt, nameOf, ms) {
  const seen = []; let first = null; let last = null; const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const name = await nameOf();
    const md = name ? await evaluate(opt, readLib(name)) : null;
    if (md !== null) {
      if (first === null) first = md;
      last = md;
      const st = fmValue(md, 'translation') ?? '(none)';
      if (seen[seen.length - 1] !== st) { seen.push(st); log('translation state', st, `${Date.now() - t0}ms`); }
      if (st === 'complete' || st === 'failed') break;
    }
    await sleep(150);
  }
  return { seen, first, last };
}

try {
  log('chrome', (await send('Browser.getVersion')).product);
  const { id: extId } = await send('Extensions.loadUnpacked', { path: EXT });
  log('ext', extId);
  const sw = await waitTarget((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
  const swSid = await attach(sw.targetId);

  const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options.html` });
  const opt = await attach(targetId); await sleep(1500);
  // 剪藏库 = OPFS 下的 library 目录，句柄按 idb-keyval 的默认库（keyval-store / keyval）存到 library-handle。
  const perm = await evaluate(opt, `(async () => {
    const root = await navigator.storage.getDirectory(); const lib = await root.getDirectoryHandle('library', { create: true });
    await new Promise((res, rej) => { const r = indexedDB.open('keyval-store'); r.onupgradeneeded = () => r.result.createObjectStore('keyval');
      r.onsuccess = () => { const tx = r.result.transaction('keyval', 'readwrite'); tx.objectStore('keyval').put(lib, 'library-handle'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); });
    return lib.queryPermission({ mode: 'readwrite' }); })()`);
  check('剪藏库句柄（OPFS）已登记且可写', perm === 'granted', perm);

  // 一次点击下载 en→zh 语言包＋检测模型（ALAG-25 实测：一个语言对＋检测模型可以同一次点击）。
  await evaluate(opt, `(() => { const b = document.createElement('button'); b.style.cssText = 'position:fixed;left:20px;top:20px;width:120px;height:60px;z-index:99999';
    b.onclick = () => { window.dl = Promise.all([Translator.create({ sourceLanguage: 'en', targetLanguage: 'zh' }), LanguageDetector.create()]).then(() => 'ok', (e) => e.name + ': ' + e.message); };
    document.body.appendChild(b); })()`);
  await send('Target.activateTarget', { targetId }); await send('Page.bringToFront', {}, opt);
  // 全新环境里第一次创建翻译器偶发 NotSupportedError（ALAG-24 实测 7 次里 2 次），点击最多重试 3 次。
  let dl;
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 80, y: 50, button: 'left', clickCount: 1 }, opt);
    dl = await evaluate(opt, 'window.dl', 300000);
    if (dl === 'ok' || !String(dl).startsWith('NotSupportedError')) break;
    log('download retry', attempt, dl);
    await sleep(3000);
  }
  check('点击下载 en→zh＋检测模型', dl === 'ok', dl);

  const openTab = async (url) => {
    await send('Target.createTarget', { url });
    await sleep(2500);
    return evaluate(swSid, `chrome.tabs.query({ url: ${JSON.stringify(url)} }).then((t) => t[0]?.id)`);
  };


// ALAG-26 的 panelSave 固定带 translateTo；这里按参数决定带不带。
const panelSaveWith = (tabId, translateTo) => panelSave(tabId).replace("translateTo: 'zh'", translateTo ? `translateTo: ${JSON.stringify(translateTo)}` : '');

// 真实页面与实测时（2026-10-18，真实 Chrome＋Defuddle 0.19.4）正文里的表格数；页面改版会让数字变，FAIL 时先看 detail 里的页面实际情况。
const PAGES = [
  ['wiki-tokyo', 'https://en.wikipedia.org/wiki/Tokyo', 5],
  ['wiki-browsers', 'https://en.wikipedia.org/wiki/Comparison_of_web_browsers', 11],
  ['wiki-markdown', 'https://en.wikipedia.org/wiki/Markdown', 1],
  ['wiki-unixcmds', 'https://en.wikipedia.org/wiki/List_of_POSIX_commands', 1],
  // 页面 13 张表；Defuddle 把脚注 1、2 附近的正文（各含一张表）复制进了脚注区，剪藏里共 15 张（ALAG-40 之前就有的 Defuddle 行为）。
  ['py-stdtypes', 'https://docs.python.org/3/builtins/stdtypes.html', 15],
  ['mdn-table', 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/table', 2],
  ['rust-book', 'https://doc.rust-lang.org/book/appendix-02-operators.html', 10],
  ['sqlite-types', 'https://www.sqlite.org/datatype3.html', 1],
  ['mdn-fsa', 'https://developer.mozilla.org/en-US/docs/Web/API/File_System_API', 1],
];
const TRANSLATE = ['sqlite-types', 'rust-book'];

const bodyOf = (md) => md.split('\n---\n').slice(1).join('\n---\n');
// 表格行可能在引用块（`> `）或列表项（缩进）里：先去掉行首的引用标记与缩进再认。
const unquote = (l) => l.replace(/^(\s*>\s?)+/, '').trimStart();
function tablesIn(md) {
  const L = bodyOf(md).split('\n').map(unquote);
  let gfm = 0, html = 0;
  const bad = [];
  for (let i = 0; i < L.length; i++) {
    if (/^\|( ---+ \|)+\s*$/.test(L[i]) && i > 0 && /^\|.*\|\s*$/.test(L[i - 1])) gfm++;
    if (/^<table[ >]/.test(L[i])) { html++; if (!/<\/table>\s*$/.test(L[i])) bad.push(['HTML 表格没有在同一行结束', i]); }
  }
  return { gfm, html, bad, lines: bodyOf(md).split('\n').filter((l) => /^(\||<table[ >])/.test(unquote(l))) };
}
const ONLY = argv.only ? argv.only.split(',') : null;

  const openTabSlow = async (url) => {
    await send('Target.createTarget', { url });
    await sleep(8000);
    return evaluate(swSid, `chrome.tabs.query({ url: ${JSON.stringify(url)} }).then((t) => t[0]?.id)`);
  };

  // ---- 1. 不翻译：每页的表格都在，GFM＋HTML 数量等于正文表格数 ----
  let gfmTotal = 0, htmlTotal = 0;
  for (const [name, url, expected] of PAGES) {
    if (ONLY && !ONLY.includes(name)) continue;
    const tab = await openTabSlow(url);
    const s = await evaluate(opt, panelSaveWith(tab, null), 120000);
    const file = s.state?.clip?.file;
    const md = file ? (await evaluate(opt, readLib(file))) || '' : '';
    fs.writeFileSync(path.join(OUT, `${name}.md`), md);
    const t = tablesIn(md);
    gfmTotal += t.gfm; htmlTotal += t.html;
    check(`${name}：保存成功，表格 ${expected} 张（GFM ${t.gfm}＋HTML ${t.html}），HTML 表格各占一行`, s.state?.state === 'saved' && t.gfm + t.html === expected && t.bad.length === 0, { tab, last: s.state?.state, error: s.state?.error ?? s.state?.reason, states: [...new Set(s.states ?? [])], gfm: t.gfm, html: t.html, bad: t.bad });
    await evaluate(swSid, `chrome.tabs.remove(${JSON.stringify(tab)})`).catch(() => {});
  }
  log('totals', JSON.stringify({ gfmTotal, htmlTotal }));

  // ---- 2. 带翻译：表格行逐字节不变、不含译文，状态 complete ----
  for (const name of TRANSLATE) {
    if (ONLY && !ONLY.includes(name)) continue;
    // 同一网址第二次保存会走「已剪藏」分支；加一个查询参数让它成为新剪藏。
    const url = `${PAGES.find((p) => p[0] === name)[1]}?alag40=translate`;
    const tab = await openTabSlow(url);
    const s = await evaluate(opt, panelSaveWith(tab, 'zh'), 120000);
    const file = s.state?.clip?.file;
    const w = await watchClip(opt, async () => file, 240000);
    const md = w.last || '';
    fs.writeFileSync(path.join(OUT, `${name}.bilingual.md`), md);
    const before = tablesIn(w.first || ''), after = tablesIn(md);
    const same = before.lines.length > 0 && before.lines.join('\n') === after.lines.join('\n');
    check(`${name}（翻译）：complete，表格行写回前后逐字节相同且无中文`, fmValue(md, 'translation') === 'complete' && same && !after.lines.some(cjk), { tab, last: s.state?.state, seen: w.seen, before: before.lines.length, after: after.lines.length });
    await evaluate(swSid, `chrome.tabs.remove(${JSON.stringify(tab)})`).catch(() => {});
  }
} catch (e) {
  log('FATAL', e.stack || e.message);
  checks.push({ name: 'fatal', ok: false });
} finally {
  fs.writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(checks, null, 2));
  log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
  try { await send('Browser.close', {}, undefined, 5000); } catch { /* ignore */ }
  await sleep(1000); proc.kill('SIGKILL'); process.exit(checks.every((c) => c.ok) ? 0 : 1);
}
