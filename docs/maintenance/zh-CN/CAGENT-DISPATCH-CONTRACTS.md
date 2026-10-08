# Agent 调度契约

英文源文档：[模块文档](../../../packages/web/server/lib/agent/DOCUMENTATION.md)。本模块实现 CA-01 的一部分。服务器已预留经过认证的自有路由，但绑定尚未启用，CAgent 不可用。现有 OpenCode 运行行为保持不变。剩余迁移见[执行检查点](CAGENT-EXECUTION.md)。

`constants.js` 集中定义后端类型、支持状态、操作及拒绝常量。`dispatcher.d.ts` 为宿主清单中的 22 项读取和变更操作定义运行时中立的请求与结果。身份捕获是第 23 项宿主操作，由调度器而非适配器负责。工作区 ID 是后端拥有的标识，不能默认为本地目录。这些契约不要求 SDK 原始载荷。迁移验收前，仍需依据调用方语义补充更完整的消息、决策及 UI 操作契约。

`createAgentDispatcher({ getBinding })` 在调用时读取宿主权威状态。适配器提供处理器与候选支持声明，独立的宿主验收记录才授予精确适配器修订与能力修订下的访问权限。没有证据及匹配验收记录的支持声明会被拒绝。未验证、不支持、认证失败、未就绪与缺少处理器分别返回不同结果。

`schemas.js` 严格解析全部 22 项操作的输入和输出。调度把解析后的请求副本交给处理器，并返回解析后的结果副本。缺失标识符、无效枚举和多余字段均被拒绝。调度复制后端身份，并在进入处理器前再次检查。身份变化后，读取拒绝过时数据。已进入处理器的变更操作在处理器失败、结果格式无效或身份变化时报告结果未知。身份没有变化时，读取错误交给所属边界处理。本模块不重试、不回退、不跨后端重放。生产接入变更操作前，仍必须完成持久化尝试记录。

宿主组合必须提供规范化且不可变的绑定。启用记录与处理器注册必须位于环境内 Agent 可写文件之外。manifest 不能直接构造此权限。每个处理器还必须解析真实服务器的响应，再投影为领域数据。这些 schema 验证的是中立契约，不能证明未公开的 CAgent 线路语义。

`routes.js` 负责 GET `/api/agent-backend/runtime` 与 POST `/api/agent-backend/dispatch`。服务器组合将其挂在现有 API 认证门之后、通用 OpenCode 代理注册之前。调度请求必须提供精确的预期身份。路由拥有自己的 JSON 解析器，只返回固定拒绝码，不返回适配器异常文本。未知路径及方法在此命名空间内终止。全部 11 项 HTTP 变更操作在接入持久化的调用前尝试记录之前返回 `write-unavailable`。当前生产调度器没有绑定，因此读取和运行时身份返回 `unavailable`。目前没有设置或适配器 manifest 能改变这一状态。

| 运行时 | 当前行为 |
| --- | --- |
| Web | 自有路由已注册，绑定未启用。读取返回 503；变更返回 503 `write-unavailable`。CAgent 不可用。 |
| Electron | 复用进程内 Web 后端及其拒绝行为，不复制原生协议实现。CAgent 不可用。 |
| VS Code | Webview 与扩展宿主通用代理均以 501 `unsupported-runtime` 拒绝自有 Agent 路由，不转发到 OpenCode。CAgent 不可用。 |
| 托管移动端 | 所选 OpenChamber 服务器暴露相同的未启用路由及拒绝行为。CAgent 不可用。 |
| Capacitor | 所选 OpenChamber 服务器暴露相同的未启用路由及拒绝行为。CAgent 不可用。 |

聚焦验证使用包内 Vitest 运行器执行 `server/lib/agent/{dispatcher,schemas,routes}.test.js` 与 `contracts.test.ts`。HTTP 测试使用真实 Express 请求、测试认证门及合成的已验收绑定，覆盖请求体解析、拒绝码、身份、无效请求/结果、变更关闭和代理隔离。测试未启动完整生产服务器，也不能证明真实 CAgent 兼容。VS Code 的 `src/bridge-proxy-runtime.test.js` 检查本地或上游转发之前的拒绝。还须使用已安装的 TypeScript 编译器直接编译 `contracts.test.ts`。其中仅用于编译的调用检查逐操作结果类型、完整的操作键覆盖，以及缺少工作区/请求身份和未知操作时的拒绝。Web 工作区常规类型检查仅包含 UI/src，而不包含服务器声明文件。
