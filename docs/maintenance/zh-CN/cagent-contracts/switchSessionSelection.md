# switchSessionSelection

夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。

## 目标

设置会话使用的模型或 agent。

## 输入字段

必需: workspaceID, sessionID, requestID

可选: model, agent

[生成的 JSON schema 与样例](../../cagent-contracts/schemas/switchSessionSelection.json)

JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。

## 必需语义

- model 与 agent 可分别省略。
- 返回值说明已选择的值，不证明后续生成实际使用了它们。

分发前持久化原请求 ID。已经进入的失败属于结果未知。接收不证明完成；查询原请求结果，不重发。

## 有效输入样例

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "model": "fixture-model",
  "requestID": "fixture-request"
}
```

## 有效结果样例

```json
{
  "model": "fixture-model"
}
```

## 拒绝的结果样例

```json
{
  "model": 4
}
```

## 相关操作功能 ID

selection

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
