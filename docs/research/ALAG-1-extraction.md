# ALAG-1：Defuddle / Readability 正文抽取对照

日期：2026-10-06（Asia/Shanghai）。本项为 M0 技术验证；不是扩展功能交付，也不是用户人工验收。

**建议 M1 默认采用 Defuddle 0.19.4 的同步 DOM 抽取，接相同 Turndown。** 本次保留原 10 篇并追加 1 篇 Medium，共 11 篇真实文章、22 份 Markdown；Defuddle 在微信懒加载图片和 Substack 标题层级上有直接优势。它仍会漏旁注或带入网页边栏，不能以“非空”判定 `extract: full`。Medium 自动化抓取曾被拦；随后普通 Chrome 的 CUA 新标签正常加载公开全文，完成补测。六类均有真实样本，但“有覆盖”不代表抽取质量全部通过。

## 实验边界与可复现证据

- 实验脚本与步骤（实验脚本未入库）、样本 URL（实验脚本未入库）、抓取回执（实验脚本未入库）、抽取统计与 SHA-256（实验脚本未入库）。文章全文仅在被 ignore 的本地 `outputs/`，不提交。
- Node 24.19.0、JSDOM 26.1.0、Defuddle 0.19.4、@mozilla/readability 0.6.0、Turndown 7.2.4，版本及传递依赖由独立 package-lock 锁定，不改根项目依赖。
- 普通网页为 curl 实际响应 HTML；两篇微信为 Playwright 1.58.2 + 独立 headless Chrome 154.0.8037.93 在 DOMContentLoaded 后 3 秒的 DOM。两条管线得到同一输入的独立副本，未为某个库单独清洗 DOM。Medium 为普通 Chrome 的 CUA 新研究标签中只读保存的完整 DOM（258,326 bytes，17 个源代码块），可见 Sign in、未进行登录或验证；HTTP 状态无法直接取得，回执记 null，不推断200。它不是所有站点都经过相同渲染/滚动后的对照；动态内容仍有局限。
- `new Defuddle(document, {useAsync:false}).parse()`；Readability 用默认 `parse()`。两者的 HTML 均用 `new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced'})` 转换，不使用 Defuddle 自带 Markdown 转换或异步/外站 fallback，遵守 ADR-0003。
- 对照方式：逐篇检查源 HTML 的正文区域、章节起止、图片 `src` / `data-src`、代码和层级，再检查两份 Markdown 及差异。下面是代理完成的内容对照记录；没有将它冒充产品所有者 GUI 验收。正文区域选择器仅作为参考统计，不限制两种抽取器输入。
- 正文字符数、图片总数、标题总数不能单独衡量质量：菜单会增加字符/标题，懒加载占位图会增加图片，删除目录会减少字符却未删除正文。

## 11 篇有效样本逐篇对照（原10篇 + Medium补测）

D = Defuddle；R = Readability。图片数为 Markdown 图片链接数，括号内的限制是质量判读。代码数为 `<pre>` 块数，前10篇已核对 Markdown fence（包括 blockquote 内 fence）一一保留；Medium/Readability 出现转换失败，单独记录。H 是抽取 HTML 的 heading 数，源标题可另存 metadata，不要求正文重复 H1。

| 样本 / 来源 | 完整度与污染 | 图片 D / R | 代码 D / R | 层级与结论 |
|---|---|---:|---:|---|
| zh-blog-1：[Flex 语法](https://www.ruanyifeng.com/blog/2015/07/flex-grammar.html) | 两者保留开头、全部容器/项目属性至结尾；评论被排除 | 16 / 16 | 15 / 15 | H16 / H16，同源级别。原文有部分章节本身用 H3，两者照存；平手 |
| zh-blog-2：[Flex 实例](https://www.ruanyifeng.com/blog/2015/07/flex-examples.html) | 两者保留从骰子到流式布局；无评论混入 | 30 / 30 | 37 / 37 | H15 / H15，代码在引用块中仍为 fenced code；平手 |
| en-blog-1：[Inside .git](https://jvns.ca/blog/2024/01/26/inside-git/) | 两者正文及末尾参考均在。D 删除目录列表，但留下目录引导句；D 标题内 code 与前词粘连，并将代码 tab 转空格 | 1 / 1 | 13 / 13 | H15 / H15。R 较忠实，D 清理目录有小瑕疵 |
| en-blog-2：[How To Center a Div](https://www.joshwcomeau.com/css/center-a-div/) | 两者主线起止完整，但都删除 2 个实质性 `aside`（共 6 段，涉及逻辑属性及新居中方式），只能视为部分保留；交互演示不会成为交互 Markdown | 6 / 12（均覆盖同 4 个唯一图 URL） | 22 / 22 | D H12 清除标题锚点提示；R H13 带入标题链接提示及额外小标题。D 更干净但仍非全文 |
| wechat-1：[细胞图谱信息框架](https://mp.weixin.qq.com/s/Zt_hhPZP8WL4QsgjdbYa8Q) | 两者正文至论文 DOI 保留；D 额外带发布账号/时间信息 | 3 / 3（D 3 个真实 URL；R 仅 1 个真实 URL + 2 个 data 占位图） | 0 / 0 | 源无语义 heading，两者 H0；D 能恢复 `data-src`，优于 R |
| wechat-2：[hECA](https://mp.weixin.qq.com/s/Sl8tpD0UlewmuL2ZRSyHQg) | 两者保留研究说明、配图说明及 DOI；仍含出版社推广/二维码。D 还带视频不支持提示、底部目录文字 | 14 / 24（D 14 个真实 URL；R 4 个真实 URL + 20 个占位图） | 0 / 0 | 源用加粗段落排版，两者 H0；D 图片可用性更好，数量差含装饰/重复/推广图清理，不代表仅14/25正文召回 |
| substack-1：[Git 与 ChatGPT](https://presentofcoding.substack.com/p/writing-code-you-need-git-and-chatgpt) | 两者段落至末尾均在；D 去掉订阅提示，R 末尾残留无文章提示 | 3 / 3 | 0 / 0 | 源 H2×4；D 4 个全保留，R 4 个全丢。D 胜，但图像 URL 选了 w424 版本，R 为 w1456，需在附件下载时选原图 |
| substack-2：[Colophon](https://mostlypython.substack.com/p/colophon) | 两者正文、代码、脚注保留；D 作者为 Eric Matthes，R 作者返回刊物名 | 2 / 2 | 4 / 4 | 源 H3×3/H5×7；D 全保留，R 丢 3 个 H3，仅余 H5。D 胜 |
| news-1：[日本月球着陆报道](https://www.theguardian.com/science/2024/jan/19/japan-slim-spacecraft-lands-on-moon-but-struggles-to-generate-power) | 两者正文至末段保留；D 还留封面说明/副标题 | 1 / 0 | 0 / 0 | 正文无小节标题，两者 H0；D 保存封面，较符合剪藏目的 |
| news-2：[复旦10月科研成果](https://news.fudan.edu.cn/2025/1124/c31a147457/page.htm) | R 正文字符与 `.wp_articlecontent` 参考完全一致；D 多 552 个字符，带入栏目、排行、联系方式等外层污染 | 31 / 31 | 0 / 0 | 源正文没有语义 heading；D H9 是外围标题，不能算优势；R H0。R 胜 |
| medium-1：[JavaScript Closures](https://medium.com/@imailtosamarth/javascript-closures-explained-for-5-yr-olds-and-senior-devs-alike-daa349e31297) | 两者所有源正文段落及末尾建议都保留；D 9076字符，R 8416字符，差值不能当无害清理：R删除代码注释。D去掉作者头像，R保留头像 | 0 / 1（源唯一图为作者头像） | HTML 17 / 17；Markdown fenced 17 / 0 | 两者H2×33都在；D将代码整理为pre/code，相同Turndown保留17个fence；R保留pre/span/br并产生p，转换后代码混入普通段落且注释丢失。D明显胜出；源码语言标签仍需另验 |

两篇中文博客的 D author 为空而 R 能取到作者；M1 不能只因选择 D 就假定所有元数据完整。微信 `data-src` 已被 D 提升为真实 URL **不等于下载已成功**。Substack 较小图片 URL、旁注丢失、正文污染均需保留为后续质量回归样本。

## 抓取限制单列

两篇微信 curl 均得到 HTTP 200 的验证码页，未拿验证页给抽取器打分。新建独立 Chrome context 正常导航后拿到文章 DOM（4.49 MB / 4.62 MB），因此采用浏览器 DOM 作为两库共同输入。这一微信获取路径未操作用户个人浏览器、未读取 cookie、未解验证码。

Medium 两篇公开文章（[样本一](https://medium.com/@imailtosamarth/javascript-closures-explained-for-5-yr-olds-and-senior-devs-alike-daa349e31297)、[样本二](https://medium.com/analytics-vidhya/javascript-closures-d27700d25c9f)）在 curl 与独立 Chrome 中均 HTTP 403，浏览器标题为 Cloudflare 的访问限制提示。额外尝试 Netflix 技术博客自定义域名也 403。这些是对应客户端的获取失败，最初没有抽取质量证据；后续CUA真实DOM才提供了下述补测证据。不能用搜索摘要、转载或合成 HTML 充当 Medium 原文实验。

补测：通过 CUA 在普通 Chrome 新标签直接打开 Medium 样本一，页面显示完整公开全文及 Sign in；未登录、未处理验证码。保存完整 DOM 后再次用同一离线双管线抽取，结果见上表。**现为每库11篇真实文章，包含全部六类；Medium原先的覆盖缺口已补齐。** 样本二仍403，不计入质量分母。普通Chrome和headless访问差异不能推广为所有用户都可访问。

## 选型与 M1 约束

选 Defuddle 同步 DOM + Turndown 的理由是本样本对剪藏重要的三类损失较少：微信正文图片占位符、Substack 小节层级、Medium 代码块与注释。保留 Readability 作为实验基线，不建议在 M1 默认串联两个库然后按输出长度选择；复旦样本已证明更长可能更脏。

M1 仍需在通用管线实现：图片 URL 绝对化与原图选择、媒体下载结果独立反馈、正文为空/验证码/付费墙时退回书签、对缺失正文证据标记 `partial`，不能把调用成功等价为 `full`。本实验没有建立自动判定所有缺失的可靠算法，也没有增加微信或 Medium 专用产品适配范围。

检查结果：`npm run check` 语法检查及 `npm run verify` 实验完整性检查通过。后者核对 11 个源 SHA-256、22 个 Markdown SHA-256、六类覆盖、图片结构及统计不含正文；Medium/Readability 的代码转换失败作为已知质量缺陷显式输出，因此该完整性检查通过不表示该输出质量通过。本实验为 JavaScript，不声称做过 TypeScript 产品 typecheck。最终仓级检查由主代理执行。

上游方法依据：[Defuddle 官方仓库](https://github.com/kepano/defuddle)、[Mozilla Readability](https://github.com/mozilla/readability)、[Turndown](https://github.com/mixmark-io/turndown)。实验结论来自上述已记录版本和真实输入，不能推广成所有站点/所有版本的成功率。
