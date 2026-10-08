# Triage Labels

skill 用五个标准 triage 角色描述新进 issue 的状态机。本文件把角色映射到本仓
issue tracker（Linear，team `Alayo Get`）里的实际标签字符串。

| Label in mattpocock/skills | Label in our tracker (Linear) | 含义                         |
| -------------------------- | ----------------------------- | ---------------------------- |
| `needs-triage`             | `needs-triage`                | 维护者待评估                 |
| `needs-info`               | `needs-info`                  | 等报告人补信息               |
| `ready-for-agent`          | `ready-for-agent`             | 已完整规格化，AFK agent 可接 |
| `ready-for-human`          | `ready-for-human`             | 需人类实现                   |
| `wontfix`                  | `wontfix`                     | 不予处理                     |

- 本 team 尚无这些标签。首次 triage 时用 Linear MCP `create_issue_label`
  在 team `Alayo Get` 下按需创建，之后复用。
- triage 标签与 wayfinder 标签（`wayfinder:*`）正交，互不替代。
- skill 提到某角色（如「apply the AFK-ready triage label」）时，套用表右列字符串。

要改词表就改右列。
