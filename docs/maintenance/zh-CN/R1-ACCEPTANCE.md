# R1 验收复核

2026-10-11 对候选 7be9a791b548f7b89115291abedf94bff79a0a41 进行复核。R1 保持打开。本记录补充[里程碑](OPENCODE-INTEGRATION-MILESTONES.md)，不改变验收条件。

| 要求 | 已检查证据 | 结论 |
| --- | --- | --- |
| 身份、选择与 profile 退役 | compatibility、kernel operation 和 SDK 退役契约；int02-r1-sdk-evidence.json | 已有契约证据。最新主机回归共 12 文件，366 通过、1 跳过。 |
| 五种模式、迁移与持久化 | int02-r1-current-modes-evidence.json | 基线 805881f73 上的真实 Windows OC2 检查通过 40 项。属于历史主机证据，不是模型对话。 |
| 自有进程、清理失败及外部进程保留 | int02-queue-evidence-native-evidence.json；occupied-port 和 console-window 证据 | 已有真实 Windows 证据，保留其原有源码范围。 |
| 待处理活动、队列意图和前一目标恢复 | int02-pending-host-evidence.json；int02-queue-target-final-evidence.json；peer-browser-cleanup.json | 生产主机、合成活动和真实 IDE 检查分别留有证据。已检查队列测试名称未直接覆盖关闭浏览器。 |
| 实际 Test/Cancel 控件与会话发现 | int02-r1-zero-evidence.json 和 int02-r1-native-evidence.json | 真实 OC2 的 VS Code 检查通过 44 项，不包含模型对话。 |
| 直接 SDK 消费方 | int02-r1-consumer-evidence.json 和 CAGENT-BOUNDARIES.md | 六个保留的 getter 消费方已有守卫或迁移归属说明。当前指纹记录在 int02-r1-clause-audit.json。 |
| 动态 HTTP 及生成插件、主机消费方 | SPEC 3.1 和下方路由归属追踪 | 未完成。既有清单含暂定分类，不能证明所有保留调用都有守卫。 |
| 原功能回归 | int02-r1-zero-evidence.json | UI 检查及 Web/VS Code 构建通过。同步测试通过 81/82 文件；保留测试仍超过默认超时，其 22 项测试在 30 秒超时下通过。 |

## 图片消息边界修正

基线 7be9a791b 的 Markdown 图片授权路由在主机文件授权前读取硬编码 OC1 消息地址，缺少 family/profile 准入和退役结果检查。修正后通过 kernelOperations.getMessageView 读取消息投影，并在异步操作后同时复核 kernel 身份及后台 family/revision。CAgent 和未验收 Legacy 在目录、后端或文件操作前即被拒绝。VS Code 文件桥保留明确的 501 响应。

精确来源匹配、代码围栏排除、文件签名、工作区/临时根目录限制及逐图片失败处理均保留。专项测试通过回环夹具验证两代真实 SDK 路径、消息缺失 404、上游失败 503、准入拒绝，以及目录验证、消息读取和文件检查期间的退役。这些夹具验证路由契约，不代表真实上游或打包运行时验收。未新增传输、缓存或重试层。验证结果和最终源码指纹记录在 artifacts/int02-r1-image-evidence.json。

运行时范围：Web/Electron 共用主机路由；托管移动端和 Capacitor 使用所选主机；VS Code 保留明确不支持响应。真实 CAgent 映射仍属 CA-03，中立消费方迁移仍属 R6，但不能因迁移在后续而接受当前无守卫的调用。

已完成的边界复核覆盖 HTTP 路由入口、异步退役、事件投递和托管插件准备。本次复核的插件与 agent-tool 入口拒绝非 OpenCode family 和未验收的 Legacy profile。插件路由会在目录解析期间及变更前保存并复核 family/revision 与 kernel 身份。全局事件 hub 在提交事件时负责 kernel/epoch 拒绝；watcher 检查当前 family/revision 和 Legacy 准入，独立 reader 还会检查所附 kernel。Git 工作树清理在等待前捕获 family/revision 与 kernel 身份，并在清理前复核。生产组合将所选 host 传给这些守卫，并把共享 hub 接入 watcher。agent-tool 回调在 family/profile 准入后按 OC1/OC2 分发；托管准备使用 family/revision lease，但代际探测本身不会禁用所有 Legacy 插件准备。

VS Code agent proxy 仍会在转发前返回 501。适配器绑定仍是计划项，`packages/vscode/src/bridge-proxy-runtime.ts` 及其测试验证了这一点。当前复核记录和指纹见 `artifacts/int02-r1-boundary-evidence.json`；保留既有证据计数及其原始范围。R1 仍未完成，剩余事项包括队列、浏览器关闭和连接切换验收旅程。精确 Legacy 对话属于 R2，消费方迁移属于 R6，打包验收属于 R7。浏览器关闭旅程必须确认自有待处理活动和队列意图在关闭后仍保留，不能声称进行中的请求已恢复。最终边界测试通过 14 个文件、171 项测试，包括同目标 watcher 重启和八项真实 Git/回环 HTTP 清理测试。这些契约不能证明真实 CAgent 或打包宿主行为。

## 当前工作流证据，2026-10-11

候选 `42c6f7396` 通过真实 Windows OC2 2.0.20 主机的 24 项检查。实际 React 设置组件完成确认、重试、外部替换失败和复核后恢复之前的托管目标。生产检查验证旧 PID 退出、唯一替换进程、设置持久化、确认票据拒绝重放、同目标重启后队列归属保留，以及显式编辑/取回。证据见 `artifacts/int02-r1-workflow-managed-current-evidence.json`。这是会话及控件验收，未调用模型对话。日志保留客户端尚未绑定时被捕获的冷启动 `session.list` 拒绝；最终绑定、连接状态和恢复断言均通过，不能声称控制台无错误。

真实 Chrome 页面在合成 OC1 上游报告忙碌时通过生产队列 API 入队。测试页关闭后，持久化意图仍保留原配置目标指纹，且尚未发送提示词。独立上游空闲事件随后触发唯一一次发送，文本和模型与捕获值一致，队列变为空。主机关闭保留外部服务，托管注册表为空。证据见 `artifacts/int02-r1-browser-queue-evidence.json`。这证明队列可独立于浏览器投递，不代表输入框控件、真实上游/模型或进行中请求恢复验收。稀疏夹具导致无关启动 API 报错，不能据此声称完整页面回归通过。

当前队列/切换专项回归通过两个文件的 68 项测试。检查进程、注册表和路径后已清理两个夹具目录及一次性脚本，保留具名证据和清理记录。本检查点未修改生产代码、依赖、远端分支或 Release。

候选 `80bc7fd0f` 增加合成 OC2 上游下的 11 项生产主机检查。真实 Chrome 页面读取到一个忙碌会话、一个待处理权限和一个待处理问题后关闭。独立主机检查仍能观察到三项活动，并在不触发中断的情况下拒绝替换。权限状态未知时也会阻止替换，同时保留其他活动类别。显式停止必须确认权威空闲状态后才能提交，确认票据拒绝重放，主机退出保留外部服务。证据见 `artifacts/int02-r1-pending-closed-evidence.json`。首次未建立认证的夹具尝试不计入验收。检查进程、注册表和路径后已清理夹具目录及一次性脚本。这覆盖浏览器关闭后的待处理活动和主机切换，不代表决策按钮、完整页面回归或真实模型对话验收。

消息搜索索引现在会拒绝运行时失效后返回的会话、消息及回填结果。搜索和状态查询保持只读；停止、删除索引和重启仍由已有内核切换流程负责。provider 快照、共享读取、失败回退和 OC2 默认模型结果现在限定于捕获的连接及 reset 标记。本次未新增轮询、依赖或生命周期控制器。新增回归测试在原实现上复现了 3 项搜索失败和 9 项 provider 失败。最终原生 Node 验证在 7 个文件中通过 151 项测试，包含 SQLite 和两项真实回环 provider 流程；UI 队列通过 13 项测试。Web 类型检查、lint 和四个宿主 JavaScript 文件的语法检查通过。死代码统计仍为 2 个文件、319 个导出和 231 个类型。Oxlint 报告 62 项既有提示，新增行上为 0 项。证据：`artifacts/int02-r1-consumer-lease-evidence.json`。这些检查不证明真实模型对话或打包宿主验收。

R1 继续保持未完成，需做最终条款核对，以及补齐仍缺少准入或退役证据的保留消费方。已覆盖条款采用当前证据，历史证据保留原源码范围。打包验收仍属 R7，精确 Legacy 对话仍属 R2。