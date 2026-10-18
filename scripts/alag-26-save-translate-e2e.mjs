// ALAG-26 编排者真机验收：加载构建产物，剪藏库指向扩展自己的 OPFS 目录（真实的 FileSystemDirectoryHandle，免去系统选文件夹对话框），
// 选项页里真实点击下载 en→zh 语言包与检测模型，再从扩展页面经 'panel' Port 发 start＋translateTo 保存本地英文测试页，
// 轮询剪藏文件，验证先存原文、出现 partial、最终 complete 的对照译文，以及翻译中途在面板改标签、批注、标题后改动保留。
// 用法：npx wxt build && node scripts/alag-26-save-translate-e2e.mjs --ext .output/chrome-mv3 --profile <新的空目录> --out <输出目录>
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


// 本地测试页：短文（结构齐全）与长文（400 段：实测本机翻译约每秒几十段，400 段才超过 15 秒，能看到中间写回、并在翻译中途提交面板改动）。
const SHORT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>How Small Libraries Keep Their Catalogs Alive</title></head><body><article>
<h1>How Small Libraries Keep Their Catalogs Alive</h1>
<p>Most small libraries still run on a catalog that was built twenty years ago. It works, but every change takes a volunteer, a spreadsheet, and an afternoon.</p>
<h2>What we changed</h2>
<p>We moved the catalog into plain text files and kept them in a <a href="https://git-scm.com/">Git repository</a>. Each book is <strong>one file</strong>, and a nightly job runs <code>catalog build</code> to regenerate the website.</p>
<ul><li>Volunteers edit files in any text editor.</li><li>Every change is reviewed before it goes live.</li><li>Old versions are never lost.</li></ul>
<blockquote><p>The best catalog is the one people are willing to update.</p></blockquote>
<pre><code>catalog build --out site/</code></pre>
<p>The whole migration took three weekends, and nobody had to learn a new tool to keep the shelves in order.</p>
</article></body></html>`;
const TOPICS = ['reading room', 'card catalog', 'returns desk', 'children\'s corner', 'reference shelf', 'map collection', 'study carrel', 'periodicals rack'];
const LONG = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A Year at the Eastside Branch</title></head><body><article><h1>A Year at the Eastside Branch</h1>
${Array.from({ length: 400 }, (_, i) => `<p>In week ${i + 1}, volunteers rearranged the ${TOPICS[i % TOPICS.length]} so that visitors could find what they needed without asking, and they wrote down every change in a shared notebook for the next shift.</p>`).join('\n')}
</article></body></html>`;
const server = http.createServer((req, res) => {
  const page = req.url === '/short' ? SHORT : req.url === '/long' || req.url === '/long2' ? LONG : null;
  if (!page) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

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
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 80, y: 50, button: 'left', clickCount: 1 }, opt);
  const dl = await evaluate(opt, 'window.dl', 300000);
  check('点击下载 en→zh＋检测模型', dl === 'ok', dl);

  const openTab = async (url) => {
    await send('Target.createTarget', { url });
    await sleep(2500);
    return evaluate(swSid, `chrome.tabs.query({ url: ${JSON.stringify(url)} }).then((t) => t[0]?.id)`);
  };

  // ---- 1. 短文：先原文、后对照译文 ----
  const tab1 = await openTab(`${BASE}/short`);
  const s1 = await evaluate(opt, panelSave(tab1), 120000);
  check('短文：面板 start＋translateTo 保存成功', s1.state?.state === 'saved', s1.states);
  const file1 = s1.state?.clip?.file;
  const w1 = await watchClip(opt, async () => file1, 120000);
  const md1 = w1.last || '';
  log('short final\n' + md1);
  fs.writeFileSync(path.join(OUT, 'short.md'), md1);
  const firstHasNoTranslation = w1.first !== null && !cjk(w1.first.split('\n---\n').slice(1).join('\n---\n'));
  check('短文：第一次读到的文件是原文（正文无译文）', firstHasNoTranslation, w1.seen);
  check('短文：最终 translation complete，lang en，translated_to zh', fmValue(md1, 'translation') === 'complete' && fmValue(md1, 'lang') === 'en' && fmValue(md1, 'translated_to') === 'zh', w1.seen);
  const body1 = md1.split('\n---\n').slice(1).join('\n---\n');
  const origBody = (w1.first || '').split('\n---\n').slice(1).join('\n---\n');
  // 原文完好：去掉译文行（含中文的行）、并把列表项末尾补的 `\` 去掉后，与第一次读到的正文逐行一致（空行折叠后比较）。
  const strip = (b) => b.split('\n').filter((l) => !cjk(l) && l !== '>').map((l) => l.replace(/\\$/, '')).filter((l) => l.trim() !== '').join('\n');
  check('短文：去掉译文后与原文一致', strip(body1) === strip(origBody), { got: strip(body1).slice(0, 300) });
  check('短文：代码块原样、未翻译', /```\ncatalog build --out site\/\n```/.test(body1));
  check('短文：段落、标题、列表项、引用都有中文译文，行内代码保留', /## 我|## .*[一-鿿]/.test(body1) && /`catalog build`.*/.test(body1.split('\n').filter(cjk).join('\n')) && (body1.match(/\\\n {2,}[一-鿿]/g) || []).length === 3 && /^> .*[一-鿿]/m.test(body1));

  // ---- 2. 长文：中间写回能看到 partial；翻译中途在面板改标签和批注，改动保留 ----
  const tab2 = await openTab(`${BASE}/long`);
  const s2 = await evaluate(opt, panelSave(tab2, { delayMs: 300, tags: ['e2e-tag'], note: 'note written while translating' }), 120000);
  check('长文：保存成功并在翻译中途提交了标签、批注', s2.state?.state === 'saved', s2.states);
  const file2 = s2.state?.clip?.file;
  const w2 = await watchClip(opt, async () => file2, 240000);
  await sleep(1500);
  const md2 = (await evaluate(opt, readLib(file2))) || '';
  fs.writeFileSync(path.join(OUT, 'long.md'), md2);
  check('长文：状态序列含 partial 后到 complete', w2.seen.includes('partial') && w2.seen[w2.seen.length - 1] === 'complete', w2.seen);
  check('长文：翻译中途改的标签和批注保留', /^tags: \["e2e-tag"\]$/m.test(md2) && fmValue(md2, 'note') === 'note written while translating');
  const paras2 = md2.split('\n').filter((l) => l.startsWith('In week '));
  const zhParas2 = md2.split('\n').filter((l) => cjk(l) && !l.startsWith('#') && !l.startsWith('note:'));
  check('长文：400 段都有译文', paras2.length === 400 && zhParas2.length >= 400, { en: paras2.length, zh: zhParas2.length });

  // ---- 3. 翻译中途改标题（文件改名）：后续写回跟到新文件名 ----
  await evaluate(swSid, `chrome.tabs.remove(${JSON.stringify(tab2)})`);
  const tab3 = await openTab(`${BASE}/long2`);
  const s3 = await evaluate(opt, panelSave(tab3, { delayMs: 300, title: 'Renamed While Translating' }), 120000);
  check('改标题：保存成功', s3.state?.state === 'saved', s3.states);
  const w3 = await watchClip(opt, async () => (await evaluate(opt, listLib)).find((n) => n.startsWith('Renamed While Translating')) ?? null, 240000);
  const md3 = w3.last || '';
  fs.writeFileSync(path.join(OUT, 'renamed.md'), md3);
  const files = await evaluate(opt, listLib);
  check('改标题：翻译中途改名，新文件名上接着写完且为 complete，旧文件名不在', w3.seen.includes('partial') && fmValue(md3, 'translation') === 'complete' && fmValue(md3, 'title') === 'Renamed While Translating' && md3.split('\n').filter((l) => l.startsWith('In week ')).length === 400 && md3.split('\n').filter((l) => cjk(l) && !l.startsWith('#')).length >= 380, { seen: w3.seen, files });
  log('library files', JSON.stringify(files));
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
