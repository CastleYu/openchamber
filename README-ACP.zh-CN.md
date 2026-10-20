# OpenChamber ACP 交接分支

`codex/acp-multi-session-integration` 固化基于 DIJIANG 4.0 的独立 ACP 开发。这是源码交接，不是新发布的应用。

[英文主文档](README-ACP.md) · [开发与 Codex 对话交接](docs/maintenance/ACP-HANDOFF.zh-CN.md) · [38 项功能验收表](docs/maintenance/ACP-ACCEPTANCE.zh-CN.md)

## 已包含

显式 OpenCode 命令/服务端和 ACP stdio/服务端选择、Windows BAT/CMD 启动、多会话、流式工具与差异、权限与表单、Agent 声明的模型/模式控件和命令、本地回调、远端项目映射、历史持久化及 Windows 按目录发现。

OpenCode 1.19.0 和 Qwen Code 0.25.1 实测覆盖并发会话、工具执行、批准/拒绝、取消后进程退出、恢复上下文。精确分叉/回滚、公共分享、Provider/MCP 管理和持久调度尚未作为通用 ACP 功能实现。独立 VS Code ACP、精确 OpenCode 1.2.27、真实远端/移动端仍未验收。

## 使用和构建

运行 `bun install --frozen-lockfile`，再执行 `bun run dev`。本地便携包使用 `node scripts/build-personal.mjs --acp` 构建。参见[连接说明](docs/maintenance/ACP.zh-CN.md)和[构建说明](docs/maintenance/ACP-BUILD.zh-CN.md)。

明确选择程序、独立参数和绝对工作目录。OpenCode 示例为 `opencode.exe`，参数为 `--pure`、`acp`。BAT/CMD 路径不额外加引号。ACP Server 需要显式传输方式、端点和远端工作目录。

发布工作流仍只允许 `codex/acp-integration`。本交接分支不扩大发布范围，也不自动发布。现有 [ACP.3.1](https://github.com/CastleYu/openchamber/releases/tag/v2.0.4-DIJIANG.4.0-ACP.3.1) 不包含本快照后续追加的开发。

## 接续开发

编辑前阅读交接文档与[证据索引](docs/maintenance/evidence/acp-handoff/INDEX.zh-CN.md)。从本快照选择范围明确的后续需求，对新修改运行对应检查，再由单独发布任务准备新包。历史验收不能替代未来修改的验证。

暂停的 5.X/CAgent 路线仅作背景，不是当前范围。其散落在本地的遗留文件以不参与运行的补丁归档保存，不在本分支启用。剩余本地诊断材料保存在证据目录的 `local-context.zip` 中，附逐文件校验清单。最终清理在远端核验后移除整个工作树，包括其中的依赖和生成包。`.env` 从分支快照中删除，也不进入归档。工作树以外的文件保留。
