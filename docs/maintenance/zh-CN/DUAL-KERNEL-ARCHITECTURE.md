# 双 OpenCode 集成设计

> 中文审阅与归档副本。英文交接源：[英文原文](../DUAL-KERNEL-ARCHITECTURE.md)。同步与交接规则见 [README](README.md)。

相关中文文档：[DEV-PLAN](DEV-PLAN.md)、[PLAN](PLAN.md)、[双内核架构](DUAL-KERNEL-ARCHITECTURE.md)、[OpenCode 集成规范](OPENCODE-INTEGRATION-SPEC.md)、[Legacy 1.2.27 规范](OPENCODE-LEGACY-1.2.27-SPEC.md)、[OpenCode 集成里程碑](OPENCODE-INTEGRATION-MILESTONES.md)、[OpenCode 集成审计](OPENCODE-INTEGRATION-AUDIT.md)。

状态：设计已接受，已在 OC1 核心上实现。采用情况台账记录契约与运行时证据；发布另设门槛。

2026-10-08 紧急追加：本文保留为历史 OC1/OC2 基线。[CAgent SPEC](CAGENT-INTEGRATION-SPEC.md)在其余集成工作前加入独立后端类型及宿主管理的适配工具包。其能力和扩展契约取代新里程碑仅限两种协议的范围约束，不代表 CAgent 已实现。

## 决策

从个人 OC1 提交 `4ac81115c17c203c89c5b52f93a930af32ea2163` 开始。在集成上游 OpenChamber `v2.0.1`（提交 `63bd5070c8620432817e1e67de77791f801bcf3e`）的产品更改时，保留 OC1 的完整行为。OpenChamber 标签不是 OpenCode 二进制版本。最终产品只有一个应用、两种协议实现，并针对每种协议明确规定功能行为。

最初采用 OC1 形态的契约只是集成步骤，不能以旧 UI 仅能连接 OC2 作为停止条件。完成意味着涵盖上游功能清单：修改过的既有功能保留 OC1 行为，真正新增的 OC2 功能在 OC1 上禁用。队列、计划任务、assist、goals、questions、fork、compaction、statistics、memory、MCP、skills 和 DIJIANG 都属于基线功能。

沿用现有模块边界。仅在请求、事件、持久化所有权或行为不同时增加协议实现。共享展示、调度、OpenChamber 自有记录的持久化和原生传输都只保留一份。不要引入另一套服务，也不要复制任一仓库。

当前 skills 描述的是仅支持 OC2 的产品。明确提出的双内核需求取代该假设；实现边界时必须更新规范指引。保留其中的传输、解析、所有权和运行时切换规则。

## 约束设计的源码发现

* OC1 的 `lib/opencode/client.ts` 直接返回 SDK1 类型，并公开 `getSdkClient()` 和 `getScopedSdkClient()`。Bootstrap、sync、全局会话、multirun、provider 设置、OAuth 和所有应用根组件都使用这些接口。仅替换此文件无法实现双 API。
* 上游 `model.ts` 保留了消息/part 存储布局，但将 provider、model、config、permissions、status 等记录别名到 OC2 wire 类型。整体导入它并不能得到协议中立的契约。
* 上游 `projection.ts` 和 `events.ts` 已负责 OC2 消息投影及确定性的 part 标识。采用时保留其命名和算法，并让 HTTP 历史与流式事件共用该投影。
* 服务器队列、assist 和 goal 运行时会独立于浏览器发出 OpenCode 请求。即使 UI 未打开，两种版本也都必须可用。
* OC1 配置使用延迟应用/重启和文件凭据；上游则使用变更后的实体 schema、受监视的插件目录和凭据数据库所有权。这些是行为差异，不只是路由前缀不同。
* 对提供的提交之间 UI、web、VS Code 和 Electron 的 `git diff --shortstat` 显示 1,243 个变更文件、70,871 行新增、49,586 行删除。这包含产品演进和个人更改，既不是实现工作量估算，也不能证明所有这些文件都需要兼容适配器。

## 具体边界

### UI OpenCode 操作

保留 `lib/opencode/client.ts` 作为现有调用方使用的服务。将实际 OC1 协议操作移到 `lib/opencode/v1/`，并使用上游请求与投影代码引入 `lib/opencode/v2/`。运行时 fetch、错误传播、目录身份和端点生命周期只由一处负责。避免复制整套服务，包括文件系统和附件工具。

根据调用方清单定义小型、明确的操作契约。它需要涵盖会话和消息分页、提示、停止、fork/revert/compact、permission/question 或 form 操作、provider/config 目录操作及 bootstrap 数据。不要把任一生成 SDK 重新包装成通用 facade。在实际调用点将直接 SDK 访问替换为这些操作。`SDK1 | SDK2` 不得泄漏到 stores 或组件。

共享的 session/message/part 契约初期保留 OC1 调用方布局。在语义一致处采用上游名称和新字段。不要为了满足类型而虚构零成本、token 数、时间戳、ID 或 permission 含义。上游独有而缺失的信息应继续缺失，对应显示按 capability 决定。

目录/config 类型必须逐项根据清单另行决策。只有含义相同时才保留共享值。对确有差异的 permission 规则、forms/questions 和可编辑配置，使用明确标记为 OC1/OC2 的记录。版本专属编辑器或动作处理器留在所属功能中；周边布局和导航可以共享。适配器不得把高级 OC2 表单压扁成 OC1 问题而丢失行为。

### 事件与 sync 边界

子 store 调度、全局索引、乐观协调、运行时切换和消息加载保持共享。OC1 保留原有事件解码和恢复含义。OC2 采用上游事件解码/投影及恢复行为。两者都向现有 reducer/store 边界发布带类型的领域变更。上游已经采用兼容变更形态时直接复用。

不要把 OC2 原始 JSON 翻译成虚构的 SDK1 事件流。特别是 session 事件、消息内容替换、delta 寻址、permission 处理和 form 生命周期，都需要语义真实的类型化操作。HTTP 历史和事件必须构造相同的 part 标识。事件传输负责重连；协议实现负责定义该协议的恢复含义。

### 服务器操作

在 `packages/web/server/lib/opencode/` 中添加聚焦的协议操作，并在运行时组合时选择。现有 queue、计划任务、assist、goals、activity probes、通知和 memory 通过这些操作执行会话读取、消息尾部读取、提示分发、变更和状态查询。每项功能的决策逻辑和 OpenChamber 记录持久化继续留在当前模块。

保留公开的 `/api` OpenChamber 路由树。明确的 OpenChamber 路由仍优先于通用转发。代理选择实际的上游前缀并忠实转发，不要变成第二套完整协议转换引擎。浏览器协议适配器和服务器内部操作使用同一个已解析的运行时代次。版本检查放在这些入口边界，不要散布到各功能函数中。

在 OC2 对应实现旁保留 OC1 config/auth/plugin 实现。共享文件工具可以继续共用。OC1 保留原有保存/应用/重启行为；OC2 使用其受监视的配置语义。任何写入发生前都先选定插件生成器、认证所有者和生命周期路径。选择 OC1 时绝不能执行 OC2 自动迁移/补全。存储根目录和 session ID 不得暗示两种内核可以互换。

### 运行时身份与选择

在 bootstrap 之前，为每个活动端点/epoch 解析一个代次描述符。使用明确的代次和 capabilities，不依赖 UI 自行猜测。unsupported/unreachable/unknown 必须是不同结果；探测失败不得静默选择 OC1。最初交付忽略了 OC1 小版本分支，并使用维护者授权的可用 OC1 运行时；该次交付将精确运行 1.2.27 延后处理。

后续记录，2026-10-08：[集成规范](OPENCODE-INTEGRATION-SPEC.md)为此架构增加专用 OC1 兼容配置。[Legacy 1.2.27 规范](OPENCODE-LEGACY-1.2.27-SPEC.md)将精确版本运行列为新 Legacy 声明的门槛。此前的延期是历史证据，不构成新里程碑的豁免。

端点或代次发生变化时，沿用现有切换流程，使 clients、在途结果的权威性、stream、stores 和协议作用域缓存失效。每次调用时解析 URL 和凭据。描述符应限定在运行时身份范围内，不能使用可被另一个窗口覆盖的进程级可变模式。

| 运行时 | 预期行为 |
| --- | --- |
| Web | 服务器解析代次；UI 和自主服务器功能使用该结果。 |
| Electron | 复用进程内 web backend；原生 shell 传递所选二进制/运行时身份，不再实现一遍协议。 |
| VS Code | Extension host 解析代次；webview 操作、专用 message/SSE bridge、config 和凭据处理器使用该结果。 |
| Hosted mobile | 使用与 web 相同的远程服务器描述符和适配器。 |
| Capacitor | 在解析描述符前完成连接选择；重连和切换时清除先前描述符。 |

## 清单获批后的工作分配

负责人拥有操作名称、共享契约、组合方式、包依赖和集成工作。并行编辑前先锁定这些契约。

| 分组 | 独占实现范围 | 依赖项 |
| --- | --- | --- |
| 契约与组合 | 运行时描述符/capabilities；UI 操作/模型契约；服务器操作契约；manifests 和 lockfile | 已审查的 API 与功能清单 |
| UI 协议 | `lib/opencode/v1`、`v2`、facade 及 sync 之外的直接 SDK 调用方 | 已冻结的契约 |
| 事件与 sync | `sync` 协议入口、bootstrap/消息加载器、事件投影所有权 | 已冻结的契约与 UI 操作签名 |
| 自主服务器 | queue/scheduler/assist/goal/activity 集成及服务器协议操作实现 | 已冻结的契约 |
| 配置与平台 | config/auth/plugin 版本实现；VS Code/原生集成 | 描述符、服务器和 UI 契约 |
| 上游产品集成 | 上游功能组件/设置及 DIJIANG 协调，按互斥功能目录分组 | 清单分类与 capabilities |

部分调用方文件会与产品集成范围重叠。为每个此类文件指定唯一负责人，其他分组通过该负责人提出更改。不得让多个代理同时编辑 app roots、`client.ts`、`model.ts`、package manifests 或服务器组合代码。

合并顺序：恢复基线并建立台账；共享描述符/契约；保留行为地抽取 OC1；实现 OC2 操作和事件路径；服务器自主操作；config/auth/plugins/platform；完整上游功能集成及 OC1 策略门槛；DIJIANG 协调；最终集成证据。抽取 OC1 不代表交付完成。验证细节归负责人单独的验收计划管理。

## 让今后的上游更新易于管理

独立于 Git ancestry 跟踪内容采用情况。现有个人分支已包含 OC2 merge 历史；通过新的审查提交恢复 OC1 可以保留该历史，但这不表示 OC2 行为已启用。

按上游范围和功能/API 契约维护一份采用台账。每条记录注明上游源码路径或符号、当前本地负责人、OC1 策略、OC2 策略、采用的 commit/blob 和证据状态。允许的状态应区分原样采用、已适配、有意在 OC1 保留、有意不在 OC1 支持以及仍待处理。每一项清单都必须有负责人和最终状态。

每次更新先比较固定的上游内容与下一版上游内容，再通过台账映射变更路径和 API 符号。适配器变更需要两种协议都审查；共享 UI 变更需要字段与 capability 审查；服务器自主行为变更需要两种运行时的负责人审查。面向 API 的目录中新加内容不能因为较早的 merge commit 已是祖先而被悄然遗漏。

尽可能保留上游文件名和 exports。将原始 OC1 行为保留在职责清晰的版本模块中；避免给每个共享文件加前缀或重命名。不要进行格式化扫荡。在本地协议转换旁记录其上游源码身份，让审查者可以比较小范围源码。

通过变更的共享文件数、版本专属代码量、示例更新中的冲突文件数和未分类清单项衡量维护成本。实现前不要承诺较小的数字 diff。缩小边界可以减少重复推理，但采用全部 2.0.1 产品变更仍需要一次较大规模集成。

晋升到个人分支应通过明确审查的恢复/反转提交，再接双内核集成提交。保留既有历史。不要重置已发布历史，也不要声称已有 OC2 祖先提交就证明内容已采用。

## 供负责人审查的决策与风险

清单必须确定确切的规范操作签名，以及哪些上游新增功能需要本地版本专属展示。还必须确定每一处服务器端 OpenCode 调用的所有权，不能只看 UI client。完整的通用 SDK 抽象会增加工作量和 diff；不完整的 facade 则会让版本检查泄漏到每个调用方。

最大的语义风险是 message/part 身份、重连权威性、question/form 与 permission 差异、自主提示行为，以及 config/auth/plugin 写入。最大的维护风险是冻结整个旧产品，却称 OC2 连通性已完成。最大的数据显示风险是代次选择复用另一内核的持久化所有权或迁移生命周期。

本文是有源码依据的设计，不是运行时证明。不会仅凭 SDK 名称或保留旧源码就推断现有 OC1 小版本支持情况。

## 命令观察记录

2026-09-26：在上游对比 checkout 中读取 `packages/ui/README.md` 失败，因为该可选 package README 不存在。读取前应检查文件是否存在，或先发现可选文档。web package README 和模块文档均可读取。未运行代码命令或实现测试。
