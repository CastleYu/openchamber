# importSession

夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。

## 目标

将会话及其消息记录导入指定工作区。

## 输入字段

必需: workspaceID, session, messages, requestID

可选: 无

[生成的 JSON schema 与样例](../../cagent-contracts/schemas/importSession.json)

JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。

## 必需语义

- session.workspaceID 必须等于输入的 workspaceID；每条 message.sessionID 必须等于 session.id。
- 此操作导入调用方提供的记录，不表示这些记录由后端生成。

分发前持久化原请求 ID。已经进入的失败属于结果未知。接收不证明完成；查询原请求结果，不重发。

## 有效输入样例

```json
{
  "workspaceID": "fixture-workspace",
  "session": {
    "id": "fixture-session",
    "workspaceID": "fixture-workspace",
    "title": "Fixture session"
  },
  "messages": [
    {
      "id": "fixture-message",
      "sessionID": "fixture-session",
      "role": "assistant",
      "parts": [
        {
          "id": "fixture-part",
          "type": "text",
          "text": "Fixture response"
        }
      ],
      "state": "complete",
      "finish": "stop"
    }
  ],
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

import

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
