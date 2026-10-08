import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'wxt';

// 随扩展分发的许可文件（ADR-0007）：构建完成后拷进产物目录，`wxt zip` 的包里才会有。
const LICENSE_FILES = ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.md'];

// 运行环境分工见 docs/adr/0004；权限与快捷键见 DESIGN.md §4。
export default defineConfig({
  srcDir: 'src',
  hooks: {
    'build:done': (wxt) => {
      for (const f of LICENSE_FILES) copyFileSync(join(wxt.config.root, f), join(wxt.config.outDir, f));
    },
  },
  manifest: {
    // 文案在 public/_locales（ALAG-7）；Chrome 不接受无地区的 zh，繁体中文浏览器靠 zh_TW（内容同 zh_CN）显示简体中文
    default_locale: 'en',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    permissions: ['storage', 'scripting', 'contextMenus', 'activeTab', 'tabs'],
    host_permissions: ['<all_urls>'],
    commands: {
      'save-page': {
        suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' },
        description: '__MSG_cmd_savePage__',
      },
    },
  },
});
