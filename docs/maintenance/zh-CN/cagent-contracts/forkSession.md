# forkSession

夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。

## 目标

派生会话，可指定截断消息。

## 输入字段

必需: workspaceID, sessionID, requestID

可选: messageID

[生成的 JSON schema 与样例](../../cagent-contracts/schemas/forkSession.json)

JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。

## 必需语义

- 记录指定消息是否保留，以及省略 messageID 时的默认截断位置。启用前须由维护者批准此行为满足消费功能。
- 返回记录标识所选工作区中新建的子会话；源会话保持完整。

分发前持久化原请求 ID。已经进入的失败属于结果未知。接收不证明完成；查询原请求结果，不重发。

## 有效输入样例

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "messageID": "fixture-message",
  "requestID": "fixture-request"
}
```

## 有效结果样例

```json
{
  "id": "fixture-child",
  "workspaceID": "fixture-workspace",
  "title": "Fixture session",
  "parentID": "fixture-session"
}
```

## 拒绝的结果样例

```json
{
  "id": "fixture-child"
}
```

## 相关操作功能 ID

fork

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
