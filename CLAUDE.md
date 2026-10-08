# Alayo Get — 项目规则

> 继承 workspace 级 CLAUDE.md（本机工作区根目录，不入库）；冲突时以本文件为准。

## 0. 坐标

- **Linear**：team「Alayo Get」（key **ALAG**），project「Alayo Get」（[P-ALAG-18](https://linear.app/thinkasmodel/project/alayo-get-70b77c7349ca)）。
- **Git**：默认分支 `main`；远端 GitHub `thinkasmodel/alayo-get`，开源仓（ADR-0007）。分支按票号，收尾开 PR；约定见 `docs/agents/issue-tracker.md`。

## Agent skills

### Issue tracker

Linear 为唯一权威 issue 源（team `Alayo Get` / ALAG），含 wayfinder 地图操作约定。See `docs/agents/issue-tracker.md`.

### Triage labels

五个默认 triage 标签，与角色名同字符串，首次使用时在 team 下懒创建。See `docs/agents/triage-labels.md`.

### Domain docs

Single-context：仓根 `CONTEXT.md` + `docs/adr/`，由 `/domain-modeling` 懒创建。See `docs/agents/domain.md`.
