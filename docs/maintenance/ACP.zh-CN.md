# ACP 中文归档

本分支基于 `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6`，版本为
`2.0.4-DIJIANG.4.0`，是 5.X 分支分出前的最后一个 4.X 基线。
开发与[便携构建](ACP-BUILD.zh-CN.md)使用 `codex/acp-integration`。
下述显式选择落实 DEV-PLAN 第 3.2 节，作用于 OpenChamber 后端。
独立 VS Code 扩展保留自己的 OpenCode 启动器。

启动时或在 OpenCode 设置中选择连接方式：外部 OpenCode 服务、指定命令、PATH、
内置 OpenCode，或 ACP stdio 命令。历史设置只预填，需要确认后连接。
连接失败会显示错误，不会自动更换地址或程序；环境变量不决定连接模式。

连接选项保存在 `agent-connection.json`，ACP 会保存工作目录。失败后点击应用即可重试。
切换时会停止托管子进程；外部 OpenCode 仍由原有管理者运行。

ACP 需要可执行程序、参数和绝对工作目录。例如选择已安装的 `opencode.exe`，
参数分别填写 `--pure` 和 `acp`。脚本需要明确选择解释器，例如 `node` 加脚本路径。
后端直接启动所选程序，在切换连接或退出时停止自己管理的进程。

当前支持 ACP v1 stdio：初始化、创建会话、发送消息、文本与思考流、工具更新、
权限选项和取消。权限卡保留智能体提供的选项名称及 ID，不套用 OpenCode 自动批准策略。
模型由智能体管理，发送消息不要求 OpenCode provider/model。
图片需要智能体声明图片能力；文件链接使用 ACP resource_link。
客户端不声明文件系统或终端服务能力。

Web、Electron、托管移动端和 Capacitor 通过 OpenChamber 后端使用共享聊天。
独立 VS Code 宿主不支持 ACP。OpenCode 的 fork、revert、分享、provider 配置、
MCP、skills 和后台 shell 操作需要切回 OpenCode。
后端提供 ACP 认证和会话模式操作；专用认证与模式选择界面不在本次范围内。

记录保存在 OpenChamber 数据目录的 `acp-sessions.json`。
重连同步完整记录；启动相同命令后，仅在智能体声明 `loadSession` 时恢复原会话。
不支持恢复时保留只读记录；恢复失败显示错误，不会悄悄新建替代会话。

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
