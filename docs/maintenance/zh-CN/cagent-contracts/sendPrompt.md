# sendPrompt

夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。

## 目标

向会话提交提示词文本。

## 输入字段

必需: workspaceID, sessionID, requestID, text

可选: model, agent

[生成的 JSON schema 与样例](../../cagent-contracts/schemas/sendPrompt.json)

JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。

## 必需语义

- model 和 agent 是可选的显式选择覆盖值。
- accepted 表示已受理处理，不表示生成完成；unknown 保留结果不确定这一事实。

分发前持久化原请求 ID。已经进入的失败属于结果未知。接收不证明完成；查询原请求结果，不重发。

## 有效输入样例

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "requestID": "fixture-request",
  "text": "Fixture prompt",
  "model": "fixture-model"
}
```

## 有效结果样例

```json
{
  "state": "accepted",
  "requestID": "fixture-request"
}
```

## 拒绝的结果样例

```json
{
  "state": "accepted"
}
```

## 相关操作功能 ID

prompt

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
