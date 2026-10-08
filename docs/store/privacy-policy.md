# Alayo Get — Privacy Policy / 隐私政策

Canonical copy of the policy text. The public page lives at `https://alayo.ai/en/get/privacy` and `https://alayo.ai/zh/get/privacy` (NKS-663); the Chrome Web Store listing links to the English page. Facts below were checked against the source on 2026-10-08 (ALAG-12): network hosts in `src/`, storage use in `src/io/`, tag suggestions in `src/sw/saveClip.ts`.

---

## English

**Alayo Get Privacy Policy**

Effective date: 2026-10-08
Publisher: ThinkAsModel Limited · hello@alayo.ai

Alayo Get is a Chrome extension that saves web pages, posts, links, images, videos and selected text as plain Markdown and media files in a folder on your computer. It is built so that your data stays with you.

**What the extension does with your data**

- Everything you save is written to one local folder that you choose when you first set up the extension. Nothing is uploaded anywhere.
- The extension has no account, no sign-in, no cloud sync, no analytics, no telemetry and no crash reporting. We never receive, see or store what you save.
- The extension never sends any data to ThinkAsModel Limited, to Alayo servers, or to any third-party service.

**What is stored on your device**

Inside the extension's own storage (not in your library folder) it keeps:

- a handle to the library folder you chose, so it can write there without asking every time;
- a record of what has been saved: the source URL, the file name, the title, tags and notes you added, and the time of saving. This is used to show recent saves and to tell you when a page was already saved;
- short-lived session data used while a save is in progress.

You can clear all of this by removing the extension. The files in your library folder are ordinary files and are not affected.

**Network requests the extension makes**

The extension only talks to the sites whose content you are saving. Specifically, and only when you trigger a save, it may:

- read the page that is open in the current tab;
- fetch the target page of a link you right-clicked, to get its title and description;
- fetch a video page (for example on YouTube or Bilibili) to get its title, author, duration and cover image;
- download images, cover images, PDFs or media files referenced by the page into your library folder;
- send a lightweight request to check the size of a media file before downloading it.

These requests go to the original websites and their content servers, exactly as if you had opened those addresses in your browser. The extension does not add tracking parameters or identifiers.

**Permissions**

- *Access to all websites*: needed because you can save any page, and because images, link targets and video pages live on arbitrary domains. The extension only uses this access when you ask it to save something.
- *Scripting and tabs*: used to read the content of the current tab and to run the content-extraction code on the page you are saving.
- *Storage*: used for the local records described above.
- *Context menus*: used to add the "Save to Alayo Get" items to the right-click menu.

**Children**

The extension is not directed at children and does not collect personal information from anyone.

**Changes**

If this policy changes, the updated text will be published at this address with a new effective date.

**Contact**

ThinkAsModel Limited · hello@alayo.ai

---

## 中文

**Alayo Get 隐私政策**

生效日期：2026-10-08
发布者：ThinkAsModel Limited（思模科技有限公司）· hello@alayo.ai

Alayo Get 是一个 Chrome 扩展，把网页、帖子、链接、图片、视频和选中的文字保存成普通的 Markdown 文件和媒体文件，放进你电脑上的一个文件夹。它的设计前提是：你的数据只属于你。

**扩展怎样处理你的数据**

- 你保存的一切都写进你首次设置时选定的那个本地文件夹，不上传到任何地方。
- 扩展没有账号、没有登录、没有云同步、没有统计分析、没有遥测、没有崩溃上报。我们收不到、看不到、也不保存你存了什么。
- 扩展不会向 ThinkAsModel Limited、Alayo 服务器或任何第三方服务发送任何数据。

**保存在你设备上的内容**

扩展自己的存储空间（不是你的剪藏库文件夹）里保存：

- 你选定的剪藏库文件夹的访问句柄，用来免去每次写入都要重新选择；
- 已保存记录：出处网址、文件名、标题、你加的标签和批注、保存时间。用于显示最近保存，以及提示某个页面已经存过；
- 保存过程中用到的短期会话数据。

卸载扩展即可清除上述全部内容。剪藏库里的文件是普通文件，不受影响。

**扩展发出的网络请求**

扩展只和你正在保存的内容所在的网站通信。具体来说，只在你触发保存时，它可能：

- 读取当前标签页里打开的页面；
- 抓取你右键点击的链接所指向的页面，取标题和描述；
- 抓取视频页面（例如 YouTube、B 站），取标题、作者、时长和封面；
- 把页面引用的图片、封面、PDF 或媒体文件下载到你的剪藏库；
- 在下载前发一个轻量请求查询媒体文件的大小。

这些请求都发往原网站及其内容服务器，和你在浏览器里直接打开这些地址没有区别。扩展不会附加任何跟踪参数或标识。

**权限说明**

- *访问所有网站*：因为你可以保存任何页面，而图片、链接目标和视频页分布在任意域名上。扩展只在你要求保存时才使用这项权限。
- *脚本注入与标签页*：用于读取当前标签页的内容，并在你要保存的页面上运行正文抽取代码。
- *存储*：用于上文所述的本地记录。
- *右键菜单*：用于在右键菜单里加入「保存到 Alayo Get」等项目。

**未成年人**

本扩展不面向儿童，也不收集任何人的个人信息。

**变更**

本政策如有变更，更新后的文本会连同新的生效日期发布在本页面。

**联系方式**

ThinkAsModel Limited（思模科技有限公司）· hello@alayo.ai
