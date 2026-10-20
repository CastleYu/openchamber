# ACP 实际验收与功能对照（中文归档）

检查日期：2026-10-14。范围为当前独立 ACP 工作树，包含尚未提交的修改。[英文交付文档](ACP-ACCEPTANCE.md)为主版本。

2026-10-21 交接将该验收对应的源码和精选日志固化在[证据归档](evidence/acp-handoff/INDEX.zh-CN.md)。下文 `.codex-temp` 路径标识原始本地运行记录。

## 验收证据

本轮通过 OpenChamber 的 `createAcpRuntime` 调用真实 Agent 和模型，覆盖进程启动、权限、工具结果转换、持久化及取消。测试使用 D 盘隔离目录。它证明后端集成行为，不代表本轮重新验收了打包浏览器、移动设备或远端 ACP Server。

OpenCode 1.19.0（`--pure acp`）已完成：两个并发会话分别返回自己的标记；文件读取与写入审批；拒绝写入；等待审批时停止；运行命令时停止；重启后续聊仍记得原标记；空客户端从 Agent 加载历史。运行命令停止后 1,839 毫秒内子进程退出，延迟写入文件不存在。等待审批时停止，Agent 返回 `end_turn`；运行命令停止返回 `cancelled`。两者均清除了待审批项，未执行被阻止的写入。

实测发现并修复 Windows 路径格式导致按项目发现历史为空的问题。本地 stdio 查询与结果比较现在统一路径格式，远端路径和保存的 Agent cwd 保持原义。使用小写盘符、正斜杠、末尾斜杠的空客户端复测发现 3 个真实会话，恢复含原标记的 6 条消息。相关 runtime/parity/mapping 测试 30/30 通过，无跳过；语法、oxlint、Web ESLint、Web type-check 通过。Bun 无法启动包检查后，使用已安装的 Node TypeScript/ESLint 入口执行相同参数通过。

Qwen Code 0.25.1 已完成两个真实模型并发会话，助手分别返回各自标记；批准文件写入；拒绝写入且未创建文件；取消运行中的终端回合；重启加载历史后成功续聊。首次模型请求失败的原因是 OpenCode Go 要求 `x-opencode-session`。隔离的 Qwen 配置使用其原生支持的 `outboundCorrelation.allowDynamicHeaderValues` 和 `generationConfig.customHeaders`，值为字面量 `${session_id}`。专用 `OPENCODE_GO_API_KEY` 仅保留在进程环境。此处修正了 Provider 配置，无需修改产品代码。

补验使用新的 runtime，在新提示不含答案的情况下正确回忆第一次回复的标记。另一条获批命令先写 PID，再等待 60 秒后写文件。取消返回 `interrupted`，系统进程检查确认 PID 已退出，持续观察 62 秒未生成延迟文件。两个 Agent 均在清理临时目录前完成停止。

已实际调用 Grok CLI `--model grok-4.7 --reasoning-effort high`，一次 `grok-4.7-build` 模型调用返回完整审查。随后 CLI 保存聊天时磁盘不足，退出码为 1。审查正文已完整保留；这是模型审查完成、CLI 归档失败。源码和协议复核纠正了两处模型误判：ACP v1 有按能力声明的会话删除，已声明的斜杠命令也确实通过普通 prompt 发送。

## 功能对照

“已实现”指当前代码支持；真实验收范围以上述结果为准。“UI 方案”区分现有接口的展示和体验近似方案。本轮未据此扩建新功能。

| 原 OpenChamber 功能 | 当前 ACP 状态 | 仅 UI 可做什么 | UI 无法完成的部分 |
|---|---|---|---|
| 显式 cmd/server 连接选择 | 独立的 ACP stdio、ACP Server 选项 | 使用现有连接界面 | 普通 HTTP 地址不等于 ACP；远端凭据尚未实现 |
| 多会话、并发对话 | 已实现；同一进程可拥有多个会话 | 现有侧栏与聊天 | 依赖 Agent 并发支持；同会话仍串行发送 |
| 项目与工作目录 | stdio 按会话 cwd；远端显式默认值与映射 | 现有项目选择器 | 远端目录存在性与文件传输 |
| 发现历史、分页 | 使用声明的 session/list，保留本地记录 | 现有会话列表 | Agent 必须提供列表；Windows 路径缺陷已修复 |
| 历史、刷新、续聊 | 本地记录加 load/resume | 现有历史展示 | Agent 未提供的历史无法凭 UI 重建；无恢复能力时只读 |
| 重命名、归档、取消归档 | 本地元数据，发现历史时保留 | 已可用 | 跨客户端同步需要服务支持 |
| 移除/删除 | 声明删除能力则调用，否则本地隐藏 | 已可用 | 本地隐藏不删除 Agent 历史 |
| 流式文本、思考、状态 | 根据 ACP 更新实现 | 现有消息渲染 | 必须由 Agent 发出；历史不能替代运行状态 |
| 工具、输出、差异 | 已实现运行输出和文本/差异混合展示 | 现有工具卡片 | 输入、输出、差异完整性取决于 Agent |
| 计划/Todo | ACP plan 转为 Todo | 已渲染 | 无更新时无法推断权威计划状态 |
| 权限允许/拒绝 | 保留 Agent 原始选项 ID、名称与种类 | 现有权限卡片 | 持久策略和 OpenCode 自动批准语义需要后端 |
| 停止 | session/cancel、待输入清理、本地终端清理 | 现有停止按钮 | 远端命令终止及 Agent 取消配合 |
| 提问、表单、URL 输入 | 已实现 elicitation 与同意界面 | 已可用 | Agent 必须发出兼容请求 |
| 模型、推理、模式 | 声明的 select 配置与旧模式 | 现有 ACP 控件 | 不能凭 UI 增加不存在的模型和设置 |
| 斜杠命令 | 声明命令补全后作为 prompt 发送 | 现有补全 | 命令语义属于 Agent，不保证 OpenCode 内建命令通用 |
| 上下文压缩 | 无通用 OpenCode compact 操作 | 可展示 Agent 声明的压缩命令；摘要 prompt 只生成文本 | 真正替换/压缩上下文需要 Agent |
| 图片、音频、嵌入文本 | 按 prompt 能力开放 | 隐藏不支持的输入、展示已接受附件 | Agent/模型能力 |
| 本地文件附件 | stdio 资源链接；远端拒绝本地 file URL | 现有附件流程 | 远端访问/传输需要后端 |
| 会话移动 | 无通用运行会话迁移 | 可调整本地分组，不等于修改 cwd | Agent 迁移/重建及历史语义 |
| 分叉、指定消息分叉、BTW | 不支持精确分叉 | 可设计“复制上下文到新会话”，但不能称为精确分叉 | 隐藏状态、工具上下文和分支关系 |
| 回滚、撤销回滚、从旧消息重试 | 不支持精确回滚 | 可复制、编辑、重新发送文本 | Agent 历史与文件回滚事务 |
| 会话级变更审查 | 已有单次工具差异 | 可聚合收到的差异；缺失编辑时不完整 | 权威变更清单与检查点 |
| 用量、上下文统计 | 仅 Agent 提供的数据 | 展示上报值；从记录计算消息/工具次数 | 精确费用、细分 token、全局用量；缺失不能当成零 |
| 同实例会话/消息链接 | App 导航功能 | 现有链接 | 接收者须能访问相同实例 |
| 公共分享/取消分享 | OpenCode 分享 API 不可用 | 可另做本地导出/复制 | 公共发布与访问控制服务 |
| Provider、密钥、OAuth | OpenCode 管理不可用；Agent 认证独立 | 展示声明的认证方法，终端登录仍在 CLI | 凭据存储与 OAuth 生命周期 |
| Agent/子代理目录与切换 | 仅声明的模式/选项 | 展示已有控件；独立会话可并排 | 子代理创建、关系、结果与取消语义 |
| MCP 状态、配置、连接、工具目录 | 未实现管理；new/load 当前发送空 mcpServers | 单靠面板不能管理 Agent | 可在后端添加 ACP MCP 配置转发；动态管理需要 Agent API |
| Skills、插件、Hooks、Agent 配置 | 无通用 OpenCode 配置能力 | 展示已声明的工作流命令 | Agent 专属配置与生命周期 |
| LSP | ACP facade 不支持 | 显示不可用 | 主机 LSP 服务或 Agent API |
| 文件搜索/浏览、Git、工作树 | 独立主机服务 | 复用现有 UI 和路由 | 操作主机文件，不自动等于远端 Agent 文件；本轮未逐项实测 |
| 用户终端、Agent 终端 | 主机终端独立；ACP 回调限本地 stdio | 现有终端和工具卡片 | 远端 ACP 不获得本机文件/终端回调 |
| 排队、并行输入器 | ACP 排队关闭；并行输入器限 OC2 | 可做前台队列/并行发送，明确页面存活限制 | 持久投递、顺序、重启恢复、后台调度需要后端 |
| Goal、定时、自动持续执行 | OpenCode 工作流关闭/不可用 | 目标 prompt 或草稿提醒不等于调度器 | 持久调度、预算、取消和会话生命周期 |
| Prompt 优化、合成上下文 | OpenCode 后端操作不可通用 | 发送前本地文本编辑/模板 | 模型生成、隐藏上下文插入和 Provider 选择 |
| 连接健康、重连 | ACP info/status、SSE 快照已实现 | 现有连接状态界面 | OpenCode 升级、服务管理 API |
| Web/Electron/托管移动端/Capacitor | 共用后端 ACP | 共用聊天 UI | 本轮是 Windows 后端验收，设备仍须单独验证 |
| 独立 VS Code | 明确不支持 ACP | 仅改 UI 不够 | Extension host 启动器、桥接与验收 |

## 来源与证据

- 基线：[双内核接口表](DUAL-KERNEL-INTERFACES.md)，UI-01–20、HTTP-01–11、EV-01–07、CFG-01–05。
- 实现：[ACP 后端文档](../../packages/web/server/lib/acp/DOCUMENTATION.md)、UI ACP adapter、client facade、输入器能力限制和会话操作。
- 协议：[会话删除](https://agentclientprotocol.com/protocol/v1/session-delete)、[斜杠命令](https://agentclientprotocol.com/protocol/v1/slash-commands)。
- 开发证据：`.codex-temp/acp-opencode-real.log`、`acp-opencode-stop.log`、`acp-discovery-real.log`、`acp-discovery-fix-results.md`、`acp-qwen-configured-run.json`、`acp-qwen-final-probe.json`、`acp-grok-parity.log`、`acp-grok-parity-results.md`。

本轮不发布 Release。此前便携包不包含本轮修复。
