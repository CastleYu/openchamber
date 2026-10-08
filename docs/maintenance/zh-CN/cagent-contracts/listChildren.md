# listChildren

夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。

## 目标

列出一个父会话的子会话。

## 输入字段

必需: workspaceID, sessionID

可选: cursor, limit

[生成的 JSON schema 与样例](../../cagent-contracts/schemas/listChildren.json)

JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。

## 必需语义

- sessionID 指定父会话；返回的子会话属于此工作区，不能是父会话本身。
- 分页只返回部分子会话时，不表示其余子会话不存在。

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
  "items": [
    {
      "id": "fixture-child",
      "workspaceID": "fixture-workspace",
      "title": "Fixture session",
      "parentID": "fixture-session"
    }
  ]
}
```

## 拒绝的结果样例

```json
{
  "items": [
    {
      "id": "fixture-session"
    }
  ]
}
```

## 相关操作功能 ID

children

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
