# 活动连接检查归档

英文交付契约位于 [OpenCode 模块文档](../../../packages/web/server/lib/opencode/DOCUMENTATION.md#activity-inspection-before-active-replacement)。

GET /api/config/opencode-connection/activity 要求宿主鉴权，使用 no-store，返回宿主 active、inactive 或 transitioning 状态、检查范围，以及忙碌会话、批准、问题或表单、队列、客户端的检查结果。

检查直接调用 generation-bound kernel SDK。OC1 使用 question.list，OC2 使用 form.list，保留各自请求方法、目录参数、认证及取消信号。输入记录只投影请求 ID 和会话 ID，不包含问题、答案或表单字段。未完整初始化的事件缓存不能证明没有待处理请求。

OC2 忙碌状态覆盖全局，OC1 覆盖列出的目录。批准和问题或表单覆盖宿主工作目录、配置项目目录及队列目录。known/count 表示该范围读取成功后的去重数量。空目录集或某个范围读取失败时，类别返回 unknown/observedCount，后者仅为成功范围的已观察下限；其他完整类别仍可返回。未就绪或正在切换的宿主保留上游状态为未知。

客户端始终为未知。事件订阅数量无法识别其他用户或标签页。传入队列归属方时，队列数量来自其加载后的内存投影，包含 revision 和已进入的派发数量，不证明持久化原连接归属。显式传入 queue: null 表示宿主不能观察客户端队列，此时只返回 unknown/observedCount 0，不包含 count、sending 或 revision。权威队列读取失败仍使检查失败，不能当作成功的未知分支。队列加载仍遵循既有恢复行为。

队列或权威设置读取失败返回 503 activity_unavailable。内核身份、就绪状态、切换状态或队列 revision 在读取中改变时，返回 409 activity_changed。未支持的 profile 或运行时返回 501 unsupported_runtime。响应不包含端点、凭据、排队文本或输入载荷。检查不启动、停止或替换连接。

Web 与 Electron 使用同一宿主接口。Hosted mobile 与 Capacitor 检查所选宿主。VS Code 专用连接桥接组合相同的检查模块，但不传入队列归属方，因此客户端队列始终未知。

这个快照不是切换授权，也不是上游原子事务。普通活动配置写入仍返回 409。下面的宿主确认 owner 在队列排空后重新检查活动；共享确认界面和客户端协调仍待完成。队列意图已持久保留原配置目标。

## 宿主连接确认

POST /api/config/opencode-connection/prepare 接受 { source: "candidate", connection } 或 { source: "previous" }。connection-switch.js 解析和验证选中记录，不写配置，保存一个待确认候选，返回 { token, connection, activity }。token 绑定后端选择、连接 revision 和 descriptor 身份，不包含已解析环境值。准备另一候选会替换原 token。

POST /api/config/opencode-connection/apply 要求 { token, decision: "wait" | "stop", acknowledgeClients: true }。客户端仍未知，确认不代表已测量数量。队列排空后、退休前，owner 重新核对持久配置和活动。wait 要求已就绪上游返回权威空闲的会话、批准和问题，否则 409。stop 明确允许退休托管进程；外部目标由 connection-activity.js 通过所选 SDK 中断忙碌会话，再复查状态。活动未知、读取失败或中断尚未完成时保留旧连接。不杀死外部进程。队列意图仍归属原配置目标。

只有可信宿主 owner 在观察自有进程退出后传入私有设置许可，JSON 请求无法授予许可。候选无效或新活动拒绝时保留就绪状态；退休后失败留下选中目标的失败状态，不自动回退。启动失败返回 503 connection_failed。成功确认消费 token，旧确认返回 409 connection_changed。GET /api/config/opencode-connection/previous 返回旧配置备份中的 { connection }；恢复必须重新 prepare source previous 并按同一 apply 流程确认。

三个接口要求宿主鉴权、使用 no-store 并在上游代理前注册。Web 与 Electron 共用 owner，Hosted mobile 与 Capacitor 调用所选宿主。VS Code 专用桥接在通用代理前处理连接接口。CAgent 不进入 OpenCode 确认 owner。共享设置编辑器已接入活动确认／恢复接口；完整 webview 流程、队列原目标派发边界及客户端协调仍待验收，本检查点不代表 R1 完成。
