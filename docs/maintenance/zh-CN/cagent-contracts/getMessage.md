# getMessage

夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。

## 目标

读取会话中的一条消息。

## 输入字段

必需: workspaceID, sessionID, messageID

可选: 无

[生成的 JSON schema 与样例](../../cagent-contracts/schemas/getMessage.json)

JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。

## 必需语义

- 三个标识共同限定查找范围。
- 可选消息元数据可以缺失。

读取失败必须保持为失败，不能替换成空的成功数据。

## 有效输入样例

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "messageID": "fixture-message"
}
```

## 有效结果样例

```json
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
```

## 拒绝的结果样例

```json
{
  "id": "fixture-message",
  "sessionID": "fixture-session",
  "role": "assistant",
  "parts": [],
  "state": "done"
}
```

## 相关操作功能 ID

message

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
