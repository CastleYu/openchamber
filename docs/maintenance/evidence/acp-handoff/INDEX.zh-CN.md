# ACP 交接证据

本归档属于 2026-10-21 源码交接。[英文索引](INDEX.md)。

- `acp-*-results.txt` 和 `acp-parity-delivery.txt` 为历史实施检查点。早期阻塞或待完成状态以[最终验收](../../ACP-ACCEPTANCE.zh-CN.md)为准。
- `acp-opencode-real.txt`、`acp-opencode-stop.txt`、`acp-discovery-real.txt`、`acp-qwen-configured-run.json`、`acp-qwen-final-probe.json` 保留真实 Agent 证据。Qwen 补验检查新增助手消息、系统进程退出及无延迟写入。
- `acp-grok-parity.txt` 保留完整 Grok 审查及随后 CLI 归档失败。结果文件记录源码与协议复核后的纠正。
- 工作区类型/lint/死代码和双内核输出保留此前验证；closure 专用输出记录本次快照重新执行的检查。
- command notes 保留环境失败和可行替代方式。历史证据中的机器路径标识当时运行环境，不是通用安装指令。
- `paused-5x-remnants.patch` 保留暂停路线的 12 个散落文件，包含编辑脚本、记录、未使用的 legacy-provider 代码。这是归档，不是 ACP 实现，也不是执行这些脚本的指令。已将 12 个原件与提交中的补丁逐一比对，并核验远端文件树；随后删除本地散落原件。

Codex 讨论整理见[交接文档](../../ACP-HANDOFF.zh-CN.md)。不上传原始对话转储、凭据、全局用户配置、依赖树、生成产物和发布程序。

`local-context.zip` 补充保存剩余 171 个本地诊断文件、日志、脚本、包元数据及截图。`local-context-manifest.json` 列出各归档路径及 SHA-256。打包前扫描了环境中的已知秘密值和凭据令牌特征，无需替换。归档排除 `.env`、Git 元数据、依赖、生成包和可执行文件。历史脚本仅作为证据，不作为执行指令。

维护者随后要求在核对远端归档后完整移除此工作树。`.env` 从分支快照中删除。远端核验后删除工作树内所有剩余本地文件，包括依赖和生成包。其他工作树及外部便携安装保留。`closure-summary.txt` 记录的是此前仅清理缓存的操作及测试结果。
