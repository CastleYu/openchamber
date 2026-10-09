# Legacy 1.2.27 证据检查点

更新于 2026-10-09，OpenChamber 基线为 `ca43c5a01`。INT-00L 正在执行。本检查点记录准确源码／schema 证据，实际二进制验收仍未完成。CAgent 临时 Release 已交付。后续遵循[里程碑队列](OPENCODE-INTEGRATION-MILESTONES.md)。

## 固定来源

- 官方 [v1.2.27 Release](https://github.com/anomalyco/opencode/releases/tag/v1.2.27)。
- 标签直接指向提交 `4ee426ba549131c4903a71dfb6259200467aca81`；Release 的可变目标标签为 `dev`，不能作为源码固定依据。
- [该提交的 OpenAPI](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/sdk/openapi.json)：SHA-256 为 `ef236d6647f0b462ac7fb03454ae1a75575d951ff75021d7af7b38c8c34a84dd`；86 条路径、104 项操作。其 `info.version` 为 `1.0.0`，不能识别运行时版本。
- 官方 Windows x64 ZIP 资产 ID 为 `374649821`，预期大小 47,156,872 字节，Release 摘要为 `9e2e43568e6f952e8c7cb77b934fbff53f454f0213688f24f3c3769b69703e84`。下载不代表二进制验收。采集夹具前须核对完整压缩包摘要、解压后程序摘要、`--version` 和实际健康响应身份。

## 已验证源码契约

| 分组 | 准确源码／schema 发现 | 实施影响／剩余证据 |
| --- | --- | --- |
| L01 身份 | `GET /global/health` 声明 healthy/version；服务器使用可选 HTTP Basic 鉴权。此 OpenAPI 没有 /api/info。 | 使用准确凭据探测所选端点，实测回退与失败；不以 OpenAPI info.version 作为身份。 |
| L02 会话 | 创建接收 parentID/title/permission/workspaceID。更新接收 title/time.archived。两者均不接收 metadata；路由仅更新标题／归档时间。 | 当前依赖 metadata 的功能需要明确归属的补充记录及往返验证。HTTP 成功不等于 metadata 已保存。 |
| L03 分发 | prompt_async 声明 HTTP 204 接收；请求接收 messageID/model/agent/parts 等声明字段。 | 接收不等于完成。幂等／结果查询保证未证实；保留未知结果策略。 |
| L04 shell | OpenAPI 与路由响应注解声明裸 AssistantMessage，但处理器返回 SessionPrompt.shell 的结果。 | 投影前采集实际程序响应；仅有注解不能证明实现的封装结构。 |
| L05 diff | FileDiff 必需 file/before/after/additions/deletions，status 可选。 | 保留完整 before/after；真实空响应不能验证非空 diff 映射。 |
| L06 决策 | 权限、问题的列表／答复路由存在。PermissionRequest 声明 id/sessionID/permission/patterns/metadata/always，QuestionRequest 声明 id/sessionID/questions。 | 验收操作前采集真实待决请求及事件／答复／重连行为。 |
| L09 事件 | /event 与 /global/event 声明 SSE。 | 首次连接、顺序、完成与恢复仍需程序证据；未建立重放保证。 |
| L12 清理 | POST /instance/dispose 调用 Instance.dispose；POST /global/dispose 调用 Instance.disposeAll，均声明布尔响应。 | 使用两个隔离目录实测作用域与恢复；不将目录清理升级为全局清理。 |

源码归属为 [server.ts](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/server/server.ts)，以及同提交的 global/session/permission/question/config 路由。源码证据不证明实际鉴权、响应、模型执行、插件兼容、宿主一致性或存储隔离。

## 下一步验收

完成官方二进制下载并验证摘要。仅在新隔离工作目录，以 loopback 启动该程序，分别设置 XDG 数据／配置／缓存／状态及测试 home。禁用自动更新、默认插件、模型拉取、项目配置、外部 skills 与 LSP 下载；只继承必要系统变量。使用新生成的测试 Basic 密码，不记录或持久化密码。

采集脱敏身份、未授权响应、路径／项目／目录读取、会话创建／读取／历史／更新、无效输入与缺失会话错误、初始 SSE、双目录／全局清理。随后获取受控提示／工具／决策夹具，支撑首次 Legacy 会话。未解决操作和宿主门槛保持开放；实验 profile 在实现验收前保持禁用。本次仅采证据，不改变既有 OC1/OC2 与已发布 CAgent 预览。
