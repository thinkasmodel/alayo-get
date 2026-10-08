# ALAG-7 Windows 实测记录

日期：2026-10-08。代码基准：`main` / `5d634a8`。按用户补充的 Windows 清单，在已登录的 UTM Windows 11 ARM64 虚拟机内完成中文、英文两轮真实 Chrome 测试。

**结论：两种语言的首次设置、设置页及四种入口的文件写入通过，但图片附件内容验收未通过：19 个附件中有 15 个实际是 HTML 页面。另确认 `.assets` 在关闭“显示隐藏的项目”时仍可见。**

## 环境与方法

- UTM：`Windows 11 — Parallels 迁移`，UUID `98C57968-1169-4B24-B616-9F656A631625`；Windows 11 专业版 ARM64。
- 原虚拟机没有 Chrome，从 Google 官方下载并安装 ARM64 Chrome `155.0.8059.40`。使用独立 profile：`C:\Users\<user>\ALAG7-Test\profile`。
- Mac 的 `.output/chrome-mv3` 整个目录复制到 `C:\Users\<user>\ALAG7-Test\chrome-mv3`；18 个文件逐一比较 SHA-256，全部一致。`background.js` 为 `0ebfbad1794185ee839d7d20c439a761dc1d996e8cb84c6ca7730bb5c2b19380`。
- 在 `chrome://extensions` 实际打开开发者模式、点击“加载未打包的扩展程序”，通过系统目录选择器载入构建。扩展 ID：`pknfajfpekmlhchkepmdjhameflfkldb`。
- 沿用用户已授权的虚拟机内自动化方式；Windows 使用 UTM guest agent 传输和启动、虚拟机内 Playwright/CDP 检查页面、Windows 原生鼠标键盘操作工具栏、快捷键及右键菜单。所有保存均通过真实入口触发，没有调用扩展内部保存函数。
- 剪藏库：`C:\Users\<user>\Documents\Alayo Get`，为本轮新建的本机目录。使用实际 Wikipedia 网页，未以测试桩替代保存、文件权限或附件下载。
- 在 Chrome 设置 › 语言中添加 English，选中“以此语言显示 Chrome 界面内容”，点击“重新启动”；重连后 `chrome.i18n.getUILanguage()` 为 `en-US`，中文轮为 `zh-CN`。
- 英文首次设置按原清单的方法仅移除测试 profile 的 `library-handle`，刷新检查后通过系统选择器选回同一剪藏库。没有删除剪藏文件。重启后真实权限提示的 `Allow on every visit` 也已操作并验证。

## 选项页

| 检查 | 中文 | 英文 |
| --- | --- | --- |
| 首次设置和设置页快捷键 | `Alt+Shift+S` | `Alt+Shift+S` |
| 首次设置的文件夹建议 | 仅“建议在本机硬盘上新建一个“Alayo Get”文件夹。” | 仅 “We suggest creating a new folder named “Alayo Get” on this computer’s hard drive.” |
| iCloud 建议句 | 无 | 无 |
| 首次设置的 Workbench 小节 | 无 | 无 |
| 设置页的 Workbench 小节 | 无 | 无 |
| 界面语言 | 简体中文 | 英文；扩展卡片描述为 `Save web pages as local Markdown files` |

设置页本身没有文件夹建议段落。Windows 系统文件选择器仍使用 Windows 的中文界面，不属于扩展漏译。

截图：[中文首次设置](本机证据目录（未入库）

## 实际保存

| 语言 | 真实入口 / 页面 | 写出的文件 | 附件内容核验 | 结果 |
| --- | --- | --- | --- | --- |
| 中文 | 工具栏 / Markdown | `Markdown.md` | 1 个 HTML 误存为 PNG | 正文落盘；图片失败，面板仍报“已存入剪藏库” |
| 中文 | `Alt+Shift+S` / Plain text | `Plain text.md` | 1 个 HTML 误存为 PNG | 正文落盘；图片失败，页面仍报“已存入剪藏库” |
| 中文 | 右键“存入 Alayo Get” / Typography | `Typography.md` | 2 张图片、7 个 HTML | 正文落盘；7 个图片文件内容错误 |
| 中文 | 选中文字后右键“摘录到 Alayo Get” / Markdown | `摘录 - Markdown - Wikipedia.md` | 0 | 通过，提示“已摘录 第 1 条” |
| 英文 | 工具栏 / Hypertext | `Hypertext.md` | 1 张图片、5 个 HTML | 正文落盘；面板仍报 `Article · 6 images` |
| 英文 | `Alt+Shift+S` / Text file | `Text file.md` | 1 张图片、1 个 HTML | 正文落盘；1 个图片文件内容错误 |
| 英文 | 右键 `Save to Alayo Get` / Lightweight markup language | `Lightweight markup language.md` | 0 | 通过，页面提示 `Saved to library` |
| 英文 | 选中文字后右键 `Save quote to Alayo Get` / Hypertext | `Quotes - Hypertext - Wikipedia.md` | 0 | 通过，提示 `Quote saved` / `Quote 1` |

- 合计 8 个非空 Markdown 文件、19 个非空附件文件（其中只有 4 个为有效 PNG，其余 15 个为 HTML）；文章均为 `medium: web`、`extract: full`，两份摘录为 `medium: quote`。
- Markdown 中的 19 处 `.assets/...` 引用均指向实际存在的文件，路径缺失数 0；这不能证明图片有效，15 个文件的内容核验失败。
- 中文文件含 `[原文]`，摘录含 `[跳回原文]`；英文文件含 `[Source]`，摘录含 `[Jump to source]`。切英文前后的中文摘录逐字一致。
- 结束时扩展卡片无 Errors 按钮，Chrome 记录的 runtime errors / manifest errors 均为 0，没有 duplicate id。本轮只包含语言切换所需重启，不替代此前 macOS 的 10 轮重启压力复测。
- 已复制完整剪藏库作为证据，27 个文件的 SHA-256 与虚拟机原件逐一一致。

证据：[文件与错误审计 JSON](本机证据目录（未入库）

## 实测缺陷：HTML 被当作图片保存

最终检查文件内容时发现 **15/19 个附件不是图片**。文件虽名为 `.png` / `.jpg`，实际以 `<!DOCTYPE html>` 开头，标题为 Wikipedia 的图片说明页，例如：

- `.assets/01M4D1DPHHDEQF0NH1N4T98D4Y/1.png` → `File:Plain text.png - Wikipedia`。
- `.assets/01M4D1VNTX97YR33BN7V3QGZWE/2.jpg` → `File:Vannevar Bush portrait.jpg - Wikipedia`。

中英文都出现；面板和提示仍报保存成功，文件元数据仍为 `extract: full`，后台错误记录为 0。因此不能把“成功提示 + 文件存在”作为图片保存通过。尚未确认是否为 Windows 特有问题，也未判定由 ALAG-7 引入。

稳定核验命令：`python3 本机证据目录（未入库） **1**，输出 `4/19 actual images; 15 invalid image payloads`。[逐文件结果](<本机证据目录（未入库）

只读排查已确认一处接受错误内容的路径：`src/core/images.ts` 的 `extFromContentType()` 在明确收到 `text/html` 时仍按 URL 后缀回退为 `png/jpg`；`src/sw/saveClip.ts` 的 `downloadImage()` 随后直接保存响应正文。直接调用现有函数，以 `text/html; charset=utf-8` 和 `https://en.wikipedia.org/wiki/File:Plain_text.png` 为输入，实测返回 `png`，而不是拒绝。抽取阶段为何选中这些说明页 URL，及是否有重定向参与，尚未进一步追踪，不作已确认根因的表述。

本轮范围为测试和记录，未修复实现或增加仓库测试；应在后续修复时对图片 URL 选择及非图片响应拒绝分别验证。

## `.assets` 的可见性

**会显示出来。** 资源管理器在剪藏库根目录列出了 `.assets`，系统目录选择器也能看到它。

- Explorer 设置读回为 `Hidden=2`（不显示隐藏项目）、`ShowSuperHidden=0`。
- `.assets` 属性为 `16`（`Directory`），没有 Windows `Hidden` 属性。
- 因而本轮不是“打开显示隐藏文件后才可见”；当前实现仅使用点前缀，在 Windows 上并未隐藏该目录。未修改隐藏属性或实现。

[资源管理器截图](本机证据目录（未入库）

## 收尾

只更新实测文档、清单和操作日志，没有修改源代码、构建或测试断言；本轮按纯文档范围做产物检查，没有重复运行 full，也没有重新构建。Windows 所测目录与用户提供的当前 `.output/chrome-mv3` 18 个文件逐一校验一致；后台脚本哈希也与此前 macOS 修复后复测一致。

保留英文测试 profile、扩展及剪藏文件，便于复查。`C:\Users\<user>\ALAG7-Test\Alayo Get Test.lnk` 可打开该 profile。临时控制通道和测试计划任务在收尾时移除，Chrome 使用同一 profile 重新打开且不携带远程调试参数。
