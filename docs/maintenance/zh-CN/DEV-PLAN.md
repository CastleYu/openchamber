# DIJIANG 开发计划：未来主要版本

> 中文审阅与归档副本。英文交接源：[英文原文](../DEV-PLAN.md)。同步与交接规则见 [README](README.md)。

相关中文文档：[DEV-PLAN](DEV-PLAN.md)、[PLAN](PLAN.md)、[双内核架构](DUAL-KERNEL-ARCHITECTURE.md)、[OpenCode 集成规范](OPENCODE-INTEGRATION-SPEC.md)、[Legacy 1.2.27 规范](OPENCODE-LEGACY-1.2.27-SPEC.md)、[OpenCode 集成里程碑](OPENCODE-INTEGRATION-MILESTONES.md)、[OpenCode 集成审计](OPENCODE-INTEGRATION-AUDIT.md)。

记录于 2026-09-16，源自维护者的请求。本文保留需求意图和历史代码背景。[PLAN.md](PLAN.md)仍是通用执行队列；其中 RUN-01/RUN-02 现将 OpenCode 集成状态与验收交由[集成里程碑](OPENCODE-INTEGRATION-MILESTONES.md)管理。HOST-01 至 HOST-04 仍对应第 4 节。

维护者 2026-09-16 的原始请求逐字保存在[DEV-PLAN.original.md](../DEV-PLAN.original.md)。若第 1 至第 5 节与该来源不同，以原文为准。后来明确追加的要求按本计划记录的日期执行。

每个主要版本对应一个 DIJIANG 功能增量。版本规则见[BUILD.md](../BUILD.md)。

## 1. MCP 优化（主要版本）

维护者仍需确定确切范围。工作可建立在当前状态上：

- MCP 重连模块将固定版本的 BGPM 包（`@waylaidwanderer/background-process-mcp` 1.2.8）复制到带版本号的运行时目录，并以直接调用 `node` 替代 `npx`（`packages/web/server/lib/mcp-reconnect/launch.js:9-75`）。
- 一个持续运行的 OpenCode 插件会重连被 OpenCode 标记为 `failed` 的服务器，退避间隔从 1s 增至 30s（`mcp-reconnect/runtime.js:52-246`）。它会在发送断开请求前记录空闲回收状态，因此即使响应丢失也能恢复（`idle-reclaim.js:22-86`）。
- 当所有会话都空闲且 BGPM 任务数为零时，空闲回收会在五分钟后运行。客户端通过租约向 `POST /api/system/project-resources` 发送资源模式（`resource-modes.js:7-55`）。
- 在 Windows 上，stdio 连接运行于关闭时会终止它们的 Job Object 中（`mcp-reconnect/windows-job.cs`）。设置更改会延后应用，参见 `config-entity-routes.js:149-231` 和 `mcp.js:43-166`。界面位于 `McpSidebar.tsx` 和 `McpPage.tsx`；JSON 导入位于 `mcpImport.ts` 和 `McpPage.tsx:630-724`。
- DIJIANG 1.2 和 2.1 降低了进程数，增加了空闲回收与恢复，限制了日志大小，并保护活动会话。记录见[PLAN.md](PLAN.md)和[evidence/MCP-1.2.md](../evidence/MCP-1.2.md)。

需要确定范围的问题：要优化哪些成本（进程数、内存、启动延迟或重连风暴）；是否让更多 MCP 服务器共享生命周期管理；以及用哪些验收指标证明结果。

## 2. 交互改进（主要版本）

[交互设计](../INTERACTION-DESIGN.md)进一步说明以下四项，包含拟议行为、运行时差异、待定产品决策和验收标准。设计或实现这个里程碑时应阅读该文档。原始请求仍是意图来源，PLAN.md 仍是执行状态来源。

### 2.1 侧边栏字母大小写

当前行为与请求冲突：`packages/ui/src/components/session/sidebar/projects/sortableItems.tsx:102` 的 `lowercase` 类会通过 CSS 将项目标签强制转成小写。固定标题和 Recent 列表也复用该样式（`SessionProjectScroller.tsx:415-428` 和 `SidebarActivitySections.tsx:267`）。会话标题保留用户输入的大小写（`SessionNodeItem.tsx:1424`；重命名逻辑在 `useSessionActions.ts:127-136`）。共享 `Button` 基础类也会应用 `lowercase`（`components/ui/button.tsx:49`）。项目名和会话名目前不会被转成大写。

任务：定义预期的字母大小写规则。文档记录的意图是按磁盘上的原样显示文件夹名，见 `sidebar/utils.tsx:159-160`。对项目标题、固定标题、Recent、worktree 分组和会话标题一致应用该规则，不要改变无关的 Button 样式。

### 2.2 DIJIANG 发布仓库的更新通知

当前行为：个人构建将 `updatePolicy` 设为 `"notify-only"`（`packages/web/personal-build.json`）。桌面端会获取 `openchamber/openchamber/releases/latest`，并将标签与上游版本比较（`packages/electron/personal-updates.mjs:10-26`、`personal-build.js:11-12` 和 `main.mjs:4467-4475`）。Web、移动端和 VS Code 会查询官方更新 API，失败时回退到 npm（`package-manager.js:23-187,675-704`）；它们从社区的 `changelog/index.json` 读取发布说明。

个人构建发布到此 fork 的 Releases，版本格式为 `v<upstream>-DIJIANG.<feature.fix>`；见 [BUILD.md](../BUILD.md) 的“Operations”部分。任务：从 fork 的 Releases 或发布清单验证新的 DIJIANG 发布元数据，然后比较 DIJIANG 版本，使已安装的个人构建在有新版时通知用户。保留仅通知策略和 403 安装防护（`openchamber-routes.js:39-103`）。

### 2.3 工作状态：聊天中的呼吸效果

当前聊天的工作状态行使用 `BusyDots` 和不透明度呼吸动画（`animate-busy-pulse`，1.2s ease-in-out infinite）；启用减少动态效果时会禁用该动画。见 `packages/ui/src/components/chat/message/parts/BusyDots.tsx:8-23` 和 `packages/ui/src/index.css:1749-1760`。会话列表项显示静态圆点和精确到一秒的时长（`SessionNodeItem.tsx:730-746`、`SessionActivityDuration.tsx:11-33`）。目前有两个已定义但未使用的关键帧动画：`navrail-dot-wave` 和 `border-glow-pulse`（`index.css:1762-1817`）。

任务：为对话界面本身添加呼吸效果，例如围绕聊天容器或输入框的发光或边框脉冲。明确范围，只在 `sessionStatus` 为 busy/retry 时显示。合适时复用未使用的 `border-glow-pulse`。保留减少动态效果时的退出选项。

### 2.4 改进添加项目的流程

维护者仍需确定确切范围。当前流程：`DirectoryExplorerDialog` 支持手动输入路径并自动补全、浏览目录、多选、克隆仓库和创建目录。提交时使用 `useProjectsStore.addProject`（`packages/ui/src/stores/useProjectsStore.ts:596-656`）及服务器路由 `GET /api/fs/home`、`GET /api/fs/list`、`POST /api/fs/mkdir` 和 `POST /api/fs/clone`（`packages/web/server/lib/fs/routes.js:710,723,761,1585`）。入口包括侧边栏标题、移动端抽屉、项目设置页和命令面板。

## 3. OpenCode 集成里程碑

根据当前 OC1/OC2 架构于 2026-10-08 修订。此里程碑完成要求 3.1-3.7，并增加专用 Legacy OpenCode 1.2.27 配置，支持自动检测或手动选择以及全操作范围的兼容性。

同日紧急追加：CAgent 是独立后端，其 API 仅在目标环境内部可获取。在其余集成工作之前交付共享架构、离线适配工具包及环境内部验收。本地 Agent 在受限适配器工作区中工作；基于证据的能力门槛禁用不可用功能，并通过类型化扩展呈现 CAgent 专有功能。

详细要求和执行门槛现记录于：

- [CAgent 架构](CAGENT-INTEGRATION-SPEC.md)及[本地适配工作手册](CAGENT-ADAPTER-WORKBOOK.md)：紧急 CA-00 至 CA-03、契约边界及本地验收。
- [CAgent 消费契约](CAGENT-CONSUMER-CONTRACT.md)：功能启用前的聊天／同步迁移、缺字段行为及受保护的适配预期。
- [集成规范](OPENCODE-INTEGRATION-SPEC.md)：适配器边界、五种明确的连接模式、释放和界面行为。
- [Legacy 1.2.27 规范](OPENCODE-LEGACY-1.2.27-SPEC.md)：配置选择、API/事件/配置兼容性和精确版本验收。
- [子版本里程碑](OPENCODE-INTEGRATION-MILESTONES.md)：通用基线、CAgent 优先门槛、Legacy 取证及拟议的 DIJIANG 5.0-5.13 交付门槛；它是本里程碑的权威执行状态。
- [当前源码审计](OPENCODE-INTEGRATION-AUDIT.md)：覆盖情况及每项原 3.X 要求的剩余工作。

[原始请求](../DEV-PLAN.original.md)仍是未修改的历史记录。现有 OC1/OC2 支持是实现基础，但不能证明与精确的 1.2.27 兼容。RUN-01/RUN-02 已转入新里程碑队列。

## 4. 解耦第三方托管平台（主要版本）

目标：解耦所有第三方托管平台集成，使将来能够换成其他平台，同时在服务器和共享 UI 两侧保留 facade 层。[ADAPTERS.md](../ADAPTERS.md)记录了设计：平台适配器负责端点、认证、分页和载荷转换；应用操作使用平台无关的仓库、变更请求和审查记录；GitHub 专属字段留在 GitHub 适配器中。当前耦合点包括 `packages/web/server/lib/github/` 下的 GitHub 服务器代码、`packages/web/src/api/github.ts` 中的 Web 适配器、`packages/ui/src/lib/api/types.ts` 中的共享类型、`useGitHubPrStatusStore.ts` 中的状态，以及单独的 VS Code bridge 组合。Local Git、发布元数据、skills 目录和 providers 是有意保持独立的身份。

PLAN.md 列出分阶段任务：HOST-01 盘点与契约、HOST-02 仓库/PR 读取、HOST-03 修改和认证、HOST-04 第二个托管平台。本节记录维护者希望将整套计划作为一个主要版本交付；HOST 任务仍是具体执行内容。

## 5. 内置工具（主要版本）

范围方向：改进并扩展内置开发工具，支持非原生 OpenCode 实现提供的 opencode-like 命令。当前最明确的例子是自动发现开发服务器。服务器扫描监听端口（Windows 使用 `netstat -ano`；其他系统先尝试 `lsof`，再尝试 `/proc/net/tcp`），并提供 `GET /api/dev-servers`（`packages/web/server/lib/dev-servers/routes.js:71-135`）。浏览器面板合并已公告和检测到的服务器（`lib/browser/announcedServers.ts:3-17`、`lib/browser/devServers.ts:31-42`），项目操作按钮提供“Auto-discover”（`ProjectActionsButton.tsx:389-400,466-511,551-570`）。

相关发现工具包括嵌套 Git 仓库（`fs/routes.js:307-378`、`GET /api/fs/git-dirs`）、Git 凭据（`git/credentials.js:7`、`git/routes.js:98`）、项目图标（`project-icon-routes.js:319-396`）、skills 与目录扫描（`skills.js:156-199`、`skills-catalog/`）、循环文件（`scheduled-tasks/loops.js:167-186`）以及运行实例检测（`packages/web/bin/lib/cli-lifecycle.js:163-219`）。

类似 OpenCode 的命令支持采用[集成规范](OPENCODE-INTEGRATION-SPEC.md)中定义的连接模型。工具注入和升级必须遵循进程所有权及已解析的兼容性配置。维护者仍需提供更广泛内置工具范围的清单。

## 6. 在设置中配置无项目聊天目录（发布版本待定）

新增于 2026-09-25。服务器仅在启动时读取 `OPENCHAMBER_CHATS_DIR`。若未设置，则使用 OpenChamber 用户配置目录下的 `chats`（`packages/web/server/index.js:292-302`）。当 OpenCode 以另一个用户运行时，此环境变量可让部署将无项目聊天放在双方都能访问的位置，但应用目前没有对应设置。

目标是在设置中配置**服务器端**无项目聊天目录，并将其保存在服务器上，使连接到同一服务器的客户端使用同一个有效目录。保留环境变量作为旧部署的可选配置方式，但降低其优先级。优先顺序为：用户保存的值、`OPENCHAMBER_CHATS_DIR`、当前默认目录。只有在用户清除已保存的设置后，才再次使用环境变量或默认目录。如果用户明确选择了无效或不可访问的目录，应显示错误，而不是静默回退到环境变量。

设置应显示有效路径及其来源，并说明该路径属于服务器文件系统，避免用户误以为它是客户端本地路径。明确已保存更改何时生效。如果服务器必须重启，应告知用户并在重启后验证。目录更改只影响之后创建的无项目聊天，不会自动移动或删除已有聊天目录。现有会话继续从原路径加载，清理逻辑只处理所有权已确认的聊天目录。项目和 worktree 聊天的存储规则保持不变。

验收覆盖四种情况：已保存设置、仅配置环境变量、两者均未设置、设置值明确无效。检查服务器重启后的持久性及多客户端一致性。在 OpenCode 与 OpenChamber 以不同用户运行的部署中，创建并打开无项目聊天，验证双方都能访问目标目录。还要确认旧聊天仍能打开，切换目录不会误删数据。实现开始时将此事项加入[PLAN.md](PLAN.md)，并在那时决定发布版本归属和迁移计划。
