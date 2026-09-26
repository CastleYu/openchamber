# OC1/OC2 双 API 恢复基线（2026-09-26）

## 已确认的提交

- 原工作区 `codex/personal`：`bfde007f9913cc906a96ef494de886bf608d1238`。
- 保护引用：`codex/backup-dual-kernel-20260926`，指向上述提交。
- 隔离开发分支：`codex/dual-kernel-20260926`，从 `4ac81115c17c203c89c5b52f93a930af32ea2163` 建立。
- `4ac81115c` 是 `872de3db6c9b8f82a48d0a91ef1e3dd878d78e03` 的第一父提交。后者合入上游 OC2，第二父提交是 `0af1eb00cacee54492295935549c513af614a5ac`。
- 基线根清单为 OpenChamber `1.24.2`、`@opencode-ai/sdk` `1.18.31`，个人构建清单为 DIJIANG `3.7`、`notify-only`。`@opencode-ai/sdk/v2` 是旧 SDK 的导入路径，不能据此认定运行时为 OpenCode 2.x。

## 原工作区保护

原工作区仍停留在 `codex/personal`。原有 `AGENTS.md`、`packages/ui/src/content/update-history.zh-CN.md` 修改及未跟踪文件保留在原处。未执行 reset、clean、stash、push 或强制更新。隔离分支只适配了当前 `AGENTS.md` 新增的 OpenCode 1.2.27 兼容约束；原文件中“当前实现需要 OC2”的叙述改为与 OC1 基线相符。

## 后续提交处理

`872de3db6` 后第一父链仅有 `8d80b1bde`、`698f8a4b1`、`bfde007f9`。它们分别修改更新历史与维护文档，没有直接新增运行时代码。逐项核对仍适用的历史和维护内容，再移植到双 API 实现；不要直接搬入其中针对纯 OC2 的运行结论。原工作区尚未提交的中文历史也要逐段对照并保留。

## 验收边界

本记录只证明 Git 拓扑、清单和隔离状态。OpenCode 1.2.27 端到端可用、DIJIANG 功能回归及 OC2 适配均未在本阶段验证。实现完成后按各运行时和个人功能清单做测试及实际连接验证，再决定如何集成回正式分支。
