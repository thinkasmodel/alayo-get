# Issue tracker: Linear

本仓 issue / 需求 / 进度 / 状态的**唯一权威源是 Linear**。所有操作经 Linear MCP
工具（`list_issues` / `get_issue` / `save_issue` / `save_comment` /
`list_issue_labels` / `create_issue_label` 等）。不使用 `.scratch/` 本地 issue，
不用 `gh issue create`。

## 坐标

- **Team**：`Alayo Get`（key **ALAG**）→ issue 形如 `ALAG-12`
- **Project**：`Alayo Get`（`P-ALAG-18`，探索期唯一 project）
- **里程碑**：暂无。项目处 wayfinder 探索期，版本里程碑待 `/to-spec` 后再建。

## 与 git / PR 的关系

默认分支 `main`，远端 GitHub `thinkasmodel/alayo-get`（公开仓，ADR-0007）。分支名用票号（`alag-12`），
提交信息带票号；收尾开 PR，PR 描述里写票号，合并后在票的完成摘要里写 commit 哈希与实际结果。
GitHub Issues 只作外部报告入口：收到后在 Linear 建对应票（标题前缀 `GH#<n>`，描述贴链接），
按 `docs/agents/triage-labels.md` 打 `needs-triage`，Linear 仍是唯一权威源。

## 当 skill 说「publish to the issue tracker」（建 issue）

铁律：**先 issue 再开工**。用 `save_issue` 新建，必带：

- `team` = `Alayo Get`
- `project` = `Alayo Get`
- 子 issue 带 `parentId`

issue 描述里贴本仓文档的**相对路径链接**，不把细节全文搬进 Linear。

## 当 skill 说「fetch the relevant ticket」（取 issue）

用 `get_issue`（传 `ALAG-N` 或 issue id）+ `list_comments` 取评论。

## 状态流转

`Backlog` → `Todo` → `In Progress` → `In Review` → `Done`。
探索期决策票据只用三态：`Todo`（开放）→ `In Progress`（已认领）→ `Done`（已解决）。

## Wayfinding operations

wayfinder skill 的地图与票据在本仓这样表达：

- **地图**：team `Alayo Get` 下的一个 issue，label `wayfinder:map`，挂 project
  `Alayo Get`。地图正文即 skill 定义的 map body。
- **票据**：地图的**子 issue**（`parentId` = 地图）。类型 label 用
  `wayfinder:research` / `wayfinder:prototype` / `wayfinder:grilling` / `wayfinder:task`。
- **标签创建**：上述标签在 team 下不存在时，用 `create_issue_label` 创建一次后复用。
- **认领**：`save_issue` 置 `assignee` = `me`，同时 state → `In Progress`。
  开放且无 assignee = 未认领。
- **Blocking**：用 Linear **原生关系**——`save_issue` 的 `blocks` / `blockedBy`
  字段（追加式；解除用 `removeBlocks` / `removeBlockedBy`）。
- **Frontier 查询**：`list_issues`（parent = 地图，开放状态，无 assignee），再剔除
  仍有未关闭 blocker 的票据。
- **解决**：答案以 resolution comment 发到票据（`save_comment`）→ 票据 close
  （state → `Done`）→ 地图正文「Decisions so far」用 `patch` 追加一行
  `[票据标题](url) — 一行答案要旨`。
- **引用规范**：面向人的叙述里用**票据标题包链接**，不裸写 `ALAG-N`。

## 外部 PR 作为 triage 入口

**否。** 本仓 PR 不是需求入口；需求一律在 Linear 建 issue。`/triage` 不拉 PR。
