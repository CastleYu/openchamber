# createSession

夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。

## 目标

在指定工作区创建会话。

## 输入字段

必需: workspaceID, requestID

可选: title

[生成的 JSON schema 与样例](../../cagent-contracts/schemas/createSession.json)

JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。

## 必需语义

- requestID 标识这次写入尝试。
- 返回会话表示创建记录，不代表后续提示词已经完成。

分发前持久化原请求 ID。已经进入的失败属于结果未知。接收不证明完成；查询原请求结果，不重发。

## 有效输入样例

```json
{
  "workspaceID": "fixture-workspace",
  "requestID": "fixture-request"
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

acquireSession

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
