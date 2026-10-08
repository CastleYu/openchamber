# OpenCode 集成源码核查

> 中文审阅与归档副本。英文交接源：[英文原文](../OPENCODE-INTEGRATION-AUDIT.md)。同步与交接规则见 [README](README.md)。

2026-10-08 在 `dijiang-next` 工作树的 `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6` 上核查。本次是对引入上游后的当前个人代码树进行静态审查，没有运行应用、测试或 OpenCode 1.2.27 服务器。

结论按完整需求的当前覆盖程度分类，不将每项已有行为归因于某个官方上游提交。尤其是双内核架构属于个人集成工作；部分分支和快捷键基础已出现在九月的 DEV-PLAN 中。无论来源如何，都复用已有行为。

## 结果

后续紧急追加的 [CAgent 需求](CAGENT-INTEGRATION-SPEC.md)是本次源码核查之外的计划工作。未检查任何 CAgent API 或功能支持。CA-00 盘点共享消费者，CA-03 提供环境内的能力核查结论。

| 需求 | 当前覆盖 | 剩余契约 |
| --- | --- | --- |
| 3.1 解耦智能体服务器集成 | 部分。已有 UI 门面、OC1/OC2 会话适配器、服务器操作及 generation/epoch 绑定。 | 所有已使用操作完成兼容配置分派，移除或记录直接绕过边界的调用，加入 Legacy 和明确的兼容服务器边界。 |
| 3.2 显式连接模式 | 核心目标缺失。已有二进制路径设置和代际探测。 | 五种独立选择的模式、持久化模式／来源、迁移，以及不替换端点／二进制的失败行为。 |
| 3.3 服务器模式重载时 dispose | 缺失。外部重载重新检查健康状态并要求手动重启。 | 按兼容配置释放实例，定义作用范围、就绪和待应用状态语义。 |
| 3.4 原生菜单中文 | 缺失。原生菜单／托盘标签仍为英文；网页内容上下文菜单未配置翻译标签。 | 语言传播、菜单重建和真实宿主验收。 |
| 3.5 始终显示当前分支 | 部分。桌面已有分支元信息行。 | 工作状态显示时仍可见，移动端持续显示分支，并如实呈现失败／非 Git 状态。 |
| 3.6 新会话显式刷新分支 | 有部分基础。已有 Git 状态和 30 秒分支缓存刷新。 | 用户触发并绕过 TTL 的刷新、限定范围的状态／分支协调和可见结果。 |
| 3.7 快捷键悬停提示 | 部分。已有共享查询／格式化工具，部分控件手动拼接快捷键。 | 共享提示行为、生效绑定更新和完整的已注册操作覆盖。 |
| Legacy 1.2.27 | 缺少专用兼容配置。探测将 OC1 主版本作为一个代际接受。 | 精确兼容配置选择、逐操作兼容和真实 1.2.27 验收。 |

本次核查没有将任何原始 3.X 需求标记为完全完成。

## 源码证据

以下行号对应固定基线。后续提交导致行号变化时，应查看所列符号／模块。

| 发现 | 源码及观察到的行为 |
| --- | --- |
| 现有 UI 适配器 | `packages/ui/src/lib/opencode/client.ts:293` 定义服务；`v1/sessions.ts:27` 和 `v2/sessions.ts:46` 提供独立的会话适配器。服务中仍有按代际区分的操作。 |
| 现有服务器边界 | `packages/web/server/lib/opencode/kernel-runtime.js`、`kernel-operations.js` 和 `kernel-operations.d.ts` 绑定 generation/endpoint/epoch，并为自主调用者提供操作。声明仍包含 SDK 专属的原始／结果类型，尚非完整的协议中立边界。 |
| 缺少精确 Legacy 描述符 | `packages/web/server/lib/opencode/compatibility.js:1` 定义 OC1/OC2 及失败代际；`isSupportedOpenCodeVersion` 接受主版本 1，`detectOpenCodeGeneration` 解析 health/info。`packages/ui/src/lib/opencode/runtime.ts:10` 只有 generation/endpoint/epoch/version，没有兼容配置。 |
| 设置缺口 | `packages/ui/src/components/sections/openchamber/OpenCodeCliSettings.tsx:22` 编辑 `opencodeBinary`，第 38/78 行读取／写入。它不是五种模式的连接选择器。 |
| 解析和启动缺口 | `packages/web/server/lib/opencode/DOCUMENTATION.md:349` 记录设置、环境、捆绑、PATH 和发现的解析顺序。`env-config.js:40` 警告并忽略无效主机。`lifecycle.js:1192` 通过环境／探测选择外部或托管启动。 |
| 重载缺口 | `packages/web/server/lib/opencode/lifecycle.js:926` 重新探测外部实例。`core-routes.js:1048` 返回手动重启提示。检查的集成路径中没有 instance/global dispose 实现。 |
| 原生语言缺口 | `packages/electron/main.mjs:4685` 和 `:4795` 构建英文应用菜单；`:4912` 配置 `electron-context-menu`，没有翻译标签。`packages/electron/tray.mjs:188` 和 `:288` 包含英文托盘标签。 |
| 分支可见性缺口 | `packages/ui/src/components/layout/Header.tsx:733` 推导标签；`:741` 在聊天上下文或工作状态面板可见时隐藏元信息；`:1528` 渲染该条件行。`packages/ui/src/apps/MobileHeader.tsx:49` 明确省略项目／分支元信息。 |
| 刷新基础 | `packages/ui/src/components/chat/composer/state/useDraftTarget.ts:105` 获取初始 Git 状态，`:113` 刷新过期分支数据。`composer/ui/DraftTargetSelectors.tsx:409` 和 `:457` 提供目标选择，没有显式刷新操作。 |
| 提示基础 | `packages/ui/src/components/layout/TitlebarLeftControls.tsx:31` 格式化侧边栏快捷键；`:144` 仅显示新会话标签。`composer/ui/FocusModeButton.tsx:25` 独立格式化提示。`session/sidebar/shell/SidebarFooter.tsx:42` 使用仅含标签的提示。 |

九月的描述只假定 OC1 SDK 边界。当前[双内核架构](DUAL-KERNEL-ARCHITECTURE.md)和[接口清单](../DUAL-KERNEL-INTERFACES.md)已建立更广泛的基础。从头重建会造成职责重复。新的[集成 SPEC](OPENCODE-INTEGRATION-SPEC.md)基于这些基础描述剩余行为。

## 证据边界与遗留验证

当前包清单标识上游版本 2.0.4 和 DIJIANG 4.0。[上游引入证据](../evidence/2026-10-01-upstream-intake.md)记录了后续上游内容和中途的广泛检查，包括失败的 UI 测试，以及修复后尚未完整重跑的 Web 检查。这些历史节点既不能证明当前仍然失败，也不能作为本次里程碑的最终验收。INT-00 重新建立相关基线。

[双内核采用台账](../DUAL-KERNEL-ADOPTION.md)记录新版 OC1/OC2 测试和尚未完成的真实运行用例，不能证明精确 1.2.27 的语义。因此 Legacy SPEC 区分已验证的当前代码结构与旧版本契约问题，并在兼容性验收前要求精确版本证据。
