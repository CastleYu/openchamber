# 队列与连接生命周期排空

英文交付契约位于 packages/web/server/lib/message-queue/DOCUMENTATION.md 的 Saved-target restart boundary，以及 packages/web/server/lib/opencode/DOCUMENTATION.md 的 Saved-target queue drain。本中文副本与上述修改同步，供归档和评审。

重启先验证已保存目标，再暂停队列计时器和新入队。尚未进入发送的状态读取完成后退出；已经进入的请求不会被取消或重放。宿主等待这些派发及其后续落盘完成，才退役端点并关闭自有进程。恢复函数幂等，已停止的队列不会再次启动。

排空上限为 15 秒。超时恢复派发，并在原连接仍存活时拒绝重启。落盘失败也阻止退役；后续成功落盘才清除该失败。清理或启动失败会释放暂停，已有就绪状态和身份检查仍阻止向不可用后端派发。

Web 宿主拥有此流程，Electron 在进程内复用；托管和 Capacitor 移动端观察所连宿主。VS Code 保留自己的前台队列，暂不支持已保存记录切换。未改变队列接口或持久化格式；每次派发只记录一个在途 Promise，明确重启时进行一次有上限的等待，没有新增上游请求或轮询。

此流程只重启已确认保存的目标，不允许将排队意图转移给其他目标。忙碌会话、排队意图、待处理批准和其他客户端确认尚未完成，活动连接记录修改仍由宿主拒绝。真实子进程加合成派发的组合验证证明退出顺序；真实 OC2 的宿主检查证明空队列接线与正常生命周期，不代表真实模型请求、CAgent、Legacy 或打包运行时验收。

## 确认配置提交事务

英文交付契约见 [OpenCode 模块文档](../../../packages/web/server/lib/opencode/DOCUMENTATION.md#confirmed-settings-transaction)。现有生命周期 owner 通过内部 restartOpenCode(reason, { resolve, commit }) 承接替换。resolve 在队列暂停及退休前验证并返回准备好的候选；排空后观察旧自有进程退出，commit 再保存确认记录并返回配置 owner 提交的精确后端选择。只有 connectionRevision 可改变，后端类型／revision 退休或返回旧选择时拒绝启动。启动使用准备好的候选，不重新读取旧目标。冲突替换返回 409。

验证失败保留旧可用连接；清理失败保留归属；保存或启动失败呈现明确失败状态。后续显式事务可返回保存的旧目标，外部进程保持非自有。此内部契约尚不是 HTTP 授权入口，公开活动写入仍为 409。确认／配置权限、活动与客户端决策、恢复操作、共享编辑器及 VS Code 接入仍是 R1 验收前置。Web、Electron、托管及 Capacitor 移动端共用宿主 owner；VS Code 保留现有不支持边界。
