# Agent 集成优化：中文审阅与归档

更新于 2026-10-09。当前状态：已归档；下一阶段使用英文交接源。下表列出本次新增和调整的文档；链接引用的其他历史资料保留原文。

## 文档入口

| 内容 | 中文审阅副本 | 英文交接源 |
| --- | --- | --- |
| 紧急 CAgent 架构 | [CAgent SPEC](CAGENT-INTEGRATION-SPEC.md) | [英文](../CAGENT-INTEGRATION-SPEC.md) |
| 运行时任务质量准入 | [工作流验收](CAGENT-WORKFLOW-ACCEPTANCE.md) | [英文](../CAGENT-WORKFLOW-ACCEPTANCE.md) |
| 聊天／同步消费契约 | [消费契约](CAGENT-CONSUMER-CONTRACT.md) | [英文](../CAGENT-CONSUMER-CONTRACT.md) |
| 调用方与责任边界 | [调用边界](CAGENT-BOUNDARIES.md) | [英文](../CAGENT-BOUNDARIES.md) |
| 宿主调度契约 | [调度契约](CAGENT-DISPATCH-CONTRACTS.md) | [英文](../../../packages/web/server/lib/agent/DOCUMENTATION.md) |
| 执行证据与检查点 | [执行记录](CAGENT-EXECUTION.md) | [英文](../CAGENT-EXECUTION.md) |
| 环境内适配流程 | [适配工作手册](CAGENT-ADAPTER-WORKBOOK.md) | [英文](../CAGENT-ADAPTER-WORKBOOK.md) |
| 单操作契约生成工具 | [生成工具](CAGENT-CONTRACT-GENERATOR.md) | [英文](../../../scripts/cagent/DOCUMENTATION.md) |
| 单操作契约参考 | [22 个操作](cagent-contracts/README.md) | [英文](../cagent-contracts/README.md) |
| 集成需求与架构 | [集成 SPEC](OPENCODE-INTEGRATION-SPEC.md) | [英文](../OPENCODE-INTEGRATION-SPEC.md) |
| Legacy 1.2.27 适配 | [Legacy SPEC](OPENCODE-LEGACY-1.2.27-SPEC.md) | [英文](../OPENCODE-LEGACY-1.2.27-SPEC.md) |
| 子版本与验收门槛 | [里程碑](OPENCODE-INTEGRATION-MILESTONES.md) | [英文](../OPENCODE-INTEGRATION-MILESTONES.md) |
| 当前实现核查 | [核查记录](OPENCODE-INTEGRATION-AUDIT.md) | [英文](../OPENCODE-INTEGRATION-AUDIT.md) |
| 后续大版本总览 | [DEV-PLAN](DEV-PLAN.md) | [英文](../DEV-PLAN.md) |
| 维护执行队列 | [PLAN](PLAN.md) | [英文](../PLAN.md) |
| 现有双内核架构 | [双内核架构](DUAL-KERNEL-ARCHITECTURE.md) | [英文](../DUAL-KERNEL-ARCHITECTURE.md) |

## 同步和交接

完整规则由[英文集成 SPEC](../OPENCODE-INTEGRATION-SPEC.md#language-review-and-handoff)维护。审阅阶段，每次处理维护者修改意见，都在同一次变更中同步受影响的英文源文档和中文副本，并检查相关里程碑、交叉引用及验收条件。中文保留完整要求，不缩写为摘要；任务编号、版本、代码符号、路径和证据状态保持一致。

下一阶段的实施交接使用上表英文源文档。交接前完成双语核对，并在本页记录交接日期和对应英文版本或提交。届时将本目录标为已归档，保留中文审阅记录，不把中文副本作为另一套执行队列。本次已于 2026-10-09 完成实施交接并归档；后续开发从英文执行检查点及里程碑队列继续。

若归档后维护者继续提出计划修改意见，重新打开本次审阅，同步更新两种语言，再记录新的归档版本。中文和英文出现差异时，按维护者最近明确意见修正双方，不能仅以英文优先为由丢弃中文反馈。

## 归档记录

| 状态 | 日期 | 对应英文版本 |
| --- | --- | --- |
| 已归档 | 2026-10-09 | [2.0.4-DIJIANG.5.0-DEBUG](https://github.com/CastleYu/openchamber/releases/tag/v2.0.4-DIJIANG.5.0-DEBUG)，构建源 `c4b2f1da3f2ae752902355a30bd342e7722efc20`；本次发布收尾同步英文交接状态，后续修改意见仍按上述双语规则处理 |
