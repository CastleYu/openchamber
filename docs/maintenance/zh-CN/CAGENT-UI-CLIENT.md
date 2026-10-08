# 共享 Agent 客户端

英文交接文档为[客户端模块文档](../../../packages/ui/src/lib/agent/DOCUMENTATION.md)。本中文副本随修改同步维护，最终交接时归档。

`client.ts` 解析 OpenChamber 自有 Agent 路由，返回按操作区分的契约。它不调用 CAgent Server API，也不替代 OpenCode 门面。宿主负责适配器加载、凭据、独立批准和分发。统一 schema 与操作类型位于 `packages/web/server/lib/agent`，浏览器导入不包含宿主 I/O。

消费方为自己的生命周期创建一个 `AgentClient`，结束时释放。生产入口通过 `runtimeFetch` 解析当前端点／认证，并订阅端点退役。`inspect()` 要求完整的运行时／功能快照和匹配身份。后续请求携带它返回的作用域。作用域包含本地端点修订，即使从 A 切到 B 再回 A，旧请求仍失效。宿主分发独立复核后端身份。

传输前解析输入，消费前解析输出。权威读取失败抛出固定 `AgentClientError`，不能变成空成功。分发只发送一次。已进入的写操作若响应丢失、无效或退役，返回 `unknown-outcome`；消费方须保留原请求 ID，使用 `readAttempt()`，不能自动重发。明确的 null 表示没有账本记录。历史记录允许较旧修订，但须匹配请求 ID、家族和连接。

Web、Electron、托管移动端和 Capacitor 使用各自既有 HTTP 运行时入口。VS Code 在宿主实现前，继续对自有路由返回 `unsupported-runtime`。UI／同步消费方尚未使用这个客户端；生产宿主功能支持仍未提供，本模块没有启用 CAgent 功能。

聚焦检查通过 Bun 运行 `client.test.ts` 和相邻运行时请求／切换测试。测试注入传输入口，不模拟模块，覆盖请求保真、完整快照、A/B/A 退役、释放及不确定写入。[执行检查点](CAGENT-EXECUTION.md)中的原生启动探针还通过该客户端访问真实 loopback 服务。两者使用合成适配器，不构成真实 CAgent 兼容性验收。
