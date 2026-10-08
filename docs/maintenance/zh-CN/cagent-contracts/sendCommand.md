# sendCommand

夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。

## 目标

提交指定命令及其参数字符串。

## 输入字段

必需: workspaceID, sessionID, requestID, commandID, arguments

可选: model, agent

[生成的 JSON schema 与样例](../../cagent-contracts/schemas/sendCommand.json)

JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。

## 必需语义

- commandID 选择命令，arguments 可以为空字符串。
- 已受理不等于命令执行完成。

分发前持久化原请求 ID。已经进入的失败属于结果未知。接收不证明完成；查询原请求结果，不重发。

## 有效输入样例

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "requestID": "fixture-request",
  "commandID": "fixture-command",
  "arguments": ""
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
  "state": "complete"
}
```

## 相关操作功能 ID

command

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
