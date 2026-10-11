# R1 验收复核

最初于 2026-10-11 对候选 7be9a791b548f7b89115291abedf94bff79a0a41 进行复核；当前状态以下方检查点为准。R1 / INT-01 和 INT-02 于 2026-10-11 通过验收，下一实施批次为 R2 / INT-03。证据及源码、运行时范围限制见 `artifacts/int02-r1-exit.json`。本记录补充[里程碑](OPENCODE-INTEGRATION-MILESTONES.md)，不改变验收条件。

## 当前检查点，2026-10-11

执行工作树为 `dijiang-next`，分支为 `codex/cagent-integration`。基线 `89a01dc8c2e2a511c9d73acc828bcaaabd38f1cc` 的工作区类型检查、lint 和构建通过；选定的五个 UI 测试集通过 133 项，五个 VS Code 契约测试集通过 30 项。这些是当前静态、构建和契约检查，不构成新的打包运行时或模型对话验收。

最终保留消费方审查发现，通知防抖及内容读取可能在所属连接切换后继续执行。针对原运行时的局部回归为九项失败、四项通过。修正捕获后端家族、修订及内核代际、profile、端点、epoch，清除旧防抖、缓存、去重和冷却状态，并在分发前拒绝过期的模板、父会话、目标查询及失败回退结果。生产组装直接读取既有内核描述，不为每次事件创建 SDK 客户端。最终局部测试通过 16 项；Web 类型检查、lint 和 JavaScript 语法检查通过。专项 oxlint 的 96 条告警均在未改动的基线行，新增代码行没有告警。此前扩大宿主范围的重跑没有可接受结果。范围复核发现它把 353 个混用测试框架的文件交给 Vitest，不能据最后输出归因为 TTS 故障。恢复原定 105 文件范围后，通过 1,461 项、平台跳过 2 项、失败 0 项。局部 TTS 两项也通过。当前结果见 `artifacts/int02-notification-host-scoped.json`；原中断日志保留并排除。证据见 `artifacts/int02-notification-owner-evidence.json`。

Web 和 Electron 复用修正后的宿主；托管移动端和 Capacitor 使用选定宿主；VS Code 保持自身原生通知归属。已经交给推送传输的通知无法撤回。本轮不声明真实推送/APNs、真实 CAgent、精确 Legacy 对话或新的打包运行时验收。

通知归属的生产宿主验证已通过四项检查，覆盖延迟旧结果拒绝、同名会话的新归属通知以及关闭时保留两个外部服务。首次探针遗漏原生通知开关，其正向验证失败已保留，不计入通过证据。见 `artifacts/int02-notification-production-evidence.json`。Knowledge 先读后写现捕获一次内核身份，并将其传入写入的 expectedIdentity。原实现四项新增回归失败，修正后 24 项通过；Web 类型检查及 lint 通过，assist/context 41 项通过。该修正只修改两个已有写入调用，没有新增框架或依赖。下方旧表保留原审查范围；后续浏览器关闭后的队列和待处理活动证据已覆盖其历史缺口。整个 R1 出口通过后再进入 R2。R2 验收精确 1.2.27 对话；R3 推进高级 Legacy 和设置；R4 处理重载；R5 完成菜单、分支上下文及快捷键；R6 完成剩余 CAgent 消费方迁移与离线工具包门槛；R7 进行集成构建和发布验收。真实 CAgent API 映射仍留在 CA-03 目标环境。英文用于开发交接，中文同步供审阅和归档。

## 当前条款核对

在候选 `f7d63e7fb` 上，扩大后的宿主回归首次通过 1,440 项、因平台跳过 2 项，就绪测试失败 1 项。该测试等待并行探测，但身份发现为避免向精确 Legacy 发送未知 API 路径，已采用先 health、后 info 的顺序。仅修正等待点后，仍保留拒绝旧连接结果的断言。同一范围的 105 个文件随后通过 1,441 项、跳过 2 项。就绪和身份的局部范围通过 62 项测试。修改测试的 oxlint 和差异检查通过。证据见 `artifacts/int02-r1-clause-reconciliation.json`。下表保留最初候选版本的历史范围。

当前浏览器关闭后的队列和待处理活动证据已覆盖此前缺失的流程。图片授权、插件和 agent-tool 入口、事件准入、工作树驱逐、搜索索引及 provider 快照已有边界复核。完整中立 CAgent 消费方迁移仍属 R6。

当前工作树已修复保留的会话快照隔离缺口。配置连接、请求或解析后的协议配置、后端家族或修订变化时，运行时清除旧状态、注意标记、待处理请求、活动和冷却计时器。同一归属的重连保留状态；托管重启成功后仍执行明确的中断处理。回归覆盖同名会话与过期冷却回调。105 个文件的宿主回归通过 1,448 项，另有两项平台跳过；web 类型检查和 lint 通过。专项 oxlint 的 82 条告警均位于未改动的基线代码行，修改的测试没有告警。使用两个合成上游服务的实际生产宿主通过四项快照、切换、同名会话及关闭检查。这是宿主集成证据，未覆盖模型对话、浏览器操作或打包验收。证据：`artifacts/int02-session-owner-evidence.json`。该历史检查点早于上方记录的最终验收。

| 要求 | 已检查证据 | 结论 |
| --- | --- | --- |
| 身份、选择与 profile 退役 | compatibility、kernel operation 和 SDK 退役契约；int02-r1-sdk-evidence.json | 已有契约证据。最新主机回归共 12 文件，366 通过、1 跳过。 |
| 五种模式、迁移与持久化 | int02-r1-current-modes-evidence.json | 基线 805881f73 上的真实 Windows OC2 检查通过 40 项。属于历史主机证据，不是模型对话。 |
| 自有进程、清理失败及外部进程保留 | int02-queue-evidence-native-evidence.json；occupied-port 和 console-window 证据 | 已有真实 Windows 证据，保留其原有源码范围。 |
| 待处理活动、队列意图和前一目标恢复 | int02-pending-host-evidence.json；int02-queue-target-final-evidence.json；peer-browser-cleanup.json | 生产主机、合成活动和真实 IDE 检查分别留有证据。后续关闭浏览器的直接证据见下文；此处保留原检查范围。 |
| 实际 Test/Cancel 控件与会话发现 | int02-r1-zero-evidence.json 和 int02-r1-native-evidence.json | 真实 OC2 的 VS Code 检查通过 44 项，不包含模型对话。 |
| 直接 SDK 消费方 | int02-r1-consumer-evidence.json 和 CAGENT-BOUNDARIES.md | 六个保留的 getter 消费方已有守卫或迁移归属说明。当前指纹记录在 int02-r1-clause-audit.json。 |
| 动态 HTTP 及生成插件、主机消费方 | SPEC 3.1 和下方路由归属追踪 | 下方追踪表记录保留归属、准入与迁移决定；knowledge 先读后写的归属修正已通过 24 项回归。 |
| 原功能回归 | int02-r1-zero-evidence.json；int02-r1-final-reconciliation.json | 历史 UI 检查及 Web/VS Code 构建通过。历史同步回归通过 81/82 文件，一项默认超时失败。在 `7115f32fb` 上，未调整超时的完整隔离同步回归通过全部 82 文件；独立保留测试通过 22 项。当前失败检查已通过，但这不构成性能预算验收。 |

## 保留路由及消费方追踪

2026-10-11 对当前执行工作树进行复核。下表记录保留边界，不代表 CAgent 支持。逐操作的 CAgent 迁移清单仍由 [CAgent 边界](CAGENT-BOUNDARIES.md)及其机器清单维护。

| 保留路径及消费方 | 所属模块及 profile 行为 | 迁移决定与验证 |
| --- | --- | --- |
| UI 会话状态、活动及快照 | `notifications/routes.js` 读取 watcher 和 `opencode/session-runtime.js`。生产组装提供后端家族、修订、配置目标及内核归属。归属变化清除活动、待处理决定及冷却状态。 | 保留宿主聚合，中立后端观察留在 R6。`session-runtime.test.js` 和 `int02-session-owner-host-evidence.json` 覆盖同名会话、退役及外部服务保留。 |
| UI `/api/openchamber/events` | `scheduled-tasks/routes.js` 和宿主广播器拥有此流；`openchamberEvents.ts` 负责运行时地址及重连身份。该流传递 OpenChamber 事件，各生产方负责涉及后端的准入。 | 保留宿主传输。`sse-routes.test.js` 和 `openchamberEvents.test.ts` 覆盖流生命周期及运行时退役。此行不授权上游调用。 |
| 通知 SSE、桌面通知及自主内容读取 | `notifications/routes.js`、`runtime.js` 和生产 `index.js` 负责分发。归属键拒绝 CAgent、Legacy 和未解析代际。注入的 kernel operations 负责会话及消息读取，延迟结果重新检查捕获的归属。原始 HTTP 回退属于独立组装分支，不是生产注入路径。 | 保留受保护的 OpenCode 内容读取及宿主投递，中立读取留在 R6。16 项专项测试及 `int02-notification-production-evidence.json` 覆盖旧结果拒绝、新通知及关闭。未验证真实推送/APNs。 |
| UI 归档、取消归档、会话元数据及 VS Code 元数据桥 | `openchamber-sessions/routes.js`、`session-metadata-store.js` 和 `bridge-system-runtime.ts` 拥有这些路径。后端写入经过受保护的 kernel operations；OC2 本地元数据捕获身份并在存储操作前后检查，OC1 保留已准入适配器。 | 保留宿主存储及受保护适配器。CAgent 命名空间及读取留在 R6。路由、存储测试和 `bridge-system-runtime.test.js` 覆盖失败、profile 准入及退役。 |
| 配置实体、插件、宿主设置及片段 | `config-entity-routes.js` 和 `plugin-routes.js` 捕获家族、修订、代际、profile、端点及 epoch，在副作用前拒绝不支持的归属并重新检查异步操作。宿主设置及片段由设置路由单独负责。 | 保留受保护协议路由及宿主设置。`config-entity-routes-dual.test.js`、`config-family.test.js` 和 `plugin-routes.test.js` 覆盖准入、生成文件及退役。共同 URL 前缀不意味着归属相同。 |
| VS Code 配置桥及生成的 agent-tool 调用 | `bridge-config-runtime.ts` 在 OC1/OC2 分发前进行 profile 准入，其 v2 模块检查异步身份。`agent-tool/dual-routes.js` 在代际分发前执行家族守卫。VS Code agent-proxy 仍明确返回 501。 | 保留受保护桥及生成路径，适配器绑定留在 R6。`bridge-config-runtime.test.js`、`dual-routes.test.js` 及代理测试覆盖拒绝与退役；一般原生流程不证明每个生成操作都已验收。 |
| 队列、计划任务、assist、goal、路由、控制、context 及 knowledge | 生产 `index.js` 注入受保护的 `kernelOperations`；队列还在取出意图前检查配置目标。独立 SDK/HTTP 回退分支不能证明生产绕过。Knowledge 元数据的先读后写需要共享捕获的归属。 | 保留所属模块，中立消费方迁移留在 R6。队列、计划任务、goal、路由及内核测试覆盖分发及退役。Knowledge 修正通过 24 项回归；真实内核操作的旧身份拒绝契约包含在当前 105 文件回归内。 |

Assist 和 context 在本地比较代际、端点及 epoch。生产内核在请求选择、解析后 profile、后端修订和端点改变时递增 epoch，因此这些比较能够覆盖生产环境的 profile 退役，字段列表较短不构成新增身份抽象的依据。Knowledge 的分离读取与写入确实存在未绑定写入，已在上表跟踪。

## 图片消息边界修正

基线 7be9a791b 的 Markdown 图片授权路由在主机文件授权前读取硬编码 OC1 消息地址，缺少 family/profile 准入和退役结果检查。修正后通过 kernelOperations.getMessageView 读取消息投影，并在异步操作后同时复核 kernel 身份及后台 family/revision。CAgent 和未验收 Legacy 在目录、后端或文件操作前即被拒绝。VS Code 文件桥保留明确的 501 响应。

精确来源匹配、代码围栏排除、文件签名、工作区/临时根目录限制及逐图片失败处理均保留。专项测试通过回环夹具验证两代真实 SDK 路径、消息缺失 404、上游失败 503、准入拒绝，以及目录验证、消息读取和文件检查期间的退役。这些夹具验证路由契约，不代表真实上游或打包运行时验收。未新增传输、缓存或重试层。验证结果和最终源码指纹记录在 artifacts/int02-r1-image-evidence.json。

运行时范围：Web/Electron 共用主机路由；托管移动端和 Capacitor 使用所选主机；VS Code 保留明确不支持响应。真实 CAgent 映射仍属 CA-03，中立消费方迁移仍属 R6，但不能因迁移在后续而接受当前无守卫的调用。

已完成的边界复核覆盖 HTTP 路由入口、异步退役、事件投递和托管插件准备。本次复核的插件与 agent-tool 入口拒绝非 OpenCode family 和未验收的 Legacy profile。插件路由会在目录解析期间及变更前保存并复核 family/revision 与 kernel 身份。全局事件 hub 在提交事件时负责 kernel/epoch 拒绝；watcher 检查当前 family/revision 和 Legacy 准入，独立 reader 还会检查所附 kernel。Git 工作树清理在等待前捕获 family/revision 与 kernel 身份，并在清理前复核。生产组合将所选 host 传给这些守卫，并把共享 hub 接入 watcher。agent-tool 回调在 family/profile 准入后按 OC1/OC2 分发；托管准备使用 family/revision lease，但代际探测本身不会禁用所有 Legacy 插件准备。

VS Code agent proxy 仍会在转发前返回 501。适配器绑定仍是计划项，`packages/vscode/src/bridge-proxy-runtime.ts` 及其测试验证了这一点。当前复核记录和指纹见 `artifacts/int02-r1-boundary-evidence.json`；保留既有证据计数及其原始范围。后续工作流证据覆盖了队列、浏览器关闭和连接切换验收旅程。精确 Legacy 对话属于 R2，消费方迁移属于 R6，打包验收属于 R7。浏览器关闭旅程必须确认自有待处理活动和队列意图在关闭后仍保留，不能声称进行中的请求已恢复。最终边界测试通过 14 个文件、171 项测试，包括同目标 watcher 重启和八项真实 Git/回环 HTTP 清理测试。这些契约不能证明真实 CAgent 或打包宿主行为。

## 当前工作流证据，2026-10-11

候选 `42c6f7396` 通过真实 Windows OC2 2.0.20 主机的 24 项检查。实际 React 设置组件完成确认、重试、外部替换失败和复核后恢复之前的托管目标。生产检查验证旧 PID 退出、唯一替换进程、设置持久化、确认票据拒绝重放、同目标重启后队列归属保留，以及显式编辑/取回。证据见 `artifacts/int02-r1-workflow-managed-current-evidence.json`。这是会话及控件验收，未调用模型对话。日志保留客户端尚未绑定时被捕获的冷启动 `session.list` 拒绝；最终绑定、连接状态和恢复断言均通过，不能声称控制台无错误。

真实 Chrome 页面在合成 OC1 上游报告忙碌时通过生产队列 API 入队。测试页关闭后，持久化意图仍保留原配置目标指纹，且尚未发送提示词。独立上游空闲事件随后触发唯一一次发送，文本和模型与捕获值一致，队列变为空。主机关闭保留外部服务，托管注册表为空。证据见 `artifacts/int02-r1-browser-queue-evidence.json`。这证明队列可独立于浏览器投递，不代表输入框控件、真实上游/模型或进行中请求恢复验收。稀疏夹具导致无关启动 API 报错，不能据此声称完整页面回归通过。

当前队列/切换专项回归通过两个文件的 68 项测试。检查进程、注册表和路径后已清理两个夹具目录及一次性脚本，保留具名证据和清理记录。本检查点未修改生产代码、依赖、远端分支或 Release。

候选 `80bc7fd0f` 增加合成 OC2 上游下的 11 项生产主机检查。真实 Chrome 页面读取到一个忙碌会话、一个待处理权限和一个待处理问题后关闭。独立主机检查仍能观察到三项活动，并在不触发中断的情况下拒绝替换。权限状态未知时也会阻止替换，同时保留其他活动类别。显式停止必须确认权威空闲状态后才能提交，确认票据拒绝重放，主机退出保留外部服务。证据见 `artifacts/int02-r1-pending-closed-evidence.json`。首次未建立认证的夹具尝试不计入验收。检查进程、注册表和路径后已清理夹具目录及一次性脚本。这覆盖浏览器关闭后的待处理活动和主机切换，不代表决策按钮、完整页面回归或真实模型对话验收。

消息搜索索引现在会拒绝运行时失效后返回的会话、消息及回填结果。搜索和状态查询保持只读；停止、删除索引和重启仍由已有内核切换流程负责。provider 快照、共享读取、失败回退和 OC2 默认模型结果现在限定于捕获的连接及 reset 标记。本次未新增轮询、依赖或生命周期控制器。新增回归测试在原实现上复现了 3 项搜索失败和 9 项 provider 失败。最终原生 Node 验证在 7 个文件中通过 151 项测试，包含 SQLite 和两项真实回环 provider 流程；UI 队列通过 13 项测试。Web 类型检查、lint 和四个宿主 JavaScript 文件的语法检查通过。死代码统计仍为 2 个文件、319 个导出和 231 个类型。Oxlint 报告 62 项既有提示，新增行上为 0 项。证据：`artifacts/int02-r1-consumer-lease-evidence.json`。这些检查不证明真实模型对话或打包宿主验收。

R1 已通过连接及 profile 流程验收。当前 UI 和扩展源码与后续 24 项 Windows 工作流基线一致，扩展源码也与 44 项原生验收基线一致。四个原生进程归属文件的哈希与控制台观测一致，但生成的 UI 包不同，仍保留历史观测范围。见 `artifacts/int02-r1-exit.json`。精确 Legacy 对话属于 R2，完整 CAgent 迁移属于 R6，打包验收属于 R7。
