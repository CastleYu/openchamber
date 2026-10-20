# ACP 交接

记录日期：2026-10-21。[英文版](ACP-HANDOFF.md)是规范版本；本文为与英文版保持同步的归档。

## 当前状态

独立 ACP 路线从最后一个 4.X 基线提交 `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6`（`2.0.4-DIJIANG.4.0`）开始。本交接将 `692c366d5e66e2cc95ebc6bcddae44787b80be44` 之后的 ACP 工作固化到 `codex/acp-multi-session-integration` 上包含本文的快照提交。这是源码检查点，不是发布版本。

现有 ACP 发布为 `ACP.2.1` 和 `ACP.3.1`。`ACP.3.1` 对应 CI 通过的 `692c366d5`。本快照包含此后的 Windows BAT/CMD 启动与进程清理、callbacks、elicitation、代理控制项、项目映射、会话操作，以及真实 Windows 按目录发现修复。本地较旧的便携包不含最后这项修复。

## 决策与历史

最初的 5.X 方案希望同时兼容两个 OpenCode 世代，包含旧版 OpenCode 1.2.27，并为未知的私有 CAgent 和较弱模型补充接入文档。该路线设计膨胀、耗时过长，用户暂停了 5.X，并要求基于上述最后一个 4.X 提交独立实现 ACP。不要把暂停的 5.X 工作恢复或合并到此分支。

连接方式必须显式选择：`cmd`、OpenCode server 或 ACP。不能根据环境变量推断，也不能静默切换到其他模式或可执行文件。开发流程为 Astra 研究、Sol 实现、Grok 4.7 high 审查。控制改动范围；缓存与临时数据应在所属进程退出后清理，确认进程停止后再删除本任务创建的临时目录。

## 验收证据

在真实 Windows 环境中使用 OpenCode `1.19.0` 和 Qwen Code `0.25.1` 完成了计划中的五项验收。OpenCode 检查了并发会话、文件读写批准与拒绝、取消、重启恢复和历史加载。验收发现并修复了 Windows 路径包含正斜杠、小写盘符及尾部分隔符时的按目录会话发现问题。Qwen 最初无法通过 OpenCode Go 请求模型，因为该服务要求 `x-opencode-session`；按 Qwen 支持的动态会话头配置后，请求成功，无需修改产品代码。最终检查覆盖两个并发会话、批准与拒绝写入、取消，以及重启后继续成功提示。

功能对照表共有 38 项，见 [ACP 验收文档](ACP-ACCEPTANCE.md)，此处不重复表格。该文档也记录了 Grok `grok-4.7` high 审查：模型已返回完整审查内容，但 CLI 在磁盘空间错误后未能归档会话。审查内容已捕获，但 CLI 退出状态并非干净成功。

现有证据覆盖已测试的 Windows 后端路径，不能证明无法访问的私有 CAgent 环境、精确版 OpenCode `1.2.27`、移动设备或远端 ACP Server 部署已验收。fixture 与浏览器检查不能替代这些环境的真实验收。本地便携包早于按目录发现修复。

## 后续交接

发布由单独任务处理。现有工作流只允许从 `codex/acp-integration` 发布，本交接不扩大该范围。当前行为、详细证据和发布流程分别见 [ACP](ACP.zh-CN.md)、[ACP 验收](ACP-ACCEPTANCE.zh-CN.md) 和 [ACP 构建](ACP-BUILD.zh-CN.md)。根目录[分支 README](../../README-ACP.zh-CN.md) 为接续入口。

[证据索引](evidence/acp-handoff/INDEX.zh-CN.md) 保存精选测试输出、审查结果和环境失败记录。其中 `paused-5x-remnants.patch` 仅保留散落的旧路线文件，不启用它们。不要在继续 ACP 开发时将该补丁应用到本分支。

原始 Codex 对话没有完整导出。本文整理了继续工作所需的决策与证据，不复刻完整用户环境，也不包含秘密。
