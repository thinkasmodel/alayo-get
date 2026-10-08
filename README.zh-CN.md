# Alayo Get

[English](README.md) · 中文

Alayo Get 是一个 Chrome 扩展，把网页、X 帖子、链接、图片、视频和选中的文字存成普通的 Markdown 文件和媒体文件，写进你自己选的本地文件夹。

它和 Obsidian Web Clipper、MarkDownload 做的是同一类事，正文抽取用的也是 Obsidian Web Clipper 的引擎（[defuddle](https://github.com/kepano/defuddle)）。和它们以及 SingleFile 这类整页归档工具相比：

- **不绑定任何笔记软件。** 存下的是带 YAML frontmatter 的普通 Markdown，加上原始媒体文件，不预设你用哪个应用。
- **直接写进你选的文件夹。** 用 File System Access API 写入任意本地文件夹，不经过下载目录，每次保存也不弹保存对话框。
- **X 作者串合成一篇。** 保存帖子时，同一作者连续的自回复会被收集并合并成一篇文章。
- **媒体剪藏带着出处。** 图片、音视频文件和 PDF 原样保存，另有一个小的元数据侧档记录它们来自哪个页面。
- **摘录能跳回原文。** 选中的文字保存时带 `#:~:text=` 文本片段链接，点开回到原文对应位置。
- **中英双语界面。** 界面跟随浏览器语言：中文浏览器显示简体中文，其余显示英文。

**安装：** Chrome 应用商店 <!-- CWS_URL -->（即将上架），或[以开发者模式加载](#安装)。

## 保存什么，存成什么

每次保存在剪藏库里落下一个可见文件，叫一个**剪藏**。共五种：

| 形态 | 存下的内容 |
|---|---|
| **文章剪藏** | 网页正文（或 X 帖子、作者串、X 长文）转成 Markdown，图片下载到旁边。 |
| **书签剪藏** | 链接、标题、描述和封面图，不含正文。右键保存某个链接时存成这种；正文抽取失败的文章也退化成书签（`extract: fallback`）。 |
| **媒体剪藏** | 图片、音视频文件（100 MB 以内）或 PDF 本身，原样保存，命名为 `页面标题 - 原文件名.ext`。 |
| **流媒体剪藏** | 指向在线视频或音频（YouTube、B 站、X 视频、网盘分享页，或超过 100 MB 的直链）的一个 Markdown 文件：封面、时长、作者、简介和原链接。媒体本体不下载。 |
| **摘录剪藏** | 你选中并保存的文字。同一页面的摘录都追加到同一个 `摘录 - 页面标题.md`，每条是一个 blockquote，带保存时间和跳回原文的链接。 |

入口有三个：工具栏面板、右键菜单（整页、链接、图片、视频、音频、选中文字）、快捷键 `Alt+Shift+S`。保存后可以补标题、标签和批注。

剪藏库的布局：

```text
你的剪藏库/
├── 某篇文章的标题.md
├── @作者 - 正文前几个字.md
├── 页面标题 - photo.jpg
├── 摘录 - 页面标题.md
├── .assets/<id>/      文章、书签、流媒体剪藏用到的图片和封面
└── .meta/<id>.json    媒体剪藏的元数据侧档（出处页面、媒体地址、标签、批注）
```

所有剪藏平铺在根目录，不按日期分子目录。Markdown 剪藏的 frontmatter 含 `id`（ULID）、`source`（规范化 URL）、`medium`、`title`、`author`、`published`、`captured`、`site`、`tags`、`note`、`extract`。两个辅助目录以点开头，macOS 和 Linux 默认隐藏；Windows 资源管理器会显示。

## 隐私

你保存的一切只写进你选定的本地文件夹，不上传到任何地方。扩展没有账号、没有统计、没有遥测，只在你保存的那一刻访问你正在保存的内容所在的网站。完整政策：[alayo.ai/zh/get/privacy](https://alayo.ai/zh/get/privacy)。

## 存下来之后怎么用

它们是普通的 Markdown 和媒体文件，任何编辑器、笔记软件、文件管理器或脚本都能读。

如果你在用 Mac 应用 [Alayo Workbench](https://alayo.ai/zh/workbench/)，可以把剪藏库文件夹加为监控目录。新剪藏会出现在 Workbench 里，一个剪藏对应一张卡，可以在画布上整理。这是可选的；扩展的设置页有一个默认收起的小节说明怎么接。

## 安装

**Chrome 应用商店：** <!-- CWS_URL --> 即将上架。

**开发者模式加载未打包扩展：**

1. `npm i`，然后 `npm run build`。
2. 打开 `chrome://extensions`，打开右上角的**开发者模式**。
3. 点**加载已解压的扩展程序**，选择 `.output/chrome-mv3` 目录。

首次安装时扩展会打开设置页，在那里选剪藏库文件夹。浏览器重启后，Chrome 会再要求一次访问该文件夹的授权；选「每次访问时都允许」，之后保存就不再询问。

扩展按 Manifest V3 编写，其他 Chromium 系浏览器应该也能用。

## 开发

需要 Node.js 22 或更高版本。

```sh
npm i                 # 安装依赖（同时跑 `wxt prepare`）
npm run dev           # 开发构建，带热重载
npm run build         # 生产构建，输出到 .output/chrome-mv3
bash verify.sh fast   # 类型检查 + lint + 单元测试
bash verify.sh full   # fast + 生产构建 + manifest 检查
```

- 测试分两套 Vitest 环境（见 `vitest.config.ts` 的注释）：`*.test.ts` 在 Node 里跑，覆盖 service worker 一侧，误用 DOM 会在这里失败；`*.dom.test.ts` 在 jsdom 里跑，覆盖页面一侧（抽取、Markdown 转换）和扩展页面。
- 界面与文件里的文案在 `public/_locales`（`en`、`zh_CN`、`zh_TW`）。
- 源码注释是中文。

提 pull request 前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 文档

- [`CONTEXT.md`](CONTEXT.md)：领域词汇表（剪藏库、剪藏、五种剪藏形态等）。
- [`docs/adr/`](docs/adr/)：架构决策记录。
- [`DESIGN.md`](DESIGN.md)：界面设计规则与令牌。
- [`docs/PRD.md`](docs/PRD.md)：产品需求。

## 许可证

[Apache License 2.0](LICENSE)。Copyright 2026 ThinkAsModel Limited。第三方组件见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。
