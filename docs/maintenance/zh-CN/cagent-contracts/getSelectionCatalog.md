# getSelectionCatalog

夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。

## 目标

读取明确提供的模型与 agent 目录。

## 输入字段

必需: workspaceID

可选: 无

[生成的 JSON schema 与样例](../../cagent-contracts/schemas/getSelectionCatalog.json)

JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。

## 必需语义

- 模型和 agent 分属两个列表。
- 空列表表示目录没有报告条目，不会据此推断默认模型。

读取失败必须保持为失败，不能替换成空的成功数据。

## 有效输入样例

```json
{
  "workspaceID": "fixture-workspace"
}
```

## 有效结果样例

```json
{
  "models": [
    {
      "id": "fixture-model",
      "label": "Fixture model"
    }
  ],
  "agents": []
}
```

## 拒绝的结果样例

```json
{
  "models": [
    {
      "id": "fixture-model"
    }
  ],
  "agents": []
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
