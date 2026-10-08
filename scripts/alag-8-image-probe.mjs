/* global chrome */ // 第 30 行附近的函数经 executeScript 注入到 service worker 里执行，chrome 在那里才有定义
// ALAG-8 真机探针：在真实 Chromium 里加载构建好的扩展，打开页面，经扩展 service worker 注入 capture.js 并取回 Capture，
// 列出 Markdown 里的图片地址。通过（退出码 0）= 抽取成功、至少一张图、每张都在 *.wikimedia.org 且不是 /wiki/File: 说明页；
// 图片不合格或一张都没有退出码 1，抽取失败退出码 2。只用于维基百科条目页。
// jsdom 里复现不了这个问题（Defuddle 在 jsdom 里没走到懒加载图片规则），以本探针为准。
//
// 依赖不在项目里，放在临时目录装：
//   mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright
// 运行（先 npx wxt build）：
//   NODE_PATH=/tmp/pw/node_modules node scripts/alag-8-image-probe.mjs .output/chrome-mv3 https://en.wikipedia.org/wiki/Plain_text "<Chromium 可执行文件路径>"
// Chromium 路径例：~/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { chromium } = createRequire(path.join(process.env.NODE_PATH ?? '.', 'x'))('playwright');
const [extDir, pageUrl, exe] = process.argv.slice(2);
const userDir = mkdtempSync(path.join(tmpdir(), 'alag8-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: true,
  executablePath: exe,
  args: [`--disable-extensions-except=${path.resolve(extDir)}`, `--load-extension=${path.resolve(extDir)}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const page = await ctx.newPage();
await page.goto(pageUrl, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const res = await sw.evaluate(async (u) => {
  const [tab] = await chrome.tabs.query({ url: u.split('#')[0] + '*' });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/capture.js'] });
  return await chrome.tabs.sendMessage(tab.id, { type: 'capture' });
}, pageUrl);
await ctx.close();
if (!res || res.error || !res.markdown) {
  console.log(`PROBE: extraction failed (${res?.error ?? 'no markdown'})`);
  process.exit(2);
}
const imgs = [...res.markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]);
// 维基百科条目的图片都在 *.wikimedia.org；说明页（/wiki/File:）或别的地址都算错
const bad = imgs.filter((u) => u.includes('/wiki/File:') || !/^https:\/\/[a-z.]*wikimedia\.org\//.test(u));
console.log(JSON.stringify({ title: res.title, images: imgs }, null, 1));
console.log(`PROBE: ${imgs.length} images, ${bad.length} not on wikimedia.org or file-description pages`);
process.exit(imgs.length === 0 || bad.length > 0 ? 1 : 0);
