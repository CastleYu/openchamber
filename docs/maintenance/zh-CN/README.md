# Agent 集成优化：中文审阅与归档

更新于 2026-10-09。当前状态：审阅中，中英文同步维护。本目录覆盖本次新增和调整的十二份文档；链接引用的其他历史资料保留原文。

## 文档入口

| 内容 | 中文审阅副本 | 英文交接源 |
| --- | --- | --- |
| 紧急 CAgent 架构 | [CAgent SPEC](CAGENT-INTEGRATION-SPEC.md) | [英文](../CAGENT-INTEGRATION-SPEC.md) |
| 调用方与责任边界 | [调用边界](CAGENT-BOUNDARIES.md) | [英文](../CAGENT-BOUNDARIES.md) |
| 宿主调度契约 | [调度契约](CAGENT-DISPATCH-CONTRACTS.md) | [英文](../../../packages/web/server/lib/agent/DOCUMENTATION.md) |
| 执行证据与检查点 | [执行记录](CAGENT-EXECUTION.md) | [英文](../CAGENT-EXECUTION.md) |
| 环境内适配流程 | [适配工作手册](CAGENT-ADAPTER-WORKBOOK.md) | [英文](../CAGENT-ADAPTER-WORKBOOK.md) |
| 集成需求与架构 | [集成 SPEC](OPENCODE-INTEGRATION-SPEC.md) | [英文](../OPENCODE-INTEGRATION-SPEC.md) |
| Legacy 1.2.27 适配 | [Legacy SPEC](OPENCODE-LEGACY-1.2.27-SPEC.md) | [英文](../OPENCODE-LEGACY-1.2.27-SPEC.md) |
| 子版本与验收门槛 | [里程碑](OPENCODE-INTEGRATION-MILESTONES.md) | [英文](../OPENCODE-INTEGRATION-MILESTONES.md) |
| 当前实现核查 | [核查记录](OPENCODE-INTEGRATION-AUDIT.md) | [英文](../OPENCODE-INTEGRATION-AUDIT.md) |
| 后续大版本总览 | [DEV-PLAN](DEV-PLAN.md) | [英文](../DEV-PLAN.md) |
| 维护执行队列 | [PLAN](PLAN.md) | [英文](../PLAN.md) |
| 现有双内核架构 | [双内核架构](DUAL-KERNEL-ARCHITECTURE.md) | [英文](../DUAL-KERNEL-ARCHITECTURE.md) |

## 同步和交接

完整规则由[英文集成 SPEC](../OPENCODE-INTEGRATION-SPEC.md#language-review-and-handoff)维护。审阅阶段，每次处理维护者修改意见，都在同一次变更中同步受影响的英文源文档和中文副本，并检查相关里程碑、交叉引用及验收条件。中文保留完整要求，不缩写为摘要；任务编号、版本、代码符号、路径和证据状态保持一致。

下一阶段的实施交接使用上表英文源文档。交接前完成双语核对，并在本页记录交接日期和对应英文版本或提交。届时将本目录标为已归档，保留中文审阅记录，不把中文副本作为另一套执行队列。当前尚未进行实施交接，因此不提前标记已归档。

若归档后维护者继续提出计划修改意见，重新打开本次审阅，同步更新两种语言，再记录新的归档版本。中文和英文出现差异时，按维护者最近明确意见修正双方，不能仅以英文优先为由丢弃中文反馈。

## 归档记录

| 状态 | 日期 | 对应英文版本 |
| --- | --- | --- |
| 审阅中 | 2026-10-09 | 已同步反设计评审修订、紧急 CAgent 前置需求、INT-00 执行证据、CA-00 调用边界及 CA-01 调度契约起点；对应十二份英文文档，尚未冻结最终交接版本 |
