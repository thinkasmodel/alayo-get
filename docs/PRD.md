# Alayo Get — 第一阶段 PRD

- **日期**：2026-10-06
- **来源**：产品需求 grilling 会话（Q1–Q30 全部按推荐方案采纳，用户确认）
- **术语**：见仓根 [`CONTEXT.md`](../CONTEXT.md)；关键决策见 [`docs/adr/`](./adr/)

## 1. 定位

Alayo Get 是 Alayo 家族的采集端：一个 Chrome（MV3）扩展，把 Web 上的文章、X 帖子、网站和网页链接、图片、视频、音频保存成**剪藏**，落进本地**剪藏库**。面向所有用户，存下的是普通的 Markdown 和媒体文件；用 Alayo Workbench 的人可以把剪藏库加为监控目录、纳入画布（可选，[ADR-0005](./adr/0005-面向通用用户-workbench为可选对接.md)）。

家族约定：各产品在文件系统层交接，不做 API 级耦合。Get 沿用这条约定：**只写文件，不调用任何 Alayo API**（[ADR-0001](./adr/0001-只写文件系统-第一阶段只对接workbench.md)）。

## 2. 第一阶段范围

| 维度 | 决定 | 题号 |
|---|---|---|
| 用户与分发 | 只给产品所有者自用，以开发者模式加载未打包扩展，不上架商店。按 MV3 写，Chromium 系浏览器默认都能装。2026-10-08 修订（ALAG-9）：项目以 Apache-2.0 开源（GitHub `thinkasmodel/alayo-get`），并以 ThinkAsModel Limited 名义上架 Chrome Web Store，先 unlisted 过审、Q9 两周自用达标后切 public；见 ADR-0007 | Q1 |
| 目标产品 | 只对接 Workbench。剪藏字段按家族通用的 clip 字段（`source`/`medium`/ULID）设计。2026-10-07 修订（ALAG-6）：Get 面向所有用户，Workbench 改为可选对接，见 ADR-0005 | Q10 |
| AI | Get 自己不用 AI。摘要和理解交给 Workbench 的理解管线 | Q16 |
| 专门适配的站点 | 只有 X。其他站点走通用正文抽取；微信公众号、Substack、Medium 先实测通用抽取效果 | Q7 |
| 完成判据 | 产品所有者连续用 2 周，日常收 X 和网页文章时不需要再开其他剪藏工具，存进去的内容在 Workbench 里直接能用 | Q9 |

## 3. 剪藏形态

| 保存对象 | 落盘形态 | 题号 |
|---|---|---|
| 文章、帖子 | **文章剪藏**：全文转 Markdown，图片下载进 `.assets/<id>/`。抽取失败时退回书签剪藏，`extract: fallback`，保存不算失败 | Q2、Q12 |
| 网站链接、网页链接 | **书签剪藏**：`.md`，正文放页面描述，封面图存进 `.assets`，第一行是可点的原链接。右键保存某个链接时，在后台抓一次目标页取元数据，抓取失败只记 URL 和链接文字 | Q18 |
| 图片、≤100MB 的音视频直链文件、浏览器里打开的 PDF | **媒体剪藏**：原文件放在剪藏库根目录，命名为 `页面标题 - 原文件名.ext`；出处等元数据写进 `.meta/<id>.json` | Q3、Q19 |
| 流媒体视频和音频（YouTube、X、B 站、网盘等），以及超过 100MB 的直链 | **流媒体剪藏**：`.md`，记封面、时长、作者、简介和原链接，另加平台、视频 ID 等字段（见 §4）；以后做转录时，转录文本追加到这个文件里 | Q20、Q27 |
| 选中文字 | **摘录剪藏**：同一页面的摘录都追加到同一个 `摘录 - 页面标题.md`。每条摘录是一个 blockquote，带保存时间和文本片段链接（`#:~:text=`）。用户把这个文件移走或改名后，下次在同一页面摘录就新建一个文件 | Q8、Q21 |

不做：在原网页上持久高亮（Q8），下载流媒体（Q3），抓取评论区（Q4）。

**实现规则**（ALAG-4 设计期定，2026-10-07，用户逐条确认）：
- **媒体剪藏**：
  - 入口：右键图片、视频、音频；在打开 PDF 或媒体文件本身的标签页上点工具栏或按快捷键。
  - 文件原样放在剪藏库根目录，命名为 `页面标题 - 原文件名.ext`；页面标题为空或与原文件名相同时只用原文件名。svg、avif 也原样保存（Workbench 显示为“其他”卡片）。
  - 元数据侧档 `.meta/<id>.json` 里，`source` 记所在网页（出处），`media_url` 记文件本身的地址。已保存记录按 `media_url` 判断是否存过，同一页上的两张图可以各存一次。
  - `medium` 取 image、audio、video、pdf（pdf 为 ALAG-4 新增值）。
  - 存完只能补标签和批注，写进 `.meta/<id>.json`，不改标题、不重命名文件。
  - 图片和 PDF 超过 100MB 时不下载，退回书签剪藏。
- **流媒体剪藏**：
  - 识别的 7 类：YouTube、B 站、X 视频、百度网盘、115、夸克 6 个平台按 URL 规则识别；第 7 类 `platform: other` 是超过 100MB 或拿不到大小的音视频直链。
  - X：帖子页保存仍是 X 文章剪藏（§5 不变）。只有 `/status/<id>/video/<n>` 视频专链，以及在帖子页的视频上右键，才存流媒体剪藏。在时间线上右键视频时，Chrome 给出的视频地址是 `blob:`，认不出是哪条帖子，提示“请打开帖子页再存”，不写文件（2026-10-07 用户确认）。
  - 右键保存链接时，链接指向上述平台的，也存流媒体剪藏。
  - YouTube、B 站的元数据由扩展后台抓一次视频页的服务端 HTML，按纯文本解析：标题、作者、时长、简介、封面、嵌入地址。B 站简介取页面数据里的视频简介，不用 og:description（它混有播放量和相关视频）。
  - 网盘分享页走通用抽取取标题、描述、封面，取不到标题就按书签剪藏处理。
  - 正文版式：一级标题、`[原文](出处)`、封面、`▶ 平台 视频 (时长) · 作者` 一行、简介全文；取不到的项不写。
- **摘录剪藏**：
  - 入口只有右键“选中文字”；面板和快捷键仍保存整页。
  - 选区用 Turndown 转成 Markdown 后整体放进 blockquote；选区里的图片只留链接，不下载。
  - 每条摘录下面一行写保存时间和“跳回原文”的文本片段链接（`#:~:text=`）。生成不了片段链接时只链到页面。
  - 页面提示的“加批注”写在这条摘录下面，作为普通段落。
  - 扩展在已保存记录里记住每个页面对应的摘录文件；这个文件被移走或改名后，下次在同一页面摘录就新建一个。

## 4. 剪藏库布局与格式

- **位置**：默认在 `~/Documents/Alayo Get/`，本地目录，不放 iCloud。原因有二：iOS 应用读不到自己 iCloud 容器以外的文件；开了"优化 Mac 存储空间"后，iCloud 可能把文件替换成占位文件。如果写入通道退回到 `chrome.downloads`，默认位置改为 `~/Downloads/Alayo Get/`（Q24）。
- **布局**：所有剪藏平铺在根目录，不按月份分子目录；附件放进 `.assets/<id>/`，元数据侧档放进 `.meta/`（Q12、Q13，[ADR-0002](./adr/0002-附件与元数据放隐藏目录-一篇剪藏一张卡.md)）。“隐藏”只靠目录名以点开头：macOS、Linux 上默认看不到；Windows 资源管理器不认点前缀，会显示 `.assets`、`.meta`。扩展用的 File System Access API 设不了 Windows 的“隐藏”属性，所以接受这个差异（ALAG-8，用户 2026-10-08 定）。
- **命名**：`标题.md`。标题超过 60 字截断，非法字符替换，重名时加后缀 ` (2)`。X 帖子命名为 `@作者 - 正文前30字.md`，thread 和长文用首帖或长文的标题。日期和 id 只写进 frontmatter，不放进文件名（Q13）。
- **frontmatter**（Q14、Q27）：

```yaml
id: 01J...                 # ULID
source: https://...        # 规范化后的 canonical URL
medium: web | x | video | audio | image | pdf | link | quote
title: ...
author: ...                # X 上记成 "Name (@handle)"
published: 2026-10-05T...
captured: 2026-10-06T...
site: x.com
tags: []
note: ""                   # 保存时写的批注
extract: full | partial | fallback
# 以下字段仅流媒体剪藏有
platform: youtube | bilibili | x | baidupan | 115 | quark | other
video_id: ...              # 平台内 ID（BV 号、网盘文件或分享 ID）
embed: https://...         # 能推出嵌入地址就填，否则留空
duration: 213              # 秒
cover: .assets/<id>/cover.jpg
```

  第一阶段不记 `lang`、`word_count`、`summary` 这类派生字段。

- **重复保存**：Get 在扩展本地维护一份**已保存记录**（URL → 文件路径、id）。同一 URL 再存时，提示"已于某日保存过"，默认不重复写，同时提供"另存一份新快照"。不覆盖原文件，因为原文件可能已经被移动或改动过（例如在 Workbench 里整理过）。用户手动删除或移动文件后，记录会过期，可以接受（Q15）。

## 5. X 适配

- **覆盖范围**：单帖；作者自己的连续 thread（自动拼成一篇）；X 长文（Articles）；引用帖（写成嵌入的 blockquote）；图片（下载）；视频（存封面和链接）。不抓评论区（Q4）。
- **获取方式**：只解析当前页面的 DOM，借用户的登录态，不调用 X 的 API，也不用逆向接口（[ADR-0003](./adr/0003-x只解析当前页dom-不调接口.md)）。
- **排版**（Q22）：
  - thread 各帖之间空一行，不加分隔线；配图放回原来的位置。
  - 引用帖第一行写 `**Name (@handle)** · 日期 · [原帖](url)`，下面接引用帖正文。
  - 长文的标题作为一级标题，正文结构按原样转换。
  - 视频处放封面，下面一行写 `▶ 视频 (时长)` 并带链接。
  - t.co 短链一律还原成真实 URL。
  - 不记点赞、转发数。
- **thread 没加载全**（Q28）：用户点保存后，Get 自动滚动页面或点击展开，上限 50 条或 15 秒；仍然取不全就存下已加载的部分，标 `extract: partial`，并在面板里提示。

- **实现规则**（ALAG-3 设计期定，2026-10-07）：
  - 数据来源：DOM 为主；被引用帖的原帖 URL、链接卡片的真实 URL、视频时长从页面内存补（见 ADR-0003 修订）。
  - 作者串的范围：先滚到顶部，再往下边滚边累积（X 的列表会回收滚出视口的帖子）。上文从焦点帖往上，取同一作者连续的帖子；下文跳过分隔行，连续收作者本人的帖子，遇到别人的帖子为止。紧跟作者末条的“显示回复”按钮要点开再继续。作者在主帖下的自回复（如推广链接）也算作者串。
  - 文件名：单帖和作者串是 `@作者 - 首帖前30字.md`，长文是 `@作者 - 长文标题.md`。
  - 列表里被截断的长帖（“显示更多”）：存截断文本，后面附原帖链接，整篇标 `extract: partial`。
  - 面板和页面提示里的“部分”提示文案见 `DESIGN.md`“X 剪藏”。

## 6. 交互

- **入口**（Q5）：工具栏面板、右键菜单（页面、选中文字、图片、链接、视频）和快捷键。X 帖子操作栏里的注入按钮放到第一阶段后半段或第二阶段。
- **保存流程**（Q6）：点一下就保存，存完后可以选填标题、标签、批注。不提供正文预览，也不能手动框选正文。
- **反馈**（Q23）：
  - 工具栏面板有几种状态：保存中、已保存（带选填输入框）、已存过、退回书签、失败、需要重新授权文件夹。
  - 用快捷键或右键保存时不弹面板：扩展图标上显示 ✓ 或 ! 角标，页面右下角出现一个轻量提示，3 秒后消失，上面有"加批注…"按钮（点击打开工具栏面板，在面板里写批注；提示本身不放输入框，见 ADR-0008）。失败和需要重新授权时，提示不自动消失。
- **首次使用**（Q24）：打开引导页，让用户选文件夹并授权。Workbench 用户把这个文件夹加为监控目录的说明放在可选小节里，默认收起（ALAG-6 修订）。
- **设计稿闸**：M1 开工前，先按家族 DESIGN.md 出面板各状态和页面提示的深浅色设计稿，用户确认后再实现。**2026-10-06 已定稿**，规范见仓根 [`DESIGN.md`](../DESIGN.md)，稿源在 `designs/alag-2-m1/`。同时定下的几件事：
  - 标签输入时，从历史标签里给建议（稿中 2B 方案）。
  - "直接保存当前页"的默认快捷键是 ⌥⇧S（`Alt+Shift+S`）。
  - 需要重新授权时，先记住这次要保存的内容，授权成功后自动写入。
  - 面板里改过的标题、标签、批注，在关闭面板时自动写入，不设"写入修改"按钮。原因是 Chrome 弹出面板一失去焦点就会关闭，先写后点按钮的话，没点就会丢内容。

## 7. 技术方案

- **写入通道**（Q11，M0 已选定）：File System Access，目录句柄持久化在 IndexedDB；每次写入前先 `queryPermission`，权限不在就在用户点击扩展页面时 `requestPermission`。首次 picker 授权不等于持久授权：恢复句柄时需选择“每次访问时都允许”，M0 已实测选择后跨进程仍为 granted，service worker 可直接写入；默认剪藏库保留 `~/Documents/Alayo Get/`，本轮不切换 downloads、不启用 offscreen。版本、退出方式与未测边界见 [M0 实测](./research/ALAG-1-results.md)。Native Messaging 留到以后需要和 Workbench 联动时再考虑。
- **技术栈**（Q17）：WXT、TypeScript、Turndown，测试用 Vitest，各站点抽取器配上保存的 HTML 样本。`verify.sh` 跑 typecheck、lint 和单元测试。通用正文抽取选 **Defuddle 0.19.4 同步 DOM 抽取**（`useAsync:false`）+ **Turndown 7.2.4**；M0 与 Readability 0.6.0 各抽 11 篇真实文章，覆盖中英文博客、微信、Substack、Medium、新闻，见[逐篇对照及负例](./research/ALAG-1-extraction.md)。禁用异步外站 fallback，不调用 FxTwitter；旁注丢失、外围污染和图片清晰度仍需后续质量保障，非空输出不等于完整正文。
- **跨域资源**：在 service worker 或扩展页面里 fetch，声明 `host_permissions` 后不受 CORS 限制；content script 要把请求转给 service worker 去发（[Chrome 文档](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)）。

## 8. 里程碑（Q29）

Linear：M0 ALAG-1 · M1 ALAG-2 · M2 ALAG-3 · M3 ALAG-4 · M4 ALAG-5

| 里程碑 | 内容 |
|---|---|
| **M0 技术验证（约 1–2 天）** | ① 用 FSA 往 `~/Documents/Alayo Get/` 写文件，重启浏览器后再写一次，看要不要重新授权 ② 看 `.crswap` 临时文件会不会出现在 Workbench 的"待纳入"里 ③ Defuddle 和 Readability 各抽 10 篇真实文章对比 ④ 测 pbs.twimg.com、video.twimg.com 的图片和视频能不能跨域下载 ⑤ 实测 Workbench 的 md 预览能否显示 `.assets/` 里的相对路径图片 → 结论写进 ADR |
| **M1 通用骨架** | 面板、右键菜单、快捷键，通用文章抽取，书签剪藏，已保存记录和去重，首次使用引导（开工前先过设计稿闸） |
| **M2 X 适配** | 单帖、thread（含自动展开）、长文、引用帖，t.co 短链还原 |
| **M3 媒体与摘录** | 媒体剪藏落盘，流媒体剪藏（含平台识别），摘录剪藏 |
| **M4 试用** | 产品所有者连续用 2 周，发现的问题回流修复 |

## 9. 不在第一阶段范围的后续工作

- **在 Workbench 里播放流媒体**（Q25、Q26）：属于 Workbench 的事，先作为想法记进 Workbench 的 Linear（NKS-637）。如果要做，方向是在 Workbench 里开一个内嵌网页预览，直接加载原页面（网盘在 Workbench 里登录一次），不对接网盘接口。做之前要先对照 Workbench PHILOSOPHY.md:143"预览是辨认，不是消费"这一条。
- **Workbench 的 `.crswap` 排除**：M0 已实测会进入待纳入，已建 Workbench 票「新文件发现排除 Chromium FSA 的 .crswap 临时文件」（NKS-638）跟进。
- **以后再考虑**：X 帖子操作栏里的注入按钮；小红书、知乎、YouTube、B 站的专门适配；音视频转录；上架 Chrome 商店——2026-10-08 已决定做，见 ADR-0007。

## 附录：调研事实（2026-10-06）

**Workbench**
- 只有文件是一等对象。网页链接拖进来时存成 `.webloc`。
- 监控目录里发现的新文件进入"待纳入"，一个文件对应一张卡，按所在目录分组。
- 发现新文件时，监控根以下路径里只要有任何一级以 `.` 开头，就排除这个文件。排除名单里有 `.crdownload`，没有 `.crswap`。
- 应用内已有两种预览：WebKit 渲染 md，但禁用脚本和 iframe；AVKit 只播放本地文件。

**Chrome**
- Chromium 的敏感路径清单把 `~/Library` 整个拦掉，但 `~/Library/Mobile Documents` 和 `com~apple~CloudDocs` 单独放行（`chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc`）。
- Chrome 122 起有持久授权，但官方文章只讲网页和 PWA，没说扩展能不能用（[blog](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)）。有一个相关问题 crbug.com/352252531。

**流媒体与网盘**
- YouTube 嵌入要求请求带 HTTPS Referer（[RMF](https://developers.google.com/youtube/terms/required-minimum-functionality)）。
- B 站外链播放器没登录时最高 480P。
- 百度网盘开放平台有视频流接口，但要注册应用、走 OAuth，准入门槛没查实。
- 115 开放平台 2026-08-09 起暂停服务。
- 夸克没有官方 API。
