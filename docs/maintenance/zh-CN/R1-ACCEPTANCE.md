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

主机事件流 /api/openchamber/events 归 scheduled-tasks/routes.js；/api/notifications/stream 归 notifications/routes.js，在输出主机通知前调用会话 watcher，后端观察仍须经过其守卫归属。配置路由混合主机设置与 OpenCode 实体写入，config-entity-routes.js 使用既有 family guard。这些追踪用于确认归属，不代表全部调用方已通过运行时验收。下一步检查 global-hub.js 和 watcher.js 的 profile 准入，以及 git/routes.js 直接 OC2 工作树清理调用的 family/revision 准入。现有 family 退役测试不能证明 Legacy 事件流拒绝。生成的 managed-plugin 和桥接调用方仍需核对。

详细测试位置及源码指纹见 artifacts/int02-r1-clause-audit.json。保留历史证据，不改写其旧状态。验收此修正并核对剩余路由、插件和桥接条目后，才能宣布 R1 完成。打包运行时验收仍属 R7，精确 1.2.27 对话仍属 R2。
