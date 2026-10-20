# DIJIANG 集成开发交接归档

分支：`codex/opencode-legacy-cagent-integration`

本分支保存截至 2026-10-21 尚未完成的 OpenCode 与 CAgent 集成开发。
维护者因范围膨胀和偏离原项目的问题暂停了开发。这是开发快照，
不代表候选发布版，也不代表 Legacy 或 CAgent 已完整支持。

请先阅读[中文交接归档](docs/maintenance/zh-CN/HANDOFF-20261021.md)。
[英文分支说明](README.branch.md)与
[英文交接](docs/maintenance/handoff-20261021/README.md)是后续 Agent 的交付入口。

## 保存范围

- 既有 OC1/OC2 兼容架构，以及 CAgent 宿主契约、能力控制和离线适配工具包。
- 精确 OpenCode 1.2.27 支持已验收至 INT-04，以及未完成的 INT-05
  Provider、凭据、队列、定时任务改动。
- 已编写的测试和探针、原有 SPEC、里程碑历史、脱敏检查点和 Codex 对话归档。

个人分支起点为 `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6`。
本次快照前的开发提交为 `cb22855708b58db33dcef762068615b33ae1e6f2`，
位于 `codex/cagent-integration`。本次也保存该工作树中待提交的源码、
测试和文档。其他工作树与分支属于独立工作。

## 继续开发前

先复核交接中的四项偏离：CAgent 独立聊天应用、普通 OpenCode 的后端发现
启动依赖、Legacy 凭据 API 的 Windows 原生进程限制，以及缺少连接标识的
旧队列停止自动发送。本次仅归档这些发现，没有修复它们。

R3/INT-05 未完成，R4-R7 和真实环境内 CAgent 验收仍未完成。
历史 CAgent 预发布版不能证明本快照可用，也不能把历史通过的测试作为
当前完整 HEAD 的重新验收结果。

构建与测试命令以根目录 `package.json` 为准，声明工具链为 Node.js 22+
和 Bun 1.4.2。修改前遵守模块文档与项目技能。交接已清理选定的生成物和缓存，
需要时重新生成；无需默认重新安装依赖。

[原项目 README](README.md)继续提供产品介绍。本次交接不变更包版本、
发布标签或 Release 附件。
