# CAgent 契约参考生成器

本文件是[英文交接文档](../../../scripts/cagent/DOCUMENTATION.md)的中文审查副本，最终交接前同步维护。

此维护者工具为每个中立操作生成一份英文页和一份中文页、一份机器可读 schema／样例文件，另生成两个索引及参考清单。它导入当前操作常量、输入／输出解析器和功能依赖规则。`operation-reference.mjs` 负责已审查的双语语义及合成样例，不含真实 CAgent API 映射。

使用工作树已安装的依赖和 Node.js 22 或更新版本。以下命令不需要网络或服务器。这是可执行的参考生成步骤，并非独立离线工具包安装器。

```sh
node scripts/cagent/build-contracts.mjs --write --json
node scripts/cagent/build-contracts.mjs --check --json
node --test scripts/cagent/contract-pages.test.mjs
```

默认命令检查现有参考。`--write` 重新生成仓库内 `docs/maintenance/cagent-contracts` 及 `docs/maintenance/zh-CN/cagent-contracts` 下的固定文件，不删除额外文件。过时参考须通过已审查的源修改移除；存在额外条目时，生成和检查命令均失败。`--check` 与 `--write` 互斥。未知参数和位置参数在写入前失败。

全部模式均不交互。默认及 `--quiet` 输出一行简要结果。`--json` 只输出一个 JSON 结果，失败也遵循此规则。文件缺失、变化或出现额外条目时，以 `reference-stale` 返回非零；其他设置／生成失败以 `reference-generation-failed` 返回非零。报告仅包含数量、参考摘要及固定错误码，不含 API 文档、凭据或原始异常文字。写入失败可能留下部分重新生成的文件；交付前重新生成并要求检查通过。

生成页列出必需／可选的顶层输入字段、操作语义、有效输入／结果、被拒绝的结果和相关功能 ID。JSON 文件保留完整结构 schema。权限选项和消息 part ID 唯一性等运行时细化检查无法完全由生成的 schema 表达。受保护验收仍须使用运行时解析器，并验证作用域、请求构造及文档语义。夹具有效不能证明真实 CAgent 支持。

清单对其他 68 份生成文件的准确 UTF-8 内容计算哈希，再对有序文件／哈希列表计算汇总摘要。它只是参考指纹，并非适配器制品清单、应用修订、独立证据、批准记录或启用许可。完整 CA-02 工具包须同时固定应用、工具链、任务定义、受保护夹具及参考摘要。

架构负责人重新生成并审查这些文件。环境内弱 Agent 只接收指定操作页、该操作的 schema、已审查 API 摘录及允许修改的候选任务包。参考文件不在候选写权限内。Schema 有效和参考未漂移不能替代任务包生成、映射导入、模型校准、扩展模板、可执行工具包安装或隔离真实检查；这些仍属 CA-02 待完成工作。

Web、Electron、托管移动端和 Capacitor 在宿主验收后可使用相同中立契约。本生成器不改变运行时行为或功能可用性。VS Code 保持不支持的 Agent 命名空间。参考生成不修改 OpenCode／Legacy 代码路径或发布制品。
