# ALAG-24 Chrome 本机翻译 API 实测记录

日期：2026-10-18（Asia/Shanghai；下文时间为 UTC）。起点 `84c7835`。本票是一次性技术验证，决定 [ADR-0011](../adr/0011-翻译在offscreen文档里做-默认本机翻译.md)「翻译在 offscreen 文档里做，默认用浏览器本机翻译」是否成立。探针代码在 `scripts/alag-24-translator-probe/`，可在新版 Chrome 上重跑。

**结论：A1–A4 全部满足，ADR-0011 成立，不重议。** 另有四条发现要带进 ALAG-25 的设计：首次下载必须由用户在扩展页面里点一下；全新环境里第一次创建翻译器偶发失败，要重试；内容脚本不能直接翻译（按网页来源隐藏下载状态，网页还能用 Permissions-Policy 禁用）；绝不能在 Worker 里调用翻译 API（会卡死整个扩展进程）。

## 判定标准（实测前写定）

ADR-0011 成立需要同时满足 **A1、A2、A3、A4**；任一不满足就回到 ADR-0011 重议。其余各项只记录，影响后续票的设计，不否决 ADR。

| 编号 | 判据 | 不满足时 | 结果 |
|---|---|---|---|
| A1 | 语言模型已在本机时，offscreen 文档里 `Translator.create()` 与 `translate()` 能成功（offscreen 文档永远没有用户手势） | 重议：翻译不能在后台跑，保存时翻译要换方案 | **满足** |
| A2 | 模型下载后断网仍能翻译 | 重议：隐私承诺「不上传内容」站不住 | **满足** |
| A3 | 翻译阶段没有任何网络请求（只允许下载模型阶段有） | 重议：同上 | **满足**（见第 5 节的口径） |
| A4 | zh-Hans ↔ en 两个方向都可用 | 重议：主力语言对不可用，默认本机翻译没有意义 | **满足** |
| B1 | 模型未下载时，offscreen 文档能否触发下载；不能的话，扩展页面在用户点击后能否下载 | 只影响 ALAG-25：首次下载要放到面板或选项页里由用户点一下 | offscreen 不能；扩展页面点击后能 |
| B2 | 扩展自有页面、内容脚本能否直接用；页面 `Permissions-Policy` 能否挡住内容脚本 | 只影响「选中翻译」走哪条路 | 扩展页面能；内容脚本实际不能用；能挡住 |
| B3 | 其他语言对（zh-Hant、ja、ko、fr、de、es）可用性，是否经英文中转 | 写进支持语言列表 | 都可用；中日、中韩经英文中转 |
| B4 | 长文（约 5000 字/词）分段翻译的总耗时、单段耗时、有无失败 | 影响进度展示与分段大小 | 两遍都零失败，1–2 秒译完 |
| B5 | `translateStreaming()` 是否真的逐段吐出 | 影响阅读器里的显示方式 | 是，按句或按段分多次返回 |
| B6 | 最低 Chrome 版本（取自官方资料，本次只测 155） | 定 manifest 的 `minimum_chrome_version` | 官方资料为 138 |

## 环境

- macOS 27.0.1（26A434），Apple M4 Max，128 GB 内存。网络经本机系统代理 `127.0.0.1:6152` 出去。
- Google Chrome 稳定版 **155.0.8059.80**（Official Build，arm64），即本机安装的 `/Applications/Google Chrome.app`。不是 Chrome for Testing。
- 每轮用一个全新的独立 profile（`--user-data-dir` 指向会话临时目录），不碰日常 profile。
- 运行方式：`run.mjs` 以 `--remote-debugging-pipe --enable-unsafe-extension-debugging` 启动 Chrome，用 CDP `Extensions.loadUnpacked` 装探针扩展（品牌版 Chrome 已不支持 `--load-extension`）。窗口正常显示，不是 headless。
- 用户手势的控制：运行器的所有 `Runtime.evaluate` 都显式传 `userGesture: false`；需要手势的一步用 CDP `Input.dispatchMouseEvent` 真实点击扩展页面上的按钮。每次调用都记录了 `navigator.userActivation`，offscreen 文档里始终是 `isActive:false, hasBeenActive:false`。
- offscreen 文档用 `reasons: ['DOM_PARSER']` 创建。Chrome 不校验理由与用途是否相符，但商店审核会看；ALAG-25 要选一个说得通的理由并写好 justification。
- 网络记录：全程 `--log-net-log`（默认采集级别，含 URL），按运行器打的阶段标记切分（`netlog.mjs`）。
- 断网模拟：`--mode offline` 以 `--proxy-server=http://127.0.0.1:9`（不可达）重开同一 profile，所有外网请求都失败，回环地址照常直连。这是用代理挡住外网，不是物理断网。
- 长文：英文取 *Pride and Prejudice* 开头 123 段，约 5000 词、27,572 字符（Project Gutenberg #1342）；中文取鲁迅《阿Q正传》开头 46 段，5,146 字（维基文库简体转换）。两者均为公有领域，原文不入库。
- 证据文件（netlog、各轮 JSON、进度日志）在会话临时目录，未入库；本文引用的数字都来自正式轮（profile6）与其断网复测，另注明的除外。

共跑了 6 个全新 profile。前 5 轮各暴露出一处探针问题（`zh-Hans` 写法、Worker 卡死拖住运行器等），修正后第 6 轮完整跑通，断网复测用同一个 profile。前几轮的数据只用于第 3 节「首次创建偶发失败」的统计。

## 1. 各上下文能否用（A1、B2）

| 上下文 | `Translator` 存在 | 模型已在本机、无手势时 create + translate |
|---|---|---|
| offscreen 文档 | 是 | **成功**：用手势创建过的 21 个语言对全部译出，单句 6–30 ms |
| 扩展自有页面 | 是 | 成功（下载也在这里做，见第 2 节） |
| service worker | 是 | **成功**：availability → create → translate 共约 6 ms，输出「图书馆早上九点开放，阅览室在午夜前一小时关闭。」 |
| offscreen 里开的专用 Worker | 是 | **卡死**：调用后 120 秒没有返回，之后 offscreen 文档与 service worker 都不再响应（`1 + 1` 也超时），只能重启扩展 |
| 内容脚本（普通网页） | 是 | 失败：见下 |
| 内容脚本（网页设了 `Permissions-Policy: translator=(), language-detector=()`） | 是 | 失败：`NotAllowedError: Access denied because the Permission Policy is not enabled.`，availability 直接报 `unavailable`，语言检测同样被拒 |

- **service worker 能用，与官方文档不符。** 文档写 "The Translator API isn't available in Web Workers"，规范也只暴露给 Window；但 Chrome 155 的扩展 service worker 里能用。只测了 155，旧版本未知，不能据此改架构。
- **Worker 里调用会卡死整个扩展进程。** 第 2 轮只在 Worker 里检查 `typeof Translator`、不调用，后续一切正常；第 4、6 轮实际调用后，offscreen 和 service worker 都失去响应，因为它们与 Worker 同属扩展进程。翻译层不能放进 Worker。
- **内容脚本拿不到已下载的模型。** 内容脚本按所在网页的来源调用 API。模型已在本机时，这个来源看到的 `en>zh` 仍是 `downloadable`，create 报 `NotAllowedError: Requires a user gesture when availability is "downloading" or "downloadable".`。这符合文档里「按语言对隐藏下载状态以保护隐私」的说法。所以「选中翻译」要把文字发给扩展自己的上下文去翻，不能在内容脚本里直接调。

## 2. 用户手势与下载（B1）

- 无手势时 `availability()` 正常返回。语言包未下载时，offscreen 文档、扩展页面（加载时、未点击）调 `create()` 都**立刻**失败：`NotAllowedError: Requires a user gesture when availability is "downloading" or "downloadable".`（≤2 ms）。`LanguageDetector.create()` 同样如此。
- 在扩展页面里真实点击后 `create()` 会触发下载并成功。每个「英文↔某语言」语言包从点击到可用 3.5–10.6 秒，`downloadprogress` 事件 31–48 次；同一包的反方向（如 `zh>en`）此后 40–100 ms，不再下载。
- 下载的东西：TranslateKit 库 21 MB，每个语言包 75–84 MB（`en_zh` 77 MB、`en_zh-Hant` 84 MB），存在 profile 的 `TranslateKit/` 下；`chrome://components` 里显示为 "Chrome TranslateKit en-zh" 等组件。下载走 Chrome 组件更新（`update.googleapis.com`、`edgedl.me.gvt1.com`）。
- 下载状态按来源记：扩展页面下载过的语言对，同一扩展的 offscreen 文档随后报 `available`，可无手势创建；其他网页来源仍报 `downloadable`。
- 下载后可离线使用：见第 5 节断网复测。

## 3. 全新环境里第一次创建偶发失败

6 个全新 profile 中，第一次（有手势的）`create()` 有 2 次失败：等约 5 秒后报 `NotSupportedError: Unable to create translator for the given source and target language.`，紧接着的反方向也立刻报同样错误；几分钟后同一语言对正常可用（`zh`、`zh-Hans` 都成功），说明不是中文本身不支持。另外 4 次第一次就成功。两次失败都出现在最早的两轮，原因未查明（猜测与首次下载 TranslateKit 库有关，未证实）。之后给运行器加了「失败隔 10 秒再点一次」，但再没失败过，**重试这条路没有被实测到**。ALAG-25 要把这个错误当成可重试，并在界面上给出重试入口。

## 4. 语言对（A4、B3）

模型下载后，offscreen 里无手势逐对翻译同一句话：

| 语言对 | 结果 | 输出 |
|---|---|---|
| en → zh / zh-Hans / zh-CN | 成功 | 图书馆早上九点开放，阅览室在午夜前一小时关闭。 |
| zh / zh-Hans → en | 成功 | The library opens at 9:00 in the morning, and the reading room is closed… |
| en ↔ zh-Hant | 成功 | 圖書館早上九點開門，閱覽室在午夜前一小時關門。 |
| en ↔ ja、ko、fr、de、es | 成功（10 个方向） | 如 図書館は午前 9 時に開き、読書室は真夜中の 1 時間前に閉まります。 |
| zh ↔ ja、zh ↔ ko | 成功（4 个方向） | 如 ko→zh：图书馆早上 9 点开放，阅览室在午夜前一小时关闭。 |
| zh-Hant ↔ ja、zh → zh-Hant、fr → de | 未测 | 没有用手势创建过，offscreen 里报 `downloadable` |

- **语言标签**：`zh`、`zh-Hans`、`zh-CN` 都落到同一个 `en_zh` 包；第 1 轮里 `zh-Hans` 排第一时创建失败，是第 3 节的偶发失败，不是标签问题。产品里统一用 `zh` 与 `zh-Hant`（官方语言列表的写法）。
- **经英文中转**：装完 en↔zh、en↔ja、en↔ko 后，zh↔ja、zh↔ko 在 offscreen 里仍报 `downloadable`（来源隐藏），点击创建只用 70–103 ms、没有下载；`chrome://components` 里只有 `en-*` 语言包，没有中日、中韩包。所以非英语之间的翻译经英文中转，用到两个英文语言包。
- **译文质量**：日常句子通顺；文学性长句会出现直译错误，例如 "must be in want of a wife" 译成「必须缺少妻子」。保存时翻译生成的对照译文质量以此为准，产品文案不要承诺高质量文学翻译。
- `inputQuota` 在 Chrome 155 上是 `undefined`（规范里有这个属性），没法事先查单次输入上限；长文按段切分即可（见第 6 节）。

## 5. 网络请求与断网（A2、A3）

**断网复测**（同一 profile，所有外网请求被不可达代理挡掉）：en↔zh、en→ja、zh-Hant→en、en→fr 单句翻译，en→zh 流式翻译，语言检测，30 段长文（0 失败），全部成功，译文与在线时一致。netlog 里这一轮的 20 个外网请求全部以 `ERR_PROXY_CONNECTION_FAILED` 失败，成功的只有访问本机测试页的 2 个。→ **A2 满足。**

**在线时各阶段的外部主机**（netlog 按阶段切分）：

| 阶段 | 外部请求 |
|---|---|
| 下载语言包（C） | `update.googleapis.com`（组件更新检查）、`edgedl.me.gvt1.com` / `*.gvt1.com`（组件包下载）、`optimizationguide-pa.googleapis.com`（语言检测模型）等 |
| 逐对翻译、流式、语言检测（D） | `update.googleapis.com`、`edgedl.me.gvt1.com`：组件更新器在下载其他组件（版本号 `2026.10.12.1` 等，不是 TranslateKit 的 `2024.x`），都是 GET 静态组件包 |
| 长文翻译，两遍共约 6.5 万字符（F） | **没有任何外部请求** |
| 其余阶段 | `safebrowsing.googleapis.com`、`android.clients.google.com`（推送注册）、`beacons.gcp.gvt2.com`、新标签页相关的 `www.google.com` 等 Chrome 常规后台流量，启动时就有 |

全程没有出现任何翻译服务的地址（如 `translate.googleapis.com`）。翻译阶段出现的请求都是 Chrome 组件更新器与常规后台流量，在不翻译的阶段同样出现，内容是下载静态组件包，不可能携带待译文字；最长的翻译阶段（F）没有一条外部请求；断网时翻译照常。→ **A3 满足。**

隐私页措辞可以写：翻译在本机完成，文字不会发给任何服务；第一次使用某个语言时，Chrome 会从 Google 下载该语言的翻译模型（约 80 MB），之后不需要联网。

## 6. 长文与流式（B4、B5）

| 方向 | 段数 | 输入 | 输出 | 总耗时（两遍） | 单段耗时 中位 / 最大 | 失败 |
|---|---|---|---|---|---|---|
| en → zh | 123 | 27,572 字符（约 5000 词） | 8,599 字 | 1,606 / 1,598 ms | 9–10 / 51 ms | 0 |
| zh → en | 46 | 5,146 字 | 18,043 字符 | 1,038 / 1,045 ms | 19 / 81 ms | 0 |

- 两遍耗时相差不到 1%，输出完全相同。
- 测试机是 M4 Max，速度只代表高配机；配置低的电脑会慢，但按这个量级，保存时翻译不会成为瓶颈。分段大小用段落即可。
- `translateStreaming()` 确实分多次返回：英译中 12 段返回 12 块（约每段一块，85 ms 结束）；中译英 8 段返回 38 块（约每句一块，319 ms 结束），第一块 7–10 ms 就到。阅读器里可以边出边显示。

## 7. 最低 Chrome 版本（B6）

官方文档（developer.chrome.com/docs/ai/translator-api 与 language-detection）的浏览器支持写 Chrome 138；chromestatus 的状态字段看起来没更新（仍写 Origin trial），以文档为准。本次只测了 155，**138–154 没有实测**。建议 manifest 设 `minimum_chrome_version: "138"`，并在代码里先检测 `'Translator' in self`，没有就把翻译功能灰掉，不报错。

## 对后续票的影响

- **ALAG-25（翻译层与 offscreen）**：
  - 照 ADR-0011 在 offscreen 文档里翻译；不要放进 Worker。
  - 首次使用某语言时要在扩展页面（面板、选项页或阅读器）由用户点一下触发下载，并显示下载进度。
  - `NotSupportedError` 当作可重试错误处理。
  - 「选中翻译」由内容脚本把文字发给扩展、在 offscreen 里翻译，再把译文送回页面。
- **service worker 可直接翻译**这一点只在 155 上成立，与文档相反，不作为设计依据；以后若想去掉 offscreen，要先在最低版本上实测。
- **ALAG-29（云端引擎）**不受影响。
