# getSession

夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。

## 目标

读取所选后端拥有的一个会话。

## 输入字段

必需: workspaceID, sessionID

可选: 无

[生成的 JSON schema 与样例](../../cagent-contracts/schemas/getSession.json)

JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。

## 必需语义

- workspaceID 与 sessionID 必须指向同一后端会话。
- 可选的 title、parentID 和 metadata 缺失时保持缺失。

读取失败必须保持为失败，不能替换成空的成功数据。

## 有效输入样例

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session"
}
```

## 有效结果样例

```json
{
  "id": "fixture-session",
  "workspaceID": "fixture-workspace",
  "title": "Fixture session"
}
```

## 拒绝的结果样例

```json
{
  "id": "fixture-session"
}
```

## 相关操作功能 ID

acquireSession, history, message, children, prompt, command, stop, selection, synthetic, fork, remove, update

## 拒绝样例

这些是宿主拒绝，并非 CAgent 线协议错误。线协议错误映射须来自本地 API 文档。

```json
{
  "error": "unverified"
}
```

```json
{
  "error": "unsupported"
}
```

```json
{
  "error": "backend-failed"
}
```
