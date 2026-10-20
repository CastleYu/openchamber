# ACP 中文归档

最新 OpenCode/Qwen Code 实测结果和逐项 UI/后端功能对照见 [ACP 验收归档](ACP-ACCEPTANCE.zh-CN.md)。

本分支基于 `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6`，版本为
`2.0.4-DIJIANG.4.0`，是 5.X 分支分出前的最后一个 4.X 基线。
开发与[便携构建](ACP-BUILD.zh-CN.md)使用 `codex/acp-integration`。
下述显式选择落实 DEV-PLAN 第 3.2 节，作用于 OpenChamber 后端。
独立 VS Code 扩展保留自己的 OpenCode 启动器。

启动时或在 OpenCode 设置中选择连接方式：外部 OpenCode 服务、指定命令、PATH、
内置 OpenCode、ACP stdio 命令，或 ACP 服务端。历史设置只预填，需要确认后连接。
连接失败会显示错误，不会自动更换地址或程序；环境变量不决定连接模式。

连接选项保存在 `agent-connection.json`，ACP 会保存工作目录。失败后点击应用即可重试。
切换时会停止托管子进程；外部 OpenCode 仍由原有管理者运行。

ACP 需要可执行程序、参数和绝对工作目录。例如选择已安装的 `opencode.exe`，
参数分别填写 `--pure` 和 `acp`。Windows 可以直接选择 `.bat` 或 `.cmd` 文件，
支持带空格的完整路径和 PATH 中的命令 shim。路径不用额外加引号，参数分别填写。
其他脚本需要明确选择解释器，例如 `node` 加脚本路径。切换连接或退出时，
后端停止所选程序及 Windows 批处理包装器、智能体子进程。

批处理启动器应使用 `@echo off`，通过 `%*` 转发参数，stdout 只输出 ACP JSON-RPC 行，
诊断信息输出到 stderr。直接填写 BAT/CMD 文件即可，OpenChamber 负责 Windows 命令转义。

例如启动器为 `C:\Tools\agent.bat`，且接收 `--acp` 参数：选择 ACP stdio，
命令填写 `C:\Tools\agent.bat`，参数填写 `["--acp"]`。如果脚本内已经带上
`--acp`，参数填写 `[]`。

## ACP 服务端

选择 ACP 服务端后，明确选择 WebSocket 或流式 HTTP。填写完整端点 URL，例如
`wss://agent.example/acp` 或 `https://agent.example/acp`，以及远程绝对工作目录，
例如 `/srv/project` 或 `C:\\projects\\agent`。远程工作区需要在智能体服务端单独配置，
本地项目文件不会自动复制。OpenChamber 保留本地项目目录用于会话归档，
ACP 会话请求使用配置的远程目录。

可通过项目目录映射，将精确匹配的本地项目目录对应到智能体服务端的绝对目录。
新建会话和按项目发现历史使用该映射；未匹配的项目使用明确配置的默认远程目录。
修改映射后，已有会话保留原来的目录。

端点必须实现 ACP 协议，不能填写 OpenCode REST API 地址。
[官方 Python SDK 网页传输](https://agentclientprotocol.github.io/python-sdk/web-transport/)
仍属实验性功能。WebSocket 传输 JSON-RPC 帧；流式 HTTP 需要 HTTP/2，使用 POST、
SSE GET 流和 DELETE。传输方式必须与服务端匹配，失败后不会自动切换。
本版没有服务端认证或 token 字段，不接受 URL 内的凭据。

OpenChamber 后端负责远程连接。Web、Electron、托管移动端和 Capacitor
复用现有聊天、权限审批与取消流程，浏览器不会直接连接 ACP 端点。
独立 VS Code 扩展不支持 ACP 服务端，原有 stdio 命令方式继续可用。

## ACP 会话

ACP v1 支持初始化、创建会话、发送消息、文本与思考流、工具更新、
权限选项和取消。权限卡保留智能体提供的选项名称及 ID，不套用 OpenCode 自动批准策略。
输入框展示智能体声明的配置选项，包括模型和推理选项；没有配置选项时使用其声明的旧版模式。
修改后完整替换关联选项。智能体提供的斜杠命令通过普通 ACP 消息原样发送。
上下文用量和费用只展示智能体实际提供的数据。
图片、音频和嵌入文本分别按智能体声明的能力发送；文件链接使用 ACP resource_link。

Web、Electron、托管移动端和 Capacitor 通过 OpenChamber 后端使用共享聊天。
独立 VS Code 宿主不支持 ACP。OpenCode 的 fork、revert、分享、provider 配置、
MCP、skills 和后台 shell 操作需要切回 OpenCode。
主机文件浏览、Git、工作树和用户终端继续使用 OpenChamber 自有服务。

记录保存在 OpenChamber 数据目录的 `acp-sessions.json`，按智能体连接隔离。
旧的单连接记录在保存时迁移。重连同步完整记录。
智能体声明 `session/list` 时可导入历史，`session/load` 回放记录，
`session/resume` 恢复会话但不回放历史。加载失败保留原记录。
两种恢复方式都不支持时，保存的会话保持只读。

重命名和归档使用本地元数据。移除会话时，智能体声明删除能力则调用删除，
否则只在 OpenChamber 隐藏。用户明确修改的标题不会被智能体标题覆盖。
每个会话保留创建或导入时的目录；stdio 可在同一个智能体进程中使用多个项目目录。

## 用户输入与本地工具

智能体提问复用现有会话输入区域。表单支持类型化字段、选项和默认值，由后端校验回复。
网页请求会先展示智能体及目标地址，再打开系统浏览器。同意网页请求表示用户授权打开，
是否完成由智能体另行确认。刷新浏览器后，通过连接快照恢复待处理输入。

连接设置展示由智能体管理的认证方式。需要交互式终端的方式会引导用户在智能体 CLI 中登录。
HTTP 端点凭据与这一 ACP 认证流程相互独立。

本地 stdio 智能体可以读写会话目录内的文本，并通过 ACP 终端回调执行归属该会话的命令。
规范路径检查会拒绝指向目录外的文件系统链接。远程 ACP 连接不会获得 OpenChamber
主机的文件读写和命令执行权限。托管端和移动端的这些本地工具实际运行在后端主机。

终端输出实时展示在现有工具卡片中，并保留在会话历史。ACP 工具同时返回文本和文件差异时，
两者同时展示。智能体计划复用现有待办展示，
历史回放也支持。同一轮的计划更新替换原卡片，不重复添加。

取消终端时等待进程清理。Windows 下，如果命令先退出、后代进程仍占用输出管道，
清理会在五秒后明确报错。POSIX 进程组清理仍需对应平台验收。

## 当前对接验证

实现依据 [issue #1](https://github.com/CastleYu/openchamber/issues/1) 和稳定版 ACP v1，
协议修订固定为 `24f3b07f44f043c617666c20208b093e919648ac`。
运行时 fixture 覆盖分页历史、暂存回放、恢复、生成期间切换配置、元数据保存、
连接隔离和列表、加载、保存失败。UI 测试覆盖 ACP 路由、会话切换、命令、
工具差异展示和批量归档部分失败。以上使用本地协议 fixture，尚无法验收用户的私有智能体。

工作区类型检查和 lint 通过。ACP 后端 66 项、ACP UI 44 项、adapter/工具输出回归 40 项、
构建与发布契约 17 项通过，最终 OC1/OC2 回归 88 项通过。浏览器使用本地 fixture
验证了类型化表单提交、终端输出与差异同时展示、计划更新、连续第二轮运行，以及取消后进程退出。
Windows 目录比较兼容正反斜杠，不改写保存的智能体工作目录。移除五个未使用导出后，
死代码检查没有新增 ACP 问题。最初 Grok 调用遇到 HTTP 401 和 MCP 启动停滞。
后续已完成的 Grok 4.7 high 审查及 OpenCode/Qwen 真实验收见
[ACP 验收归档](ACP-ACCEPTANCE.zh-CN.md)。下方旧审查仅适用于早期基线。

## 早期基线验证

基线 workspace type-check、OC1/OC2 测试和 Web 构建通过。
真实 OpenCode 1.19.0 的 `--pure acp` 初始化与 session/new 已验证，声明了 loadSession；
尚未发送真实模型消息。精确 OpenCode 1.2.27 验证按仓库兼容策略延期。
stdio fixture 覆盖流、工具、精确权限选择、取消、退出和协议错误、无回退、恢复和重连。
本地 HTTP 集成验收覆盖连接选择、会话创建、消息流、审批回复、记录读取和
ACP 模式下拒绝 OpenCode 专属接口。
浏览器使用本地 stdio fixture 验证了显式选择、鼠标发送、原始权限回复、结果流和重连。
乐观更新与服务端记录合并后，每条用户消息只显示一次。
Grok 4.7 high 审查了应用和发布改动；其指出的记录保存失败问题已修复，
并用真实文件系统失败回归验证。最终运行时测试 12 项、会话操作测试 109 项通过。
这些证据不等于真实模型对话或所有设备的验收。
独立 ACP 通道见[构建说明](ACP-BUILD.zh-CN.md)。

英文维护说明：[ACP.md](ACP.md)。
