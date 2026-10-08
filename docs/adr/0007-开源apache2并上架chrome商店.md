# ADR-0007：以 Apache-2.0 开源，并上架 Chrome Web Store

- **状态**：已采纳
- **日期**：2026-10-08（ALAG-9，用户决定）
- **修订**：PRD §2 Q1「只给产品所有者自用，不上架商店」。ADR-0001 的"只写文件系统、不调 API"与 ADR-0005 的"面向通用用户"不变，本决定是它们的自然延伸。

## 决策

1. **开源**：仓库以 Apache-2.0 许可证公开在 GitHub `thinkasmodel/alayo-get`，版权主体 ThinkAsModel Limited。
2. **上架**：以 ThinkAsModel Limited 为发布者，把扩展发布到 Chrome Web Store。先以 unlisted 可见性提交审核；PRD Q9 的两周自用验收达标后切 public。
3. **公开范围**：`CONTEXT.md`、`docs/adr/`、`DESIGN.md` 和脱敏后的 `docs/PRD.md` 随仓库公开。`handoffs/`、`logs/`、`tasks/` 留在本地不再版本化；`docs/research/ALAG-1-evidence/` 与 `experiments/` 删除。PRD 里 Alayo Notes 的路线图细节不公开；对外导流只提 Alayo Workbench。
4. **历史**：公开前用 orphan 分支重打一个初始提交，旧历史留在本地归档分支。
5. **隐私政策**：托管在 alayo.ai（`/{lang}/get/privacy`），不用 GitHub Pages。

## 理由

- 目的有两个：产品所有者的个人影响力，以及给 Alayo 其他产品导流。两者都要求代码和商店页公开可见。
- 选 Apache-2.0 而不是 MIT：自带商标条款和专利授权，与 Alayo 品牌同行更稳妥；名字和图标靠商标保护，不靠许可证。
- 不选 AGPL：能挡商店克隆，但代价是传播面，对靠导流的工具不划算。
- 先 unlisted：`<all_urls>` + `scripting` + `tabs` 会触发深度审核，首发尤其慢；把审核和自用验收并行，两条线不互相卡。
- 重写历史而不是逐文件清理：98 个提交全含私人路径与过程文件，这个阶段历史价值低，orphan 初始提交最省事。

## 后果

- 商店审核要求每项权限写用途说明、填隐私实践表、提供可访问的隐私政策 URL。扩展只写本地文件、不向任何服务器传数据，照实填。
- README 第一屏必须回答与 Obsidian Web Clipper、MarkDownload、SingleFile 的差异（抽取引擎同为 defuddle）。导流段放在 README 和商店页的"文件存下来之后怎么用"，不在扩展内弹提示。
- 源码注释保持中文；README、CONTRIBUTING、商店文案英文优先。
- 测试夹具 `tests/fixtures/x/*.html` 带抓取账号侧栏，公开前剪裁。
- `experiments/` 删除时把 ALAG-8 的真机探针保留为 `scripts/alag-8-image-probe.mjs`（它是 Defuddle 图片路径唯一的端到端探针）；`docs/research/` 的实测记录去掉本机路径后保留，ALAG-1 的证据文件不入库。
- 以后发版可用 `wxt zip` / `wxt submit`，需在开发者控制台填 Google Cloud 服务账号。

## 考虑过的方案

- **继续只自用**：零成本，但两个目的都达不到。
- **只开源不上架**：用户要开发者模式手动加载，门槛高，导流效果差。
- **只上架不开源**：少了"工程判断可见"这条影响力来源，也少了 ADR 轨迹的展示价值。
- **直接 public 上架，不走 unlisted**：审核与自用验收串行，首发时间被审核拖住。
