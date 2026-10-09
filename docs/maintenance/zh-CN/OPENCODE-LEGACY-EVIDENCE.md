# Legacy 1.2.27 证据检查点

更新于 2026-10-09，OpenChamber 基线为 `ca43c5a01`。INT-00L 正在执行。本检查点记录准确源码／schema 及官方程序的 27 项检查。完整对话和清理作用域门槛仍未关闭。CAgent 临时 Release 已交付。后续遵循[里程碑队列](OPENCODE-INTEGRATION-MILESTONES.md)。

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
| L04 shell | OpenAPI 与路由注解声明裸 AssistantMessage。SessionPrompt.shell 返回 `{info, parts}`；官方程序执行 echo 后也返回此结构。 | 按实测封装进行投影，不能把响应注解当作实现契约。 |
| L05 diff | FileDiff 必需 file/before/after/additions/deletions，status 可选。 | 保留完整 before/after；真实空响应不能验证非空 diff 映射。 |
| L06 决策 | 权限、问题的列表／答复路由存在。PermissionRequest 声明 id/sessionID/permission/patterns/metadata/always，QuestionRequest 声明 id/sessionID/questions。 | 验收操作前采集真实待决请求及事件／答复／重连行为。 |
| L09 事件 | /event 与 /global/event 声明 SSE。 | 首次连接、顺序、完成与恢复仍需程序证据；未建立重放保证。 |
| L12 清理 | POST /instance/dispose 调用 Instance.dispose；POST /global/dispose 调用 Instance.disposeAll，均声明布尔响应。 | 使用两个隔离目录实测作用域与恢复；不将目录清理升级为全局清理。 |

源码归属为 [server.ts](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/server/server.ts)，以及同提交的 global/session/permission/question/config 路由。源码证据不证明实际鉴权、响应、模型执行、插件兼容、宿主一致性或存储隔离。

## 程序实测检查点

完整 ZIP 已匹配官方摘要。解压后程序 SHA-256 为 `dc9c7a2f97101329459fc46500913cc0c9d6514c39a6820fc720423ad04823b4`；`--version` 和鉴权健康响应均为 1.2.27。程序在 loopback 启动，分别设置 XDG 数据／配置／缓存／状态及测试 home。禁用自动更新、默认插件、模型拉取、项目配置、外部 skills 与 LSP 下载；只继承必要系统变量。新生成的 Basic 密码未记录或持久化。

本地证据位于 `artifacts/legacy-1.2.27/run-SIvnhx/identity.json` 和 `fixtures.json`。27 项检查覆盖健康鉴权、路径／项目／目录读取、会话创建／读取／更新／历史、不调用模型的 noReply 用户消息存储、echo shell 完成、无效提示输入、缺失会话、初始 SSE、目录及全局清理。创建／更新成功但丢弃传入 metadata。清理 A 后 B 仍能读取，这不能证明 B 的既有流或活动审批未受影响。

关闭 INT-00L 前仍需受控模型完成、真实待审批权限／问题答复、非空 diff，以及双目录活动清理／恢复证据。去重和结果查询保证必须另行证实。空决策列表与初始 SSE 不代表这些操作通过验收。专用 Legacy profile 在后续实现验收前保持禁用。


## 探测修正范围

Web 使用共享探测器；Electron 复用进程内 Web 后端；VS Code 扩展宿主导入同一探测器；托管移动端与 Capacitor 使用所选宿主描述。每种宿主在鉴权后的稳定 1.2.27 健康响应后停止探测。本修正不改变 UI、桥接载荷或持久化 profile；其他版本保留健康／信息响应比较，改为顺序执行。健康探测较慢时，信息探测会额外等待既有五秒超时。本修正不启用专用 Legacy profile。

兼容探测／内核回归测试 38 项通过，包含三种稳定版本写法及预发布矛盾响应。Web 与 VS Code 类型检查通过，修改文件的 oxlint 无诊断。本修正未重新进行打包宿主运行验证。已发布 CAgent 预览仍固定为原发布源码。
