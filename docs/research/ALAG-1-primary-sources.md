# ALAG-1：一手资料与实测边界

日期：2026-10-06。范围：M0 的 FSA、临时文件、X 媒体跨域和正文抽取选型。已对照 `CONTEXT.md`、`docs/PRD.md`、ADR-0001～0003。**正文记录文档、规范和源代码调查；附录仅含 curl 连通性探针，不是 MV3/Workbench 实测回执，也不关闭 M0 验收。**

## 1. FSA：保存句柄不等于保存授权

- `FileSystemDirectoryHandle` 可存入 IndexedDB；读回句柄后仍须检查 `queryPermission({mode:'readwrite'})`。Chrome 122 开始提供“每次访问都允许”的持久授权；Chrome 120/121 需实验开关。首次选择目录、下一次访问恢复句柄和用户选择持久授权是不同步骤。[Chrome 持久授权说明](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
- 官方说明中的“已安装应用自动持久授权”不能直接解读成“已安装扩展”。Chromium `OriginHasExtendedPermission` 在没有显式设置时查询 Web App 安装状态，并非检查扩展已安装；源码另有 popup/side panel 缺少 permission request manager 时的单次自动授予分支。这不能证明重启持久性。[权限实现：L1113、L3776](https://github.com/chromium/chromium/blob/c50cbaca28ae90f203498eaa8b4ce6b5a121f4da/chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc#L3776)
- 目录选择器属于 `Window`；需要 transient user activation。需要弹出新授权的操作应放在可见扩展页的用户点击处理器内。[FSA 规范](https://wicg.github.io/file-system-access/#api-showdirectorypicker)
- Chromium 在 worker 内遇到待询问状态时直接返回当前权限，不会弹出提升权限的提示。因此“worker 从 IndexedDB 读回 handle 后能写”与“worker 能重新授权”必须分开判断。[`DoRequestPermission`：L201–210](https://github.com/chromium/chromium/blob/c50cbaca28ae90f203498eaa8b4ce6b5a121f4da/content/browser/file_system_access/file_system_access_handle_base.cc#L201)
- Offscreen document 自 Chrome 109 提供；不能获得焦点，扩展 API 只开放 `runtime`，但可使用 Web DOM API。其继承扩展权限的描述不等于 FSA 用户授权在重启后必定有效；也不能把隐藏文档当作用户授权入口。使用 `runtime.getContexts()` 检查 offscreen 存在性需要 Chrome 116。[Offscreen 官方参考](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

**M0 操作建议（待实测）**：在同一 Chrome profile、相同扩展 ID 下，以可见扩展页选择 `~/Documents/Alayo Get/` 并把 handle 存入 IndexedDB。分别记录首次写、关闭全部扩展页后写、service worker 停止再唤醒后写、完全退出并重启浏览器后写。每步记录扩展页/SW/offscreen 各自的 permission、错误名和磁盘结果；重启后的首次尝试先只 query+write，避免先 requestPermission 掩盖授权丢失。未授予时再测试可见页面点击重新授权。浏览器重载、扩展 Reload 和关闭一个标签都不能代替完整浏览器重启。

**版本边界**：Chrome 122 是网页持久授权特性的起点，不是本扩展已验证的最低可用版本。应以目标机器实际 Chrome 版本和上述矩阵确定支持范围。所引 Chromium 固定提交 `c50cbaca…` 是查阅时的 main 源码，不保证已进入本机 Stable。PRD 提及的 [352252531](https://issues.chromium.org/issues/352252531) 本次未能读取正文，不能用其编号推断当前修复状态。

## 2. `.crswap`：文件系统事实与 Workbench 界面事实分开

Chromium 的文件写入器先生成目标文件的同目录兄弟文件，名称为 `文件名.ext.crswap`，冲突时可带数字后缀；macOS 走同目录路径。`close()` 等待写入结束后通过 safe move 把临时文件替换到目标位置。[创建临时文件：L712–745](https://github.com/chromium/chromium/blob/c50cbaca28ae90f203498eaa8b4ce6b5a121f4da/content/browser/file_system_access/file_system_access_file_handle_impl.cc#L712)、[close 实现：L267–293](https://github.com/chromium/chromium/blob/c50cbaca28ae90f203498eaa8b4ce6b5a121f4da/content/browser/file_system_access/file_system_access_file_writer_impl.cc#L267)

**推断**：`文章.md.crswap` 不是点开头隐藏文件，因此仅排除隐藏目录不足以屏蔽它。**待实测**：保持 writable 打开数秒，观察磁盘与 Workbench“待纳入”，再 close/abort；记录正常小文件快速写入和故意延迟写入两种结果。目录里看见临时文件、源码没有排除后缀，都不能单独证明 Workbench 曾显示它；本研究不据此建立 Workbench 修复票。

## 3. X 的媒体下载与请求头

扩展 service worker/扩展页面在获得对应 `host_permissions` 后可跨域 fetch；content script 仍受页面跨域限制。实验应最小声明 `https://pbs.twimg.com/*` 与 `https://video.twimg.com/*`，在扩展上下文请求。[Chrome 跨域请求文档](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

没有找到 X 官方对这两个 CDN “必须设置 Referer/特定 UA”或“永远不需要”的保证。`host_permissions` 解决浏览器侧访问权限，不决定 CDN 的鉴权、签名 URL、过期或反盗链策略。**结论保持待实测**，不把其他平台的 Referer 要求套到 X 上。

Fetch 标准把 `Referer` 列为 forbidden request-header；`referrer` 参数也只接受同源 URL、空字符串或 `about:client`，所以不能把 `headers: {Referer:'https://x.com/'}` 当作有效兼容方案。[Fetch forbidden headers](https://fetch.spec.whatwg.org/#forbidden-request-header)、[Request 初始化](https://fetch.spec.whatwg.org/#dom-request)

**M0 操作建议（待实测）**：使用从真实 X 页面 DOM 得到的资源 URL，先测试浏览器默认 UA、未自定义 Referer、`credentials:'omit'` 的基线。分别保留 HTTP 状态、重定向后 URL、MIME、完整响应字节数和落盘结果；200 空响应或只取得响应头不算下载通过。若失败，先区分 URL 已过期、404/403、网络错误与权限错误，再决定是否需要请求头实验，并记录真实发出的头，不能只记录 JS 请求参数。视频只验证已有直链的下载能力，不扩展为解析流媒体或调用 X API。

## 4. Defuddle / Readability / Turndown

| 维度 | 一手资料结论 | M0 含义 |
|---|---|---|
| Defuddle | 主体抽取返回 HTML 与较丰富元数据；标准化脚注、代码、数学内容，提供浏览器 core/full 与 Node 入口；README 仍标 work in progress。[README](https://github.com/kepano/defuddle/blob/f70d689675831147ce92f5cf48e60330d9bdd04a/README.md) | 保留结构可能更好属于作者设计目标，不能代替 10 篇文章对比。 |
| Defuddle 网络边界 | `parseAsync()` 在本地内容不足时可使用第三方 API；README 列明 X Articles 的 FxTwitter fallback，`useAsync` 默认为 true。[Third-party services](https://github.com/kepano/defuddle/blob/f70d689675831147ce92f5cf48e60330d9bdd04a/README.md#third-party-services) | 对比显式 `useAsync:false`，避免正文效果来自额外抓取；ADR-0003 禁止的接口 fallback 不能带入产品。 |
| Readability | Firefox Reader View 的独立库；`parse()` 修改传入 DOM，返回 HTML/正文/标题/作者等，也支持 JSON-LD 元数据。[README](https://github.com/mozilla/readability/blob/ab4027a8b37669745016869a37a504727992b2ba/README.md) | 每次使用独立 DOM 副本，并设置原始 URL；不能拿被前一抽取器修改的 DOM 给后一抽取器。 |
| Turndown | 负责 HTML→Markdown，不负责识别正文；支持规则和插件。默认标题是 setext、代码块是 indented，需统一选项。[README](https://github.com/mixmark-io/turndown/blob/aa84dfa3e2361edea8c43acbfc2b7a9363494bfd/README.md) | 两个抽取器输出都进入同一 Turndown 配置；表格等扩展须统一插件，避免转换器差异冒充抽取差异。 |

**对比方法（待实际结果）**：锁定依赖版本，给两种抽取器相同的 10 份真实文章 HTML 和出处 URL；两边都禁止样本内脚本执行和远程 fallback。逐篇评估正文完整度、导航/推荐混入、标题层级、列表/引用/代码/表格、图片 URL、作者/日期。保存 HTML 和 Markdown 两阶段产物，区分抽取丢失与转换丢失。以已保存 HTML 的运行不证明登录页面 DOM、懒加载图或移动样式在真实浏览器里的效果；公众号、Substack、Medium 应保留真实页面验收项。


## 附录：可复用的视频直链样本（仅 curl 探针）

2026-10-06，从公开仓库 [Kikobeats/twdown README](https://github.com/Kikobeats/twdown#readme) 的真实输出示例读取以下完整 URL；没有调用 X API、运行该仓库下载逻辑或猜测路径：

```text
https://video.twimg.com/amplify_video/943561675927519232/vid/240x240/mijiQdCq-p9FaO8H.mp4
```

本机执行完整 GET（响应写 `/dev/null`，不是 HEAD），使用 curl 默认 UA，没有手动设置 Referer 或 Cookie：

```sh
curl --location --max-time 45 --silent --show-error --output /dev/null \
  --write-out 'status=%{http_code}\ncontent_type=%{content_type}\nbytes=%{size_download}\nurl=%{url_effective}\n' \
  'https://video.twimg.com/amplify_video/943561675927519232/vid/240x240/mijiQdCq-p9FaO8H.mp4'
```

结果：退出码 `0`，HTTP `200`，`video/mp4`，`3755226` 字节，最终 URL 未变。这只证明此次 curl 可读取完整响应；MV3 host_permissions、SW fetch、媒体落盘和解码仍需分别实测。公开 GitHub 样本仅作为 URL 出处，不作为 X 的请求头策略保证。
