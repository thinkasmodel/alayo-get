// ALAG-27 编排者真机验收：加载构建产物（全新 profile，语言模型未下载），剪藏库指向扩展自己的 OPFS 目录，
// 用 chrome.action.openPopup() 打开真实工具栏面板，在面板里真实点击「翻译」「下载并翻译」，验证 A→C→D→B→E；
// 面板翻译中关掉后页面提示接着显示进度；开了「总是翻译」后工具栏保存自动开始翻译；右键「并翻译」项随设置出现/消失。
// 用法：npx wxt build && node scripts/alag-27-translate-ui-e2e.mjs --ext .output/chrome-mv3 --profile <新的空目录> --out <输出目录>
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

const proc = spawn(CHROME, [`--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--window-size=1100,800', '--lang=zh-CN'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
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

const SHORT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>How Small Libraries Keep Their Catalogs Alive</title></head><body><article>
<h1>How Small Libraries Keep Their Catalogs Alive</h1>
<p>Most small libraries still run on a catalog that was built twenty years ago. It works, but every change takes a volunteer, a spreadsheet, and an afternoon.</p>
<h2>What we changed</h2>
<p>We moved the catalog into plain text files and kept them in a Git repository. Each book is one file, and a nightly job regenerates the website.</p>
<p>The whole migration took three weekends, and nobody had to learn a new tool to keep the shelves in order.</p>
</article></body></html>`;
const TOPICS = ['reading room', 'card catalog', 'returns desk', 'children\'s corner', 'reference shelf', 'map collection', 'study carrel', 'periodicals rack'];
const longPage = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><article><h1>${title}</h1>
${Array.from({ length: 300 }, (_, i) => `<p>In week ${i + 1}, volunteers rearranged the ${TOPICS[i % TOPICS.length]} so that visitors could find what they needed without asking, and they wrote down every change in a shared notebook for the next shift.</p>`).join('\n')}
</article></body></html>`;
const PAGES = { '/short': SHORT, '/long': longPage('A Year at the Eastside Branch'), '/auto': longPage('Notes from the Westside Branch') };
const server = http.createServer((req, res) => {
  const page = PAGES[req.url];
  if (!page) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 800) : ''); };
const fmValue = (md, key) => { const m = new RegExp(`^${key}: (.*)$`, 'm').exec(md.split('\n---\n')[0] || ''); return m ? JSON.parse(m[1]) : undefined; };
const readLib = (name) => `(async () => { const root = await navigator.storage.getDirectory(); const lib = await root.getDirectoryHandle('library'); try { const f = await (await lib.getFileHandle(${JSON.stringify(name)})).getFile(); return await f.text(); } catch { return null; } })()`;
const listLib = `(async () => { const root = await navigator.storage.getDirectory(); const lib = await root.getDirectoryHandle('library'); const out = []; for await (const [n, h] of lib.entries()) if (h.kind === 'file') out.push(n); return out; })()`;

// 面板里的翻译块：kind（data-kind）与文字
const blockState = `(() => { const b = document.querySelector('.tr'); return b ? { kind: b.dataset.kind, text: b.innerText.replace(/\\s+/g, ' ').trim() } : null; })()`;
async function waitBlock(sid, pred, ms, label) {
  const t0 = Date.now(); let last = null; const seen = [];
  while (Date.now() - t0 < ms) {
    try { last = await evaluate(sid, blockState, 5000); } catch { last = null; }
    if (last && seen[seen.length - 1] !== last.kind) { seen.push(last.kind); log(label, 'block', last.kind, last.text.slice(0, 120)); }
    if (last && pred(last)) return { ok: true, last, seen };
    await sleep(150);
  }
  return { ok: false, last, seen };
}
// 真实点击翻译块里的按钮（带用户手势）
async function clickBlockButton(sid) {
  const rect = await evaluate(sid, `(() => { const b = document.querySelector('.tr button:not([disabled])'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.textContent }; })()`);
  if (!rect) return null;
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, sid);
  return rect.label;
}
// 页面里的提示（closed shadow root）：用 DOM.getDocument(pierce) 读出宿主下的全部文字
async function toastText(pageSid) {
  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true }, pageSid);
  let host = null;
  const find = (n) => { if (host) return; if (n.attributes && n.attributes.includes('data-alayo-get-toast')) { host = n; return; } for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) find(c); };
  find(root);
  if (!host) return null;
  const parts = [];
  const walk = (n) => { if (n.nodeType === 3 && n.nodeValue.trim()) parts.push(n.nodeValue.trim()); if (n.nodeName === 'STYLE') return; for (const c of [...(n.shadowRoots || []), ...(n.children || [])]) walk(c); };
  walk(host);
  return parts.join(' ');
}

try {
  log('chrome', (await send('Browser.getVersion')).product);
  const { id: extId } = await send('Extensions.loadUnpacked', { path: EXT });
  log('ext', extId);
  const sw = await waitTarget((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
  const swSid = await attach(sw.targetId);

  const { targetId: optTarget } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options.html` });
  const opt = await attach(optTarget); await sleep(1500);
  const perm = await evaluate(opt, `(async () => {
    const root = await navigator.storage.getDirectory(); const lib = await root.getDirectoryHandle('library', { create: true });
    await new Promise((res, rej) => { const r = indexedDB.open('keyval-store'); r.onupgradeneeded = () => r.result.createObjectStore('keyval');
      r.onsuccess = () => { const tx = r.result.transaction('keyval', 'readwrite'); tx.objectStore('keyval').put(lib, 'library-handle'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); });
    return lib.queryPermission({ mode: 'readwrite' }); })()`);
  check('剪藏库句柄（OPFS）已登记且可写', perm === 'granted', perm);
  const uiLang = await evaluate(opt, `chrome.i18n.getMessage('uiLang')`);
  log('uiLang', uiLang);
  const supported = await evaluate(opt, `chrome.storage.local.get('translationSupported').then((r) => r.translationSupported)`);
  check('选项页加载后写入 translationSupported=true', supported === true, supported);

  // 测试页是英文：目标显式设成简体中文（macOS 上的 Chrome 不认 --lang，界面语言随系统，'auto' 可能解析成 English）
  await evaluate(opt, `chrome.storage.local.set({ translationSettings: { target: 'zh', always: false } })`);
  await sleep(500);
  // 右键「并翻译」项：contextMenus 没有查询接口，用 update 是否成功判断存在
  const menuExists = () => evaluate(swSid, `new Promise((res) => chrome.contextMenus.update('save-page-translate', {}, () => res(!chrome.runtime.lastError)))`);
  await sleep(500);
  check('支持且未开「总是翻译」：右键有「并翻译」项', (await menuExists()) === true);

  const openTab = async (url) => {
    const { targetId } = await send('Target.createTarget', { url });
    await sleep(2500);
    const tabId = await evaluate(swSid, `chrome.tabs.query({ url: ${JSON.stringify(url)} }).then((t) => t[0]?.id)`);
    return { targetId, tabId };
  };
  const openPanel = async (pageTarget) => {
    await send('Target.activateTarget', { targetId: pageTarget });
    await sleep(500);
    const r = await evaluate(swSid, `chrome.action.openPopup().then(() => 'ok', (e) => String(e))`);
    if (r !== 'ok') throw new Error('openPopup: ' + r);
    const t = await waitTarget((x) => x.url === `chrome-extension://${extId}/popup.html`, 15000);
    const sid = await attach(t.targetId);
    await send('Runtime.enable', {}, sid);
    return { sid, targetId: t.targetId };
  };

  // ---- 1. 面板：A → 点翻译 → C → 点下载 → D → B → E（全新 profile，模型未下载） ----
  const p1 = await openTab(`${BASE}/short`);
  const panel1 = await openPanel(p1.targetId);
  const a = await waitBlock(panel1.sid, (b) => b.kind === 'idle', 30000, 'short');
  const sel1 = await evaluate(panel1.sid, `document.querySelector('.tr select')?.value`);
  check('面板：存好后出现空闲翻译块（A），下拉框默认选中设置里的目标（zh）', a.ok && sel1 === 'zh', { last: a.last, sel1 });
  log('click', await clickBlockButton(panel1.sid));
  const seenAll = [...a.seen];
  let done = null;
  for (let round = 1; round <= 4 && !done; round++) {
    const w = await waitBlock(panel1.sid, (b) => ['needs-download', 'complete', 'engine-failed', 'download-failed', 'source-unknown', 'unsupported-pair'].includes(b.kind), 300000, `short r${round}`);
    seenAll.push(...w.seen);
    if (!w.ok) break;
    if (w.last.kind === 'needs-download') { log('needs-download:', w.last.text); log('click', await clickBlockButton(panel1.sid)); continue; }
    if (w.last.kind === 'download-failed' && /NotSupportedError/.test(w.last.text)) { log('download retry', w.last.text); await sleep(3000); log('click', await clickBlockButton(panel1.sid)); continue; }
    done = w.last;
  }
  check('面板：经 C（要先下载）、D（下载中）到 E（已加上译文）', done?.kind === 'complete' && seenAll.includes('needs-download') && seenAll.includes('downloading'), { seenAll, done });
  check('面板：中途出现过 B（翻译中）', seenAll.includes('running'), seenAll);
  const file1 = (await evaluate(opt, listLib)).find((n) => n.includes('How Small Libraries'));
  const md1 = file1 ? await evaluate(opt, readLib(file1)) : '';
  fs.writeFileSync(path.join(OUT, 'short.md'), md1 || '');
  check('面板翻译后文件 translation complete', fmValue(md1, 'translation') === 'complete', file1);

  // 焦点：翻译进度更新不把焦点从标题框拉走（续修 1）——在长文上验证
  await send('Target.closeTarget', { targetId: panel1.targetId });
  await sleep(800);

  // ---- 2. 长文：点翻译 → B；在标题框里聚焦；进度更新期间焦点不动；关掉面板后页面提示接着显示 ----
  const p2 = await openTab(`${BASE}/long`);
  const panel2 = await openPanel(p2.targetId);
  const a2 = await waitBlock(panel2.sid, (b) => b.kind === 'idle', 30000, 'long');
  check('长文：空闲翻译块', a2.ok, a2.last);
  await clickBlockButton(panel2.sid);
  const b2 = await waitBlock(panel2.sid, (b) => b.kind === 'running' && /\d+ \/ \d+/.test(b.text), 60000, 'long');
  check('长文：进入 B 且显示 已译 / 总数', b2.ok, b2.last);
  await evaluate(panel2.sid, `(() => { const i = document.querySelector('input'); i.focus(); return document.activeElement === i; })()`);
  const n1 = await evaluate(panel2.sid, blockState);
  await sleep(2500);
  const n2 = await evaluate(panel2.sid, blockState);
  const focusKept = await evaluate(panel2.sid, `document.activeElement === document.querySelector('input')`);
  check('长文：进度在更新且焦点留在标题框', focusKept === true && n1?.text !== n2?.text, { n1: n1?.text, n2: n2?.text, focusKept });
  await send('Target.closeTarget', { targetId: panel2.targetId });
  const pageSid = await attach(p2.targetId);
  let tt = null; const t0 = Date.now(); const toastSeen = [];
  while (Date.now() - t0 < 240000) {
    tt = await toastText(pageSid).catch(() => null);
    if (tt && toastSeen[toastSeen.length - 1] !== tt.replace(/\d+/g, '#')) { toastSeen.push(tt.replace(/\d+/g, '#')); log('toast', tt); }
    if (tt && /已加上|translation added/.test(tt)) break;
    await sleep(300);
  }
  check('长文：面板关掉后页面提示显示翻译进度', toastSeen.some((s) => /正在翻译|Translating/.test(s) && /#/.test(s)), toastSeen);
  check('长文：页面提示最后显示已加上译文', !!tt && /已加上|translation added/.test(tt), tt);
  await sleep(4500);
  check('长文：译完 3 秒后提示消失', (await toastText(pageSid).catch(() => 'err')) === null);

  // ---- 3. 开「总是翻译」：右键「并翻译」项消失；工具栏保存自动开始翻译 ----
  await evaluate(opt, `chrome.storage.local.set({ translationSettings: { target: 'zh', always: true } })`);
  await sleep(1500);
  check('开「总是翻译」后右键「并翻译」项消失', (await menuExists()) === false);
  const p3 = await openTab(`${BASE}/auto`);
  const panel3 = await openPanel(p3.targetId);
  const b3 = await waitBlock(panel3.sid, (b) => b.kind === 'running' || b.kind === 'complete', 60000, 'auto');
  check('总是翻译：工具栏保存后不用点就开始翻译', b3.ok, b3.seen);
  await send('Target.closeTarget', { targetId: panel3.targetId });
  await evaluate(opt, `chrome.storage.local.set({ translationSettings: { target: 'ja', always: false } })`);
  await sleep(1500);
  check('关掉「总是翻译」后右键「并翻译」项回来', (await menuExists()) === true);

  // ---- 4. 再开一次已译过的短文面板（加批注路径之外，直接点翻译）：已经加过译文 ----
  const p4 = await openTab(`${BASE}/short`);
  const panel4 = await openPanel(p4.targetId);
  const d4 = await waitBlock(panel4.sid, () => true, 30000, 'dup');
  check('已存过的页面打开面板：不显示翻译块（duplicate）', d4.ok === false || d4.last === null, d4.last);
  log('library files', JSON.stringify(await evaluate(opt, listLib)));
} catch (e) {
  log('FATAL', e.stack || e.message);
  checks.push({ name: 'fatal', ok: false });
} finally {
  fs.writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(checks, null, 2));
  log('SUMMARY', `${checks.filter((c) => c.ok).length}/${checks.length} passed`);
  server.close();
  try { await send('Browser.close', {}, undefined, 5000); } catch { /* ignore */ }
  await sleep(1000); proc.kill('SIGKILL'); process.exit(checks.every((c) => c.ok) ? 0 : 1);
}
