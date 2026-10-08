// verify.sh full 用：构建产物的 manifest 必须满足 DESIGN.md §4 与 ADR-0004 的约定。
import { readFileSync, existsSync } from 'node:fs';

const dir = '.output/chrome-mv3';
const m = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
const fail = (msg) => {
  console.error(`manifest 检查失败：${msg}`);
  process.exit(1);
};

if (m.manifest_version !== 3) fail('manifest_version 不是 3');
for (const p of ['storage', 'scripting', 'contextMenus', 'activeTab', 'tabs']) {
  if (!m.permissions?.includes(p)) fail(`缺少权限 ${p}`);
}
if (!m.host_permissions?.includes('<all_urls>')) fail('host_permissions 缺少 <all_urls>');
const key = m.commands?.['save-page']?.suggested_key;
if (key?.default !== 'Alt+Shift+S' || key?.mac !== 'Alt+Shift+S') fail('save-page 快捷键不是 Alt+Shift+S');
if (m.action?.default_popup !== 'popup.html') fail('缺少工具栏面板 popup.html');
for (const s of ['16', '32', '48', '128']) {
  const want = `icon/${s}.png`;
  if (m.icons?.[s] !== want) fail(`icons 缺少 ${s} 尺寸`);
  if (m.action?.default_icon?.[s] !== want) fail(`工具栏图标缺少 ${s} 尺寸`);
  if (!existsSync(`${dir}/${want}`)) fail(`构建产物缺少 ${want}`);
}
if (m.options_ui?.open_in_tab !== true) fail('选项页必须在标签页里打开');
if (m.content_scripts?.length) fail('采集脚本不得在 manifest 里常驻（ADR-0004）');
if (!existsSync(`${dir}/content-scripts/capture.js`)) fail('缺少运行时注入的 content-scripts/capture.js');
// 文案（ALAG-7）：default_locale 为 en；name、description、快捷键说明都引用 _locales 里的键，且三份 messages.json 都有这个键
if (m.default_locale !== 'en') fail('default_locale 不是 en');
const locales = ['en', 'zh_CN', 'zh_TW'];
const messages = {};
for (const locale of locales) {
  const file = `${dir}/_locales/${locale}/messages.json`;
  if (!existsSync(file)) fail(`构建产物缺少 _locales/${locale}/messages.json`);
  messages[locale] = JSON.parse(readFileSync(file, 'utf8'));
}
for (const [field, value] of [
  ['name', m.name],
  ['description', m.description],
  ["commands['save-page'].description", m.commands?.['save-page']?.description],
]) {
  const key = /^__MSG_(\w+)__$/.exec(value ?? '')?.[1];
  if (!key) fail(`${field} 不是 __MSG_…__ 引用`);
  for (const locale of locales) {
    if (!messages[locale][key]) fail(`${field} 引用的键 ${key} 在 _locales/${locale}/messages.json 里不存在`);
  }
}
console.log('manifest 检查通过');
