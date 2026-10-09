# 活动连接检查归档

英文交付契约位于 [OpenCode 模块文档](../../../packages/web/server/lib/opencode/DOCUMENTATION.md#activity-inspection-before-active-replacement)。

GET /api/config/opencode-connection/activity 要求宿主鉴权，使用 no-store，返回宿主 active、inactive 或 transitioning 状态、检查范围，以及忙碌会话、批准、问题或表单、队列、客户端的检查结果。

检查直接调用 generation-bound kernel SDK。OC1 使用 question.list，OC2 使用 form.list，保留各自请求方法、目录参数、认证及取消信号。输入记录只投影请求 ID 和会话 ID，不包含问题、答案或表单字段。未完整初始化的事件缓存不能证明没有待处理请求。

OC2 忙碌状态覆盖全局，OC1 覆盖列出的目录。批准和问题或表单覆盖宿主工作目录、配置项目目录及队列目录。known/count 表示该范围读取成功后的去重数量。空目录集或某个范围读取失败时，类别返回 unknown/observedCount，后者仅为成功范围的已观察下限；其他完整类别仍可返回。未就绪或正在切换的宿主保留上游状态为未知。

客户端始终为未知。事件订阅数量无法识别其他用户或标签页。队列数量来自现有队列运行时加载后的内存投影，包含 revision 和已进入的派发数量，不证明持久化原连接归属。队列加载仍遵循既有恢复行为。

队列或权威设置读取失败返回 503 activity_unavailable。内核身份、就绪状态、切换状态或队列 revision 在读取中改变时，返回 409 activity_changed。未支持的 profile 或运行时返回 501 unsupported_runtime。响应不包含端点、凭据、排队文本或输入载荷。检查不启动、停止或替换连接。

Web 与 Electron 使用同一宿主接口。Hosted mobile 与 Capacitor 检查所选宿主。VS Code 在通用代理转发前明确返回 501。

这个快照不是切换授权，也不是上游原子事务。活动连接记录变更仍返回 409。后续必须完成确认界面、客户端协调和队列原目标持久化，才能放行活动替换。
