# ALAG-1 M0 实测记录

日期：2026-10-06（Asia/Shanghai；JSON 事件时间为 UTC）。起点 `13f0a95`。本票是一次性技术验证，实验代码未入库，未建立 M1 产品骨架。

**状态：五项均已有实测结论。** 写入选择 FSA；通用抽取选择 Defuddle 同步 DOM + Turndown。Workbench 本地图片预览通过；`.crswap` 会进入待纳入，已创建关联修复票 「新文件发现排除 Chromium FSA 的 .crswap 临时文件」。本票完成技术验证，不代表该跨项目修复已实现。

| 验证项 | 结果 | 证据 / 未完成边界 |
|---|---|---|
| FSA 授权、SW、iCloud | 支持跨进程持久授权；已授权 SW 可写；iCloud 子目录可选可写 | 首次 picker 授权不足，须在恢复句柄时选择“每次访问时都允许”。本轮 Chrome for Testing 153，未测日常 Chrome 154 profile |
| `.crswap` | FSA 确实生成同目录 `.md.crswap`，关闭流后消失 | **Workbench“待纳入”实际出现**，已建 Alayo 修复票 NKS-638 |
| 抽取库 | 选择 Defuddle 0.19.4，`new Defuddle(document, {useAsync:false}).parse()`，接 Turndown 7.2.4 | 两库各 11 篇、六类全覆盖；旁注丢失、外围污染等负例不隐藏；见独立报告 |
| X 跨域媒体 | worker 图片和 MP4 完整 fetch 均 200，无自定义 Referer/UA/Cookie | 仅证明两个具体 URL；MP4 覆盖满足票据“MP4 或 HLS”，没有验证 HLS 合并/流媒体下载 |
| Workbench 本地图片 | `![](.assets/test/1.jpg)` 实际渲染成功 | 安装版 1.3.1 空格预览可见深绿色底、黄色方块和文字；ADR-0002 保持 |

## 环境与证据

- macOS 27.0.1 / 26A434，Apple Silicon。
- 原型运行于独立 Chrome for Testing 153.0.8010.12 profile；不是 headless，不使用目录选择替身、不修改浏览器 permission 存储、不调用 CDP grantPermissions。
- 测试目录 `~/Documents/Alayo Get/`（本轮新建，仅实验文件）；iCloud 子目录 `~/Library/Mobile Documents/com~apple~CloudDocs/ALAG-1-FSA-test/`。
- 安装 Workbench `1.3.1`，运行路径 `/Applications/Alayo Workbench.app/Contents/MacOS/Alayo`。
- 浏览器结构化事件（证据文件未入库）、重启后 worker 写入界面（证据文件未入库）、早期快照（证据文件未入库）、探针步骤（实验脚本未入库）、[抽取报告](ALAG-1-extraction.md)、[一手资料与盲点](ALAG-1-primary-sources.md)。
- 早期日志传输尝试向 loopback collector POST 时挂起，导致两个早期 SW 操作只有 query 无结果。它们**不是写入失败的证据**。后来移除 collector，用独立 storage event key + JSON 下载；重新加载扩展后测出的成功/拒绝才用于结论。

## 1. FSA：首次授权、恢复授权、持久授权必须分开

以下时间为 UTC，换算上海时间加 8 小时。

1. `17:11:22` 在 MV3 扩展页面真实系统选择器中选本地测试目录并点“允许”。句柄存进 IndexedDB。`17:12:05` 页面写入 70 bytes，磁盘文件存在。
2. 首次进程更换后，`17:12:46` IndexedDB 句柄仍在，`queryPermission({mode:'readwrite'}) = prompt`；`17:14:08` 页面写入 `NotAllowedError`。重选目录又能写，不能据此立即决定退回 downloads。
3. 重载当前探针后，`17:18:54` 已授权 SW 写入 72 bytes 成功，说明本环境无需 offscreen 才能写入。
4. `17:19:13` iCloud 测试子目录 picker 成功，权限 granted，写入 74 bytes。仅验证目录可用，不代表云端同步/占位文件/Notes 对接已验证。
5. 再次更换进程后，`17:21:11` 句柄存在、权限 prompt；`17:21:35` SW 写入 `NotAllowedError`。
6. 点击恢复句柄的 `requestPermission` 后出现“仅这次访问时允许 / 每次访问时都允许 / 不允许”。选择“每次访问时都允许”，`17:21:40` 返回 granted；只读检查 Preferences 看到此扩展 origin 的 `file_system_access_extended_permission.setting = 1`。**没有通过编辑 Preferences 授权。**
7. 原 PID 10486 已退出，再启动同一 profile。`17:22:36` 页面无需再点授权，返回 granted；`17:23:17` worker 写入 `ALAG-1-worker-1791220997711.md` 成功（72 bytes），磁盘内容与事件记录一致。

**退出方式限制**：测试实例正常退出菜单以及 SIGTERM 后，Preferences 已记 `exit_type: Normal`，但进程仍滞留；随后对该独立测试 PID 发 SIGKILL 并核对旧 PID 消失，再启动。证明的是**完整进程更换后权限保留**；不声称菜单正常退出全过程无异常，也不声称重启了 macOS。没有退出用户日常 Chrome。单独启动过正式 Chrome 的空测试 profile，但 CUA 绑定到日常窗口，未在其中继续或计为正式版验证。

**执行上下文限制**：`worker` 成功来自页面发消息、SW 读取 IndexedDB 并执行 FSA，不是页面代写。没有收集到 `onStartup` 写入事件，不声称“完全没有扩展页面时的浏览器冷启动自动写入”已通过。票据所需 SW 写入成立；offscreen 不需启用，且它不能替代用户交互式授权。

## 2. `.crswap` 与 Workbench

`17:14:57` 调用 `createWritable()` 写入后故意不 close；磁盘与系统文件选择器都可见 `ALAG-1-held-1791220497789.md.crswap`（66 bytes），同时最终 `.md` 暂为 0 bytes。点击 close 后临时文件消失，最终 md 为 66 bytes。

本轮续接于 2026-10-06 09:53（Asia/Shanghai）完成原生观察。此前辅助功能树把 Open 报为 disabled；解锁后截图显示按钮为蓝色可用，按可见按钮位置点击即创建 `Alayo Get` 空间。此前“选择器 Open 灰显”的判断不准确，不能当作 Workbench 产品故障。

`01:53:16.687Z` 扩展持有新写入流，Workbench 报“The source has 2 new files”。点 View 后，Review Inbox 同时列出 `ALAG-1-held-1791251596677.md` 和 `ALAG-1-held-1791251596677.md.crswap`。后者磁盘为 66 bytes。保存了界面截图（证据文件未入库）与辅助功能文本（证据文件未入库）（截图在持流期间采集；全文 AX 在 close 后采集，列表仍显示同名临时条目）。按需求创建 「新文件发现排除 Chromium FSA 的 .crswap 临时文件」，关联 ALAG-1、NKS-632；本轮不修改 Workbench 代码。

`01:53:38.848Z` close 后，磁盘 `.crswap` 消失、正式 md 为 66 bytes。没有据此声称 Review Inbox 已立即自动移除旧临时条目，也不把正式零字节文件的写入稳定性扩大进后缀修复。
## 3. 抽取库

见[11 篇逐篇记录](ALAG-1-extraction.md)。同一 HTML、独立 DOM、同一 Turndown。微信和 Medium 使用真实浏览器 DOM；其余样本记录实际输入来源。Medium 的 curl/独立浏览器 403 只计获取限制，后来普通 Chrome 新标签读到公开全文后才加入对照。

Defuddle 在微信懒加载图片、Substack 小节层级、Medium 代码保留更好，选择它。仍有实质旁注丢失、复旦页面外围污染和小尺寸图片等负例；不得把非空输出直接标为完整。禁用异步外站 fallback，保持 ADR-0003。

## 4. X CDN

worker 使用普通 `fetch(url, {credentials:'omit', signal:…})`，没有设置 Referer/UA/自定义头，声明两个媒体 host permissions。

| UTC | URL | 状态 / MIME | 完整字节数 | 文件头 |
|---|---|---|---:|---|
| 17:17:13 | `https://pbs.twimg.com/media/HT1A2o3aQAI4ZbU?format=jpg&name=medium` | 200 / image/jpeg | 139029 | FF D8 FF E0 / JFIF |
| 17:18:00 | `https://video.twimg.com/amplify_video/943561675927519232/vid/240x240/mijiQdCq-p9FaO8H.mp4` | 200 / video/mp4 | 3755226 | ftyp / isom |

图片 URL 来自已加载 X 页的公开 DOM；视频 URL 来自公开 GitHub README（来源见一手资料），未调用 X 接口或逆向接口。未把媒体二进制提交仓库；只保留响应元数据。不由一个样本承诺全部历史/受限/失效 CDN URL 均可下载。

## 5. Workbench 本地图片预览通过

本机 `~/Documents/Alayo Get/ALAG-1-local-image.md` 引用 `.assets/test/1.jpg`。图片是本地生成的 600×240 JPEG，无网络依赖。仓库fixture（实验脚本未入库）保留相同目录布局。

2026-10-06 09:52–09:53（Asia/Shanghai），在新建的 `Alayo Get` 空间选择该 md 并按空格。原生预览标题为 `ALAG-1-local-image.md`，正文实际显示深绿色底、黄色方块、`ALAG-1 LOCAL IMAGE` 字样和下方 `END OF TEST`。预览截图（证据文件未入库）证明隐藏目录里的相对路径图片可显示。ADR-0002 保持，无需替代附件布局。
## 检查与收尾

实验目录自带的 verify 脚本（未入库） 只验证一次性 JS 探针语法、固定实验输入/输出 hash 和已记录结构，并明确输出抽取质量负例；**不是上述 GUI 验收**。没有 M1 TypeScript 产品代码，不声称跑过产品 typecheck。最终检查、双轴审查与 commit 见 `tasks/todo.md` / `logs/ops.md`。
