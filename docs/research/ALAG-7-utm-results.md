# ALAG-7 UTM 实测记录

日期：2026-10-08（Asia/Shanghai）。范围：ALAG-7 实测清单（票面），起始及测试代码为 `alag-7` / `be0e11e`。

最新结论：**清单中的 macOS 功能项通过；重复菜单 ID 修复后的新构建连续完整退出、重开 Chrome 10 次，全部通过，未再出现 duplicate id。Windows 中文、英文选项页及四种入口的写盘已实测；发现 15 个图片附件实际为 HTML，图片内容验收未通过；`.assets` 在资源管理器中可见，见 [Windows 补测记录](ALAG-7-windows-results.md)。** 本文两次 macOS 实测均未修改实现或测试断言，没有合并分支。下文保留首次发现和修复后复测的独立证据。

## 修复后重启复测（2026-10-08）

- 代码基准：`2a8bda0`，包含菜单串行重建修复 `299caea` 与回归补测 `d534d0d`。
- 在同一 UTM macOS 26.6.2 / Chrome 155.0.8059.40 / 独立测试 profile 上，将最新 `.output/chrome-mv3` 同步到 `/Users/cc/ALAG7-Test/extension`，并在 `chrome://extensions` 的 Alayo Get 卡片上实际点击 Reload。
- 本地与虚拟机 `background.js` SHA-256 均为 `0ebfbad1794185ee839d7d20c439a761dc1d996e8cb84c6ca7730bb5c2b19380`。刷新后截图已保留，扩展 ID 和安装路径沿用首次测试。
- 每轮在虚拟机内持续按住 `⌘Q` 2.5 秒，确认 Chrome 主进程消失，再以同一 profile 启动；每次打开扩展页后等待 3 秒，检查卡片是否有 Errors 按钮，并读取 Chrome 保存的 runtime / manifest errors。各轮之间没有清除错误记录。
- Chrome 原本勾选了 `Warn Before Quitting (⌘Q)`。准备阶段短按退出未使进程结束，没有计入 10 轮；后续持续按住组合键，退出警告设置未更改。

| 轮次 | Chrome PID（退出前 → 重开后） | 完整退出 | 错误按钮 | runtime / manifest errors | duplicate id |
| --- | --- | --- | --- | --- | --- |
| 1 | 3959 → 4010 | 是 | 无 | 0 / 0 | 无 |
| 2 | 4010 → 4065 | 是 | 无 | 0 / 0 | 无 |
| 3 | 4065 → 4110 | 是 | 无 | 0 / 0 | 无 |
| 4 | 4110 → 4157 | 是 | 无 | 0 / 0 | 无 |
| 5 | 4157 → 4203 | 是 | 无 | 0 / 0 | 无 |
| 6 | 4203 → 4248 | 是 | 无 | 0 / 0 | 无 |
| 7 | 4248 → 4294 | 是 | 无 | 0 / 0 | 无 |
| 8 | 4294 → 4339 | 是 | 无 | 0 / 0 | 无 |
| 9 | 4339 → 4386 | 是 | 无 | 0 / 0 | 无 |
| 10 | 4386 → 4432 | 是 | 无 | 0 / 0 | 无 |

结论：**10/10 轮通过，满足“5 次以上”复测要求。** 宿主本轮 `bash verify.sh full` 退出 0，55 个测试文件、589 项测试，生产构建与 manifest 检查通过。Chrome 保留在最后一轮的扩展管理页，便于复查；应用语言保持原始 `en-US`，未修改剪藏文件。此次只更新测试记录，未合并分支。

证据：[逐轮 JSON](本机证据目录（未入库） 10 轮卡片截图](本机证据目录（未入库） 日志](本机证据目录（未入库）

## 环境与方法

- UTM「macOS 26 — Parallels 迁移」，macOS 26.6.2 / 25G83，用户 `cc`。
- 虚拟机原来没有 Chrome。本次从 Google 官方下载地址安装 Chrome 155.0.8059.40，使用独立 profile `/Users/cc/ALAG7-Test/Profile`。
- 扩展在虚拟机内通过 Chrome「加载未打包的扩展程序」安装，ID `lojmmdpebhobmoppmjedpaggfaifcnec`，产物目录 `/Users/cc/ALAG7-Test/extension`。
- 剪藏库为独立目录 `/Users/cc/ALAG7-Test/Library`，通过真实文件夹选择器和 Chrome 授权框授权。
- 经用户明确同意，使用 SSH + Playwright 操作虚拟机内有界面的真实 Chrome；原生菜单、工具栏图标、快捷键和文件夹选择器由虚拟机内原生 UI 自动化操作。未替换扩展保存逻辑、未伪造文件系统句柄。closed shadow root 中的提示用 CDP 读取与定位，批注通过实际控件输入并按回车提交。
- `background.js` 和 `manifest.json` 在宿主与虚拟机的 SHA-256 一致。宿主 `bash verify.sh full` 退出 0：54 个测试文件、585 项测试通过，生产构建与 manifest 检查通过。

完整截图、文件阶段副本和日志：[证据目录](本机证据目录（未入库）

## 逐项结果

| 清单项 | 实际结果 | 判定 |
| --- | --- | --- |
| 1 中文工具栏保存 Markdown | 面板“已存入剪藏库”，文章剪藏、1 张图片；实际生成 `Markdown.md`。恢复简体后另核对中文页面提示“已于 10 月 8 日保存过 / 本次没有写入” | 通过 |
| 1 中文选区摘录 | 实际右键“摘录到 Alayo Get”，生成 `摘录 - Markdown - Wikipedia.md`，首条链接为 `[跳回原文]` | 通过 |
| 1 设置、快捷键、Workbench 路径 | 快捷键实际字符串 `⌥⇧S`；展开 Workbench 后两条路径、键帽可读，无重叠或裁切 | 通过 |
| 2 英文扩展描述 | `Save web pages as local Markdown files` | 通过 |
| 2 四类右键菜单 | 实际原生菜单分别含 `Save to Alayo Get`、`Save link to Alayo Get`、`Save image to Alayo Get`、`Save quote to Alayo Get`；链接或图片有多种上下文时位于 Alayo Get 子菜单 | 通过 |
| 2 英文设置及未设置快捷键 | 设置页英文，`html lang=en`；在 Chrome 快捷键页清空后显示 `Not set`，设回后 `chrome.commands.getAll()` 返回 `⌥⇧S` | 通过 |
| 2 英文首次设置 | 按清单仅删除 `library-handle`，刷新后显示英文引导，含 hard drive、iCloud、Workbench；用真实选择器选回同一 Library，授权并 Get started | 通过 |
| 2 Plain text 保存及重复保存 | 首次 `Saved to library`；再次点击工具栏显示 `Already saved on 2026-10-08`；实际文件含 `[Source](https://en.wikipedia.org/wiki/Plain_text)` | 通过 |
| 2 Typography 快捷键和批注 | 真实 `⌥⇧S` 保存；右下角 `Saved to library`；点击 Add note，输入并回车，文件 frontmatter 为 `note: "ALAG-7 English shortcut note"` | 通过 |
| 2 跨语言第二条摘录 | `Quote saved` / `Quote 2 · 摘录 - Markdown - Wikipedia.md`；同一文件新增 `[Jump to source]`，中文前缀逐字保持；`ALAG-7 English quote 2 note` 写在第二条下方 | 通过 |
| 3 繁体环境 | `chrome.i18n.getUILanguage()=zh-TW`，`html lang=zh-CN`，扩展设置、菜单、提示为简体；提示“第 3 条”，同一文件新增 `[跳回原文]`，`ALAG-7 zh-TW quote 3 note` 写在第三条下方 | 通过 |
| 4 切回简体中文 | 显式设为 `zh-CN` 后重启，右键菜单为“存入 Alayo Get”，中文页面提示正常；持久授权后重启没有再次要求授权 | 通过（环境适配见下） |
| 5 Windows | 本次未启动 Windows VM。full 包含 `src/ui/ui.i18n.dom.test.ts` 中 Windows 快捷键、无 iCloud / Workbench 的中英文覆盖 | 自动化通过，未做 Windows GUI 实测 |

文件比对额外确认：三个阶段副本满足 `zh` 为 `en` 的原样前缀、`en` 为 `zh-TW` 的原样前缀；最终共 2 条中文定位链接、1 条英文定位链接，无跨语言另建摘录文件。

## 首次发现：浏览器启动时偶发重复菜单 ID 错误（修复前历史记录）

功能清单跑完后，通过 Chrome 自身扩展错误记录接口读取到 5 条后台错误，各发生 1 次：

```text
Unchecked runtime.lastError: Cannot create item with duplicate id save-link
Unchecked runtime.lastError: Cannot create item with duplicate id save-image
Unchecked runtime.lastError: Cannot create item with duplicate id save-video
Unchecked runtime.lastError: Cannot create item with duplicate id save-audio
Unchecked runtime.lastError: Cannot create item with duplicate id save-quote
```

- 复测路径：完整退出 Chrome → 用相同测试 profile 启动 → 打开 `chrome://extensions` → 读取该扩展 runtime errors。
- 一次独立重启再次观察到上述 5 个 ID，加上 `save-page`，共 6 条。随后两次等待进程完整退出的重启未复现，说明当前证据不足以把它定为每次必现。
- 第一个复测脚本在已记录第一轮错误后，下一轮因退出与重开时序导致 Chrome 未启动；这个脚本失败不是扩展失败，也不计入通过次数。调整为等待进程退出后，后两轮正常运行且错误列表为空。
- 未观察到菜单缺失、语言错误、保存失败或摘录丢失；manifest errors 为空。**不能据此宣称后台无错误。**
- 定位入口：`src/entrypoints/background.ts:385` 的 `createContextMenus`；`onStartup` 和 `onInstalled` 均调用它。这里仅记录排查入口，不把并发原因当作已证实结论。
- 原始观察摘要：[runtime-error-observations.json](本机证据目录（未入库）
- 本轮任务是实测，问题保留待处理；未扩展为实现修复，也未改变现有测试。

## 环境差异与恢复

虚拟机原始系统语言为 `en-US`，且 Chrome 没有 `AppleLanguages` 覆盖。因此清单第 4 项的 `defaults delete` 在此环境会恢复英文，不能直接用于验证“回到中文”。本次先显式设为 `zh-CN` 完成中文回切验证，再删除覆盖，读回 Chrome 实际语言为 `en-US`，恢复原始偏好。

测试结束后 Chrome 已完整退出。官方 Chrome 安装、独立测试 profile、扩展和 4 个测试 Markdown 文件保留在虚拟机，方便复查；未触碰原有 Workbench 数据。分支仍为 `alag-7`，合并仍待后续处理。

## 主要证据

- [full 验证日志](本机证据目录（未入库）
- [中文设置及 Workbench 展开](本机证据目录（未入库）
- [英文首次设置](本机证据目录（未入库）
- [英文快捷键未设置](本机证据目录（未入库）
- [英文重复保存日期](本机证据目录（未入库）
- [英文第二条摘录提示](本机证据目录（未入库）
- [繁体环境第三条摘录提示](本机证据目录（未入库）
- [最终摘录文件](本机证据目录（未入库）
