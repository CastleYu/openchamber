# DIJIANG 开发计划：后续大版本

记录于 2026-09-16，依据维护者提供的清单整理。本文记录需求意图和当时的代码背景；实施前应重新核对文中所述的当前行为。[PLAN.md](PLAN.md)仍是执行队列：本文中的条目开始执行时，应转为 PLAN.md 中包含负责人、依赖项和验收证据的任务。已有任务有重叠：RUN-01/RUN-02（第 3.2 节）、HOST-01 至 HOST-04（第 4 节）。

维护者 2026-09-16 的原始请求按原文保存在[DEV-PLAN.original.md](DEV-PLAN.original.md)中。第 1 至 5 节如与该原文不一致，以原文为准；后续明确追加的需求按本计划记录的日期执行。

每个大版本发布时对应一个 DIJIANG 功能增量。版本规则见[BUILD.md](BUILD.md)。

## 1. MCP 优化（大版本）

具体范围仍需维护者说明。可在以下现状基础上推进：

- MCP 重连模块会将固定版本的 BGPM 包（`@waylaidwanderer/background-process-mcp` 1.2.8）复制到带版本号的运行目录，并将 `npx` 调用改为直接调用 `node`（`packages/web/server/lib/mcp-reconnect/launch.js:9-75`）。
- 一个始终运行的 OpenCode 插件会以 1s 到 30s 的退避间隔重连被 OpenCode 标记为 `failed` 的服务器（`mcp-reconnect/runtime.js:52-246`）；空闲释放记录会在发送断开请求前写入，因此即使响应丢失也能恢复（`idle-reclaim.js:22-86`）。
- 当所有会话均空闲且 BGPM 任务数为零时，空闲释放会在 5 分钟后触发；资源模式由客户端租约通过 `POST /api/system/project-resources` 传入（`resource-modes.js:7-55`）。
- Windows stdio 连接在关闭时自动终止的 Job Object 中运行（`mcp-reconnect/windows-job.cs`）。设置的增删改采用延迟应用方式，相关代码在 `config-entity-routes.js:149-231` 和 `mcp.js:43-166`；界面位于 `McpSidebar.tsx` 和 `McpPage.tsx`，支持 JSON 导入（`mcpImport.ts`、`McpPage.tsx:630-724`）。
- DIJIANG 1.2 和 2.1 阶段已减少进程数，加入空闲释放与恢复、限制日志大小并保护运行中的会话。记录见[PLAN.md](PLAN.md)和[evidence/MCP-1.2.md](evidence/MCP-1.2.md)。

待明确的范围问题：目标成本是什么（进程数、内存、启动延迟、重连风暴），是否让更多 MCP 服务器共用生命周期管理，以及用什么验收指标证明效果。

## 2. 交互优化（大版本）

以下四项已在[交互设计文档](INTERACTION-DESIGN.md)中展开，其中包括拟议行为、运行环境差异、待定产品选择和验收标准。设计或实施这一里程碑时应阅读该文档；原始请求仍是意图依据，PLAN.md 仍是执行状态的依据。

### 2.1 侧边栏大小写显示

当前行为与需求相悖：项目标签被 CSS 强制转换为小写（`packages/ui/src/components/session/sidebar/projects/sortableItems.tsx:102` 中的 `lowercase` 类），粘性标题和 Recent 列表也复用了该样式（`SessionProjectScroller.tsx:415-428` 和 `SidebarActivitySections.tsx:267`）。会话标题会保留用户输入的大小写（`SessionNodeItem.tsx:1424`，重命名逻辑位于 `useSessionActions.ts:127-136`）。共享的 `Button` 基础类也会应用 `lowercase`（`components/ui/button.tsx:49`）。项目名和会话名目前都没有转为大写的逻辑。

任务：确定预期的大小写规则（文档说明的意图是按磁盘上的原样显示文件夹名称，见 `sidebar/utils.tsx:159-160`），并在项目标题、粘性标题、Recent、工作树分组和会话标题中保持一致，同时不改动无关的 Button 样式。

### 2.2 DIJIANG 发布仓库的更新通知

当前行为：个人构建的 `updatePolicy` 为 `"notify-only"`（`packages/web/personal-build.json`）；桌面端检查会获取 `openchamber/openchamber/releases/latest`，并将标签与上游版本比较（`packages/electron/personal-updates.mjs:10-26`、`personal-build.js:11-12`、`main.mjs:4467-4475`）。Web、移动端和 VS Code 会查询官方更新 API，并在失败时回退到 npm（`package-manager.js:23-187,675-704`）；它们从社区的 `changelog/index.json` 读取发行说明。

个人构建实际发布到这个 fork 的 Releases，版本格式为 `v<upstream>-DIJIANG.<feature.fix>`（见 [BUILD.md](BUILD.md) 的“操作”章节）。任务：验证新的 DIJIANG 发布元数据（fork Releases 或发布清单文件），并比较 DIJIANG 版本，让已安装个人构建的用户能收到有更新个人构建可用的通知。保留仅通知策略和 403 安装保护（`openchamber-routes.js:39-103`）。

### 2.3 工作状态：聊天中的呼吸效果

当前行为：聊天的工作状态行已使用 `BusyDots`，并带有透明度呼吸动画（`animate-busy-pulse`，1.2s ease-in-out infinite，在减少动态效果设置下禁用），代码位于 `packages/ui/src/components/chat/message/parts/BusyDots.tsx:8-23` 和 `packages/ui/src/index.css:1749-1760`。会话列表项显示静态圆点和 1 秒粒度的时长（`SessionNodeItem.tsx:730-746`、`SessionActivityDuration.tsx:11-33`）。另有两个已定义但目前未使用的关键帧动画：`navrail-dot-wave` 和 `border-glow-pulse`（`index.css:1762-1817`）。

任务：在对话界面本身增加呼吸效果（例如聊天容器或输入框周围的辉光或边框脉冲），并明确作用范围（仅在 `sessionStatus` 为 busy/retry 时显示）；如果合适，复用未使用的 `border-glow-pulse`。保留减少动态效果时的关闭选项。

### 2.4 添加项目的改进

具体范围仍需维护者说明。当前流程：`DirectoryExplorerDialog` 提供手动路径输入和自动补全、目录浏览、多选、克隆仓库和创建目录模式；提交通过 `useProjectsStore.addProject`（`packages/ui/src/stores/useProjectsStore.ts:596-656`）以及服务器路由 `GET /api/fs/home`、`GET /api/fs/list`、`POST /api/fs/mkdir`、`POST /api/fs/clone`（`packages/web/server/lib/fs/routes.js:710,723,761,1585`）处理。入口包括侧边栏标题、移动端抽屉、项目设置页和命令面板。

## 3. OpenCode 集成优化（大版本）

### 3.1 解耦集成模块，以支持其他智能体服务器

当前接口：共享 UI 通过 `@opencode-ai/sdk/v2` 类型与 OpenCode 通信（这些类型在一百多个文件中导入），并使用唯一的生产客户端工厂 `createRuntimeOpencodeClient`，位于 `packages/ui/src/lib/opencode/client.ts:218`，同一文件中由 `OpencodeService` 包装。同步层直接使用 OpenCode 事件结构（`packages/ui/src/sync/`）。服务器在 `packages/web/server/lib/opencode/*` 下管理生命周期、环境、网络、代理和配置路由，并在 `proxy.js` 中转发 HTTP/SSE。VS Code 有自己的运行时桥接（`packages/vscode/src/opencode.ts`）。

任务：在两端定义智能体服务器门面层（UI 适配器负责 SDK 类型和调用；服务器适配器负责启动、连接、健康检查和代理），让第二种智能体服务器可以在门面层之后实现，而无需修改功能组件。`ADAPTERS.md` 已确定一项约束：OpenCode SDK 仍是 OpenCode 的官方边界，门面层应包装 SDK，而不是替换它。本项采用与 `ui-api-decoupling` 技能相同的设计原则。

### 3.2 将连接模式明确为 UI 状态

要求：每种 OpenChamber 到 OpenCode 的连接行为都必须由用户明确选择，不能由环境变量决定，并且必须移除所有静默回退。所选模式失败时应显示失败。OpenChamber 不得在用户不知情时连接到其他端点、改用其他二进制文件或启动另一种模式。未来可以让用户配置回退策略，但设计必须支持完全明确的控制：届时存在的任何回退策略都必须是用户可见且由用户选择的策略，不能是内置默认行为。当前行为由环境变量驱动，且会静默降级：

- 系统会解析并验证 `OPENCODE_HOST`；值无效时会输出 `[config]` 警告并回退到自行启动服务器（`packages/web/server/lib/opencode/env-config.js:40-67`）。
- `OPENCODE_PORT` / `OPENCODE_HOST` 的优先级和验证只在 `env-config.js:28-72` 中定义；没有用于设置主机或端口的设置界面。
- 启动分支包括：复用健康的 HMR 进程；设置 `OPENCODE_SKIP_START` 和端口时信任外部端点而不探测；配置端口但未设置 skip-start 时先探测，若健康则静默连接外部服务器；否则 OpenChamber 始终启动自己的托管实例（`lifecycle.js:1117-1157`）。未选择连接模式时会刻意避免探测端口 4096。
- 托管二进制文件的解析顺序固定在代码中：持久化的 `settings.opencodeBinary`、`OPENCODE_BINARY`、捆绑的 Desktop CLI、PATH、已知安装位置，最后是平台 shell 探测（`packages/web/server/lib/opencode/DOCUMENTATION.md:175`）。由于捆绑的 CLI 优先级高于 PATH，除非通过设置或环境变量覆盖，否则打包版桌面应用目前不会使用系统 PATH 中的 OpenCode。
- 绑定主机名无效时会静默回退到 loopback（`env-config.js:74-95`）。

实现的硬性规则：以上每种行为最终都必须变成可见、可操作的失败，或明确的用户选择。默认策略是“严格按所选项执行”。如果保留回退，必须由用户选择，并在界面中说明已经发生回退。本规则适用于第 3 节中的所有条目，包括 3.3 的释放路径。

根据现有代码划分子项：

#### 3.2.1 服务器模式

3.2.1.1 外部服务器：用户在界面中输入主机/IP 和端口来选择该模式；使用前验证端点，失败时明确报错。目前只有设置 `OPENCODE_HOST` 并设为 `OPENCODE_SKIP_START=true` 才能进入此模式，且输入无效时会降级而非失败。现有的远程实例设置（`DesktopHostSwitcher.tsx`、`settings.remoteInstances.*`）连接的是另一台 OpenChamber 服务器，而非 OpenCode 端点，因此不属于此功能。

3.2.1.2 使用已配置的 opencode-like 命令启动托管服务器：只保留一个托管实例，从 UI 配置的命令启动，并从其输出中检测监听端点。这是对当前托管路径的细化：启动命令为 `opencode serve --hostname ... --port ...`（`lifecycle.js:378-424`），并从 `opencode server listening on http://...` 标准输出行解析 URL（`lifecycle.js:475-489`）。端口分配会请求配置的端口或分配空闲端口（`lifecycle.js:583-615`）。健康监控会在实例退出或健康检查连续失败时重启实例（`lifecycle.js:1299-1376`）。目前缺少的是一个区别于二进制文件覆盖项的“要运行的 opencode-like 命令”UI 字段，以及明确失败的契约，而不是对所有情况都重试的路径。

#### 3.2.2 原生模式（当前默认）

3.2.2.1 系统 PATH：仅从 PATH 解析 `opencode`。目前 PATH 排在固定顺序的第四位，位于捆绑 CLI 之后。

3.2.2.2 已配置命令：使用用户在界面中配置的路径。现在已可通过 `settings.opencodeBinary` 和 `OpenCodeCliSettings.tsx` 实现，后者提供浏览路径及保存并重新加载功能；`resolveManagedOpenCodeLaunchSpec` 会展开 Windows shim（`DOCUMENTATION.md:182`、`lifecycle.js:388-398`）。缺口在于此设置没有绑定到某种模式，仍参与回退链。

#### 3.2.3 捆绑模式

使用打包应用中捆绑的 OpenCode CLI。目前它通过解析顺序（`isBundledOpenCodeCliPath`）隐式优先，而不是由用户选择。对于 OpenChamber 发起的升级，捆绑运行时会拒绝升级（`upgrade-capability.js:33`）；注入的工具（智能体工具、系统提示词优化器、MCP 重连）只会在托管的非外部服务器中加载（`agent-tool/DOCUMENTATION.md:101`、`lifecycle.js` 模块文档）。模式切换必须在 UI 中说明这些影响，不能静默应用。

### 3.3 在服务器模式下重新加载时发送 dispose 请求

当前行为：延迟重启流程通过 `reloadOpenCodeConfiguration`（`packages/ui/src/stores/useAgentsStore.ts:834-882`）和待重启横幅（`lib/opencode/deferredRestart.ts:27-81`）调用 `POST /api/config/reload`（`packages/web/server/lib/opencode/core-routes.js:1012-1037`）。对于托管服务器，该操作会重启进程并重新读取配置。对于外部服务器，该操作只会重新探测健康状态，并提示用户手动重启（“restart your connected OpenCode server”），因为 OpenChamber 不拥有该进程。

OpenCode SDK v2 提供 `client.instance.dispose({ directory })`（`POST /instance/dispose`）和 `client.global.dispose()`（`POST /global/dispose`），定义于 `@opencode-ai/sdk`（`gen/sdk.gen.d.ts:312,500`）。任务：在服务器模式下发送 dispose 请求，让运行中的服务器释放并使用新配置重新创建实例，然后重新探测就绪状态，而不是让用户手动重启服务器。保持托管进程的重启路径不变，也不要释放用户未明确连接的端点。

### 3.4 上下文菜单的中文翻译

当前行为：应用内的上下文菜单均已通过 `useI18n().t()` 本地化，包括文件列表、会话列表、项目列表、标签页、MCP/skills/agents 侧边栏和文件链接菜单；基础组件为 `packages/ui/src/components/ui/context-menu.tsx:12-70`。仍硬编码英文的菜单位于 Electron 原生界面：应用菜单（`packages/electron/main.mjs:4927-5034`）、托盘菜单（`packages/electron/tray.mjs:188-310`）以及调用 `electron-context-menu` 且未提供标签的网页内容上下文菜单（`packages/electron/main.mjs:5037-5042`）。任务：为这些 Electron 菜单提供中文标签，并跟随当前 UI 语言。实施时报告发现的其他英文菜单项。

### 3.5 始终在对话标题处显示当前分支

当前行为：当 `showHeaderMetaRow` 为 true 时，标题栏元信息行会显示项目、通过 `useGitBranchLabel` 获取的 Git 分支（`packages/ui/src/components/layout/Header.tsx:743-744`）和工作树徽标；工作状态面板可见时，该行会消失（`Header.tsx:429-432,1473-1492`）。移动端标题栏按设计不显示项目/分支元信息（`packages/ui/src/apps/MobileHeader.tsx:34-38`）。任务：始终在对话标题处显示分支（数据来源：`useGitStore.ts:1530-1535`），并决定移动端的展示方式。

### 3.6 创建会话时刷新分支

当前行为：打开新会话草稿（`packages/ui/src/sync/session-ui-store.ts:1184-1332`）时不会刷新 Git 状态。输入框的 `useDraftTarget` 仅通过 30s TTL（`packages/ui/src/components/chat/composer/state/useDraftTarget.ts:113-145`）和轻量状态探测来刷新分支。如果其他程序在此期间切换了分支，草稿可能会一直显示旧分支，直到 TTL 到期。任务：在新会话草稿中增加明确的刷新控件，重新运行 Git 状态和分支查询，让用户在发送前确认分支。

### 3.7 悬停提示中的快捷键提示

当前行为：快捷键只在 `packages/ui/src/lib/shortcuts/config.ts:26-280` 中声明，并显示在设置、帮助对话框和命令面板中。目前没有共享机制将生效中的快捷键放入悬停提示；各处都在手动拼接（`TitlebarLeftControls.tsx:32,108-122`、`FocusModeButton.tsx:30,54-58`），有些操作按钮完全没有提示（新建会话见 `SidebarNav.tsx:16-23`，`SidebarFooter.tsx:36-51`）。任务：增加统一方法，在悬停提示中显示生效中的快捷键（`formatShortcutForDisplay`，`lib/shortcuts/bindings.ts:192`），并应用到主要操作按钮。

## 4. 解耦第三方平台（大版本）

目标：解耦所有第三方平台集成，让其他平台将来可以替换当前平台，并在两端（服务器和共享 UI）保留门面层。设计依据已在[ADAPTERS.md](ADAPTERS.md)中：平台适配器负责端点、认证、分页和载荷转换；应用操作使用与平台无关的仓库/变更请求/评审记录；GitHub 专属字段留在 GitHub 适配器内部。当前耦合包括：`packages/web/server/lib/github/` 下的 GitHub 服务器代码、`packages/web/src/api/github.ts` 中的 Web 适配器、`packages/ui/src/lib/api/types.ts` 中的共享类型、`useGitHubPrStatusStore.ts` 中的状态，以及单独的 VS Code 桥接组合。本地 Git、发行版元数据、skills 目录和 providers 按设计属于独立身份。

PLAN.md 已列出分阶段任务（HOST-01 清点和契约、HOST-02 仓库/PR 读取、HOST-03 修改和认证、HOST-04 第二个托管平台）。本节记录维护者希望将该计划作为一个大版本推进；HOST 任务仍是具体的执行细节。

## 5. 内置工具（大版本）

范围方向：整体优化和增强内置开发工具，并支持非原生 OpenCode 的 opencode-like 命令。当前最明确的例子是开发服务器自动发现：服务器扫描监听端口（Windows 使用 `netstat -ano`，其他系统依次使用 `lsof` 和 `/proc/net/tcp`），并提供 `GET /api/dev-servers`（`packages/web/server/lib/dev-servers/routes.js:71-135`）；浏览器面板会将已公告的服务器与探测到的服务器合并（`lib/browser/announcedServers.ts:3-17`、`lib/browser/devServers.ts:31-42`）；项目操作按钮提供“Auto-discover”（`ProjectActionsButton.tsx:389-400,466-511,551-570`）。

同类的其他发现工具包括：嵌套 Git 仓库发现（`fs/routes.js:307-378`、`GET /api/fs/git-dirs`）、Git 凭据发现（`git/credentials.js:7`、`git/routes.js:98`）、项目图标发现（`project-icon-routes.js:319-396`）、skills 发现和目录扫描（`skills.js:156-199`、`skills-catalog/`）、循环文件发现（`scheduled-tasks/loops.js:167-186`）以及运行实例检测（`packages/web/bin/lib/cli-lifecycle.js:163-219`）。

opencode-like 命令支持与 3.2 节相关：注入的工具和升级归属目前假定使用托管的、非外部的、已知二进制文件 OpenCode（`agent-tool/DOCUMENTATION.md:101`、`upgrade-capability.js:33`），因此支持 opencode-like 命令也会涉及同一套模式模型。详细范围和验收标准仍需维护者提供清单。

## 6. 通过设置配置无项目聊天目录（版本待定）

2026-09-25 追加。当前服务端只在启动时读取 `OPENCHAMBER_CHATS_DIR`；未设置时使用 OpenChamber 用户配置目录下的 `chats`（`packages/web/server/index.js:292-302`）。该环境变量可让 OpenCode 以其他用户运行时，将无项目聊天放在双方都能访问的位置，但目前没有对应的应用设置。

目标是在设置界面配置**服务器上的**无项目聊天目录，并由服务端持久保存，使连接同一服务器的客户端使用同一个生效目录。环境变量保留为旧部署的可选配置入口，不再是首选方式。优先级明确为：用户保存的设置值，其次是 `OPENCHAMBER_CHATS_DIR`，最后是当前默认目录。清除用户设置后才重新采用环境变量或默认值；用户显式设置了无效或不可访问的目录时，显示错误，不静默退回环境变量。

设置界面应显示生效路径及其来源，并说明路径属于服务器文件系统，不能把客户端本地路径误当成远端路径。保存后的生效时机必须明确；若需要重启服务，应提示用户并在重启后核验。改变目录只影响后续创建的无项目聊天，不自动迁移或删除已有聊天目录；既有会话仍按原路径读取，清理操作只处理经确认归属的聊天目录。项目和工作树聊天的存放规则保持原样。

验收时覆盖设置值、仅环境变量、两者都未设置及显式无效设置四种情况；检查服务重启后的持久化和跨客户端一致性。在 OpenCode 与 OpenChamber 由不同用户运行的部署中，实际创建并打开无项目聊天，验证双方都能访问目标目录，同时确认旧聊天仍可打开、目录切换不会误删数据。该项进入实施阶段时再纳入 [PLAN.md](PLAN.md)，并确定版本归属与迁移方案。
