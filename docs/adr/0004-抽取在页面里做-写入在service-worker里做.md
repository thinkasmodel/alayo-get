# ADR-0004：正文抽取和 Markdown 转换在页面里做，下载和写入在 service worker 里做

- **状态**：已采纳
- **日期**：2026-10-06

## 决策

保存一次剪藏要用到扩展的三处运行环境，分工如下：

| 环境 | 负责 |
|---|---|
| **页面内的采集脚本**（运行时用 `scripting.executeScript` 注入，不在 manifest 里常驻） | 用 Defuddle 抽正文；用 Turndown 转 Markdown；收集页面元数据和图片地址；显示页面右下角提示 |
| **service worker** | 下载图片和封面；判断是否已存过；写文件；维护已保存记录；处理快捷键、右键菜单和角标；持有面板草稿，面板关闭时写入 |
| **扩展页面**（工具栏面板、选项页） | 显示界面。选目录（`showDirectoryPicker`）和恢复授权（`requestPermission`）**只在选项页里做** |

另外两条：

- 右键保存链接时，service worker 在后台抓目标页。它没有 DOM，所以用纯文本解析 `<title>`、`og:*` 和 `description`，不用 `DOMParser`。
- 需要重新授权时：
  1. 先完成抽取，把这次要写的内容暂存进 `chrome.storage.session`；
  2. 用户在选项页授权；
  3. 授权成功后，service worker 把暂存的内容补写进文件。

## 理由

- **Turndown 需要 DOM**。它的浏览器版用 `DOMParser` 或 `document.implementation.createHTMLDocument` 解析 HTML（`turndown.browser.es.js:450-496`），service worker 里两者都没有。Defuddle 也要读页面的 `document`。所以抽取和转换只能在页面里做。
- **service worker 可以直接写文件**。M0 实测，授权为“每次访问时都允许”后，service worker 写入成功（ADR-0001）。有了 `host_permissions`，它下载图片不受 CORS 限制。
- **恢复授权只在选项页里做**。M0 只在扩展标签页里验证过 `requestPermission`。从工具栏面板发起时，浏览器的授权询问框可能让面板失去焦点并关闭，授权结果就没人接收了。面板上的“授权并保存…”按钮改为打开选项页。
- **先抽取再检查权限**。这样用户授权期间即使离开了原页面，这次保存也不会丢。

## 考虑过的方案

- **offscreen document 跑 Turndown**：service worker 就能拿到 DOM，但要多维护一个页面和一套消息往返。M0 已决定不启用 offscreen，内容在页面里转换就够用。
- **content script 在所有页面常驻**：快捷键响应会快一点，但每个页面都要加载 Defuddle 和 Turndown，开销不划算。按需注入就够了。
- **在面板里直接恢复授权**：少跳一次页面，但面板可能在询问框弹出时关闭，这一点没有实测过，不冒这个险。

## 后果

- Chrome 不允许注入的页面（`chrome://`、Chrome 网上应用店、PDF 查看器等）无法抽取。这些页面只能存成书签剪藏，标题取标签页标题。
- 测试按运行环境分开：service worker 一侧的模块在 Vitest 的 `node` 环境里测，这样误用 DOM 的代码会在测试里暴露；页面一侧的模块在 `jsdom` 环境里测。
