# 个人维护计划

> 中文审阅与归档副本。英文交接源：[英文原文](../PLAN.md)。同步与交接规则见 [README](README.md)。

相关中文文档：[DEV-PLAN](DEV-PLAN.md)、[PLAN](PLAN.md)、[双内核架构](DUAL-KERNEL-ARCHITECTURE.md)、[OpenCode 集成规范](OPENCODE-INTEGRATION-SPEC.md)、[Legacy 1.2.27 规范](OPENCODE-LEGACY-1.2.27-SPEC.md)、[OpenCode 集成里程碑](OPENCODE-INTEGRATION-MILESTONES.md)、[OpenCode 集成审计](OPENCODE-INTEGRATION-AUDIT.md)。

## OpenCode 集成里程碑，2026-10-08

通用基线 INT-00 之后优先进行紧急 CAgent 工作。遵循[里程碑队列](OPENCODE-INTEGRATION-MILESTONES.md)中的 CA-00 至 CA-03，使用 [CAgent SPEC](CAGENT-INTEGRATION-SPEC.md)和[本地适配工作手册](CAGENT-ADAPTER-WORKBOOK.md)。2026-10-09 维护者明确调整为：完成架构与文档，验证原功能，构建并发布临时 Release，再进行其余 INT 开发。CA-03 留在环境内执行；此处不声称已适配真实 CAgent API。

[集成规范](OPENCODE-INTEGRATION-SPEC.md)和 [Legacy 1.2.27 规范](OPENCODE-LEGACY-1.2.27-SPEC.md)取代 DEV-PLAN 第 3 节的旧细节。[INT 里程碑队列](OPENCODE-INTEGRATION-MILESTONES.md)负责其执行状态、依赖和验收。RUN-01/RUN-02 是迁移后的计划条目，不代表实现已完成。当前覆盖情况见[源码审计](OPENCODE-INTEGRATION-AUDIT.md)。

## DIJIANG 3.2 更新历史与发布自动化，2026-09-14

- 设置中增加了懒加载、离线可用的 Update history 页面，覆盖 web、desktop、mobile 和 VS Code。持久 Markdown 源中审计过的 317 条历史记录全部保留，并为本次发布新增三条。搜索和筛选保留平台以及官方/个人分类。
- Workspace 类型检查、聚焦的 ESLint/Oxlint、八项历史/搜索测试和六项发布测试均通过。死代码检查仍发现既有的未使用导出积压。真实 Electron HMR 和打包协议 fixture 均显示 230 条 App 项，可切换来源/平台筛选，并适配 390px 宽度。
- 个人工作流现将只读构建与具有写权限范围的发布分开。源码/版本检查、已发布版本不可变、草稿重试、tag 冲突、中断上传和资源 digest 验证均经过测试。实际远端构建和发布仍需单独验收。
- H 盘空间不足后，本地 QA 输出移至可写的 C 盘可视化目录。只移除了失败任务缓存；已安装版本和用户数据均保留。

## DIJIANG 3.1 文件可靠性，发布准备 2026-09-14

- 文件加载现在会报告可恢复错误、保留未保存编辑并停止失败后的轮询。传输会串行处理完成和清理、校验最终字节数，并取消过期的保存/打开操作。原生启动失败会传给调用方。打包后缺失文档时会显示独立的恢复页面。
- 按所有权拆分提交：进程采样与关闭、项目资源策略、文件打开，然后是个人版本和维护记录。
- Workspace 类型检查通过。更新目录 stat 与隔离导入 fixture 后，文件路由回归测试 65 项全部通过。`LogsPage.tsx:119` 中原有的未使用变量仍阻塞完整 workspace lint。
- 发布检查还通过了 85 项运行时测试、21 个隔离测试文件和六项聚焦 Git 检查。基线对比发现批量 diff 回归：fatal Git 退出时可能保留部分 stdout。发布逻辑现在只接受成功退出或退出码 1 的 patch 输出。现有单文件 buffer 错误消息断言在 Windows CRLF 设置下的基线也会失败。其他完整 Git 套件的平台故障不属于本次发布改动。
- 死代码检查完成，仍有未使用导出积压。Git service 的 anti-slop 检查仍报告新增退出码保护之外的既有问题。完整 lint 和完整 Git 套件均未报告为通过。
- 源码提交后重新构建发布可执行文件，并设置 `GITHUB_SHA` 指向源码版本。其 `build-info.json` 标识该版本。本地 profile 和临时测试输出不纳入源码提交。

## DIJIANG 3.0 文件打开，已安装 2026-09-12

- 按获批设计实现文件打开。所有权和已测试媒体格式记录在 [FILE-OPENING-3.0.md](../FILE-OPENING-3.0.md)。
- Workspace 类型检查通过。聚焦的传输、ZIP、文件引用和 Markdown 回归测试通过。新模块通过 anti-slop lint。workspace lint 仍有一项无关的既有未使用变量：`packages/ui/src/components/sections/logs/LogsPage.tsx:119`。
- 使用隔离 profile 构建并启动最终便携可执行文件。运行时报告 `1.23.0-DIJIANG.3.0`，原生文件 API 可用，MKV 以 320 像素宽解码且 readyState 为 4，并提供 Save as/System open。HMR 验收还覆盖音频、ZIP 列表、行内图片、文件夹分类和独立文件上下文菜单。
- 安装到 `C:/Users/74756/AppData/Local/Programs/OpenChamber-Portable/1.23.0-DIJIANG.3.0/`。可执行文件 SHA-256 为 `1DC47BF73B0DEBB04CCFA847F215FB218FF49CCE8844E2FE2B9F833B90F777F3`。
- 将现有开始菜单 `OpenChamber.lnk` 更新为稳定版便携 EXE，保留 `dev.openchamber.desktop` 并清除测试参数。旧链接备份为新可执行文件旁的 `OpenChamber-before-3.0.lnk`；2.1 便携可执行文件和用户数据保持完好。
- 通过快捷方式验证普通 profile 启动：新实例显示 `Abyssys | OpenChamber`，连接其受管 OpenCode 进程，健康端点返回 `status: ok`。启动后快捷方式仍指向固定版本目录。
- 为避免索引生成的浏览器 profile，测试产物移出仓库。证据位于 `C:/Users/74756/.codex/visualizations/2026/09/12/01a094ca-074b-73e2-be93-7a4fd01b27fd/file-opening-evidence/`；最终打包验收位于同级的 `file-opening-qa/result.json` 和 `window.png`。未测试实时 SSH/relay 下载及其他平台的原生操作。未要求运行 Git 命令或发布。

维护者要求的 DIJIANG 1.2 性能优化及便携安装的本地发布验证记载于 [MCP-1.2](../evidence/MCP-1.2.md)。此发布记录不会更改下方 backlog 的验收状态。

最后更新：2026-09-08。下方任务状态是执行状态的唯一来源。设计选择可通过决策日志调整。除非某项任务已有获接受的证据，本文均描述未来工作。

## 首先阅读

1. 修改代码前阅读根目录 `AGENTS.md`、匹配的项目 skills 和所属模块文档。
2. 选择一项依赖均为 `done` 的 `ready` 任务。在表格中登记代理/任务身份、开始时间和当前 commit。另有代理活动时使用隔离 checkout。
3. 阅读该任务的范围和验收标准。预计会超过一次执行会话的工作应在开始前拆分。调整优先级时保留任务 ID。
4. 在 `docs/maintenance/evidence/<ID>.md` 记录变更文件、命令、退出结果、运行时证据和未解决问题。凭据和用户内容必须脱敏。
5. 将状态改为 `review`，绝不直接改为 `done`。由独立的高能力审查者检查实际 diff 和证据，再以具体发现标为 `done` 或 `changes_requested`。
6. 前置条件失败时标为 `blocked`，并记录失败前置条件和最小后续动作。计时器和空轮询结果不是扩大范围、安装依赖、发布或更改无关文件的授权。

计划任务代理仅应在用户安排时执行此流程。本文不会创建周期自动化。重新分派过期认领前，必须检查所属任务/进程。并行代理不得同时编辑同一任务表或文件；认领和合并由一名协调者负责。

状态：`backlog` → `ready` → `running` → `review` → `done`。其他状态：`blocked`、`changes_requested`、`cancelled`。重新打开的工作保留 ID 和先前证据。依赖项是任务 ID，不是行号。只有 `ready` 可在没有额外设计决策的情况下执行。

## 队列

| ID | 优先级 | 任务 | 状态 | 依赖项 | 执行者 | 审查者 / 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| BR-01 | P0 | 保留个人历史并合并社区 main | review | 无 | 当前任务 | [分支记录](../BRANCHES.md) |
| REL-01 | P0 | 独立个人版本与仅通知更新 | review | BR-01 | 当前任务 | [验证](../VALIDATION.md) |
| REL-02 | P0 | 本地便携流水线与 Actions 产物 | review | REL-01 | 当前任务 | [验证](../VALIDATION.md) |
| PERF-01 | P1 | 可复现的峰值/空闲基线与预算提案 | ready | 无 | 未认领 | 对工作负载和预算的高能力审查 |
| PERF-02 | P1 | 限制主要峰值工作负载 | backlog | PERF-01 | 未认领 | 独立正确性与测量审查 |
| PERF-03 | P1 | 空闲活动状态机与唤醒契约 | backlog | PERF-01 | 未认领 | 编码前架构审查 |
| PERF-04 | P1 | 实现一个经过测量的休眠/唤醒转换 | backlog | PERF-03 | 未认领 | 性能与恢复审查 |
| HOST-01 | P1 | 盘点平台耦合并提出契约 | ready | 无 | 未认领 | [适配器迁移指南](../ADAPTERS.md) |
| HOST-02 | P1 | 抽取 GitHub 仓库/PR 读取适配器 | backlog | HOST-01 | 未认领 | 运行时一致性与迁移审查 |
| HOST-03 | P2 | 抽取平台修改操作与认证 | backlog | HOST-02 | 未认领 | 权限、身份和故障审查 |
| HOST-04 | P2 | 用第二个托管平台验证替换能力 | backlog | HOST-03 | 未认领 | 需要选定平台和测试端点 |
| RUN-01 | P1 | 连接契约；已转交 INT-00/INT-01 | migrated | 见 INT 队列 | 未认领 | 集成规范审查 |
| RUN-02 | P1 | 明确模式与重新加载；已转交 INT-02/INT-06/INT-06L | migrated | 见 INT 队列 | 未认领 | 原生进程与 UX 审查 |
| LOG-01 | P1 | 按有界诊断需求审计现有日志 | ready | 无 | 未认领 | 脱敏与保留策略审查 |
| LOG-02 | P2 | 实现经审查的日志缺口 | backlog | LOG-01 | 未认领 | 故障与资源预算审查 |
| VIEW-01 | P2 | 定义双屏和工作区标签行为 | ready | 无 | 未认领 | 用户交互设计审查 |
| VIEW-02 | P2 | 实现持久工作区标签 | backlog | VIEW-01、PERF-03 | 未认领 | UX 与状态所有权审查 |
| VIEW-03 | P2 | 实现第二屏移交和恢复 | backlog | VIEW-02 | 未认领 | 双显示器原生验收 |
| QA-01 | P1 | 汇总发布审查 | backlog | REL-01、REL-02 | 未认领 | 独立高能力审查者 |
| QA-02 | P1 | 修复继承的验证阻塞项 | ready | 无 | 未认领 | Prewarm 测试 fixture 和 Logs 页面 lint |

## 任务契约

### BR-01，保留个人功能

保留本地个人 commit 栈、三项未提交修改及 `Temp/`。独立跟踪社区 main 与 fork 的旧功能历史。记录基线 SHA、备份 refs、分歧和合并结果。干净合并只能证明历史集成；个人行为需要通过 [BRANCHES.md](../BRANCHES.md) 中的回归清单验证。

### REL-01，独立版本与更新

社区版本仍由 workspace manifests 管理。`packages/web/personal-build.json` 管理两级 DIJIANG `feature.fix` 版本及更新策略。功能和重构提高第一级并将 fix 归零；优化和修复提高第二级。版本标准和旧身份处理见 [BUILD.md](../BUILD.md)。桌面显示/产物版本组合两者，例如 `1.23.0-DIJIANG.1.1`；CI 只在构建元数据中记录运行编号和尝试编号。更新可用性只比较社区版本。保留检查能力；下载、安装、退出时自动安装、直接 HTTP 安装和 CLI 替换必须在产生副作用前被阻止。普通重启仍应可用。

验收：同版本/新版本/无效/失败的发布检查；不得通过直接入口启动安装器；本地化的仅通知 UI；显示当前个人版本；fork 不得发布社区更新清单。除单元测试外还必须实际启动打包版本。

### REL-02，便携构建

Windows x64 是首个受支持的个人产物。一个根目录脚本运行现有 staging、OpenCode 验证、原生重建和打包，并禁用发布。Actions 调用同一脚本，上传带版本号的产物和构建元数据。CI 记录构建身份但不更改应用版本。个人发布需有意递增 DIJIANG 整数。

验收：使用 lockfile 干净安装依赖；生成本地可执行文件；打包资源/原生模块成功加载；验证内置 OpenCode；版本与元数据一致；启动和关闭成功；构建失败时不产生成功产物。Actions 执行需要推送已审查分支；仅检查 YAML 不得声称远端执行成功。便携表示无需安装程序；现有 AppData/config 路径仍适用。

### PERF-01，基线与预算

阅读 `scripts/perf/DOCUMENTATION.md`。测量前盘点当前按需加载会话、折叠项目规则、托盘订阅和启动预热。使用 production 构建及现有 `profile:idle`、`profile:session`、`profile:switch` 工具。仅在缺少已测场景时扩展工具。

记录硬件、OS、构建 SHA、项目/会话/消息数量及载荷大小。覆盖冷启动、热切换、长流式输出、大量项目、重连突发、前台空闲、最小化/后台和双窗口。每种场景记录三次可比较采样，并给出 long task 时长的中位数、p95 和最大值、CPU 忙碌时间、heap/RSS 峰值、网络请求数和定时器唤醒次数。分别归因 Electron、renderer、server 和受管 OpenCode。

交付物是证据报告和预算提案，不是优化。基线审查后再确定以下初始预算候选：明确限制同时运行的后台请求和待处理工作；正常交互中避免超过 200 ms 的任务；在报告场景下将可归因的空闲 CPU/唤醒次数至少降低 50%；多次激活后防止内存持续增长。这些是目标，不是已测得结果，也不是对外部服务器的硬限制。

### PERF-02，峰值控制

选择测得的主要放大因素，例如全局历史加载、stream 批处理、并发度、大型输出渲染或保留缓存大小。定义在途工作、排队项目和保留数据的限制，包括背压/取消行为。绝不能为了达到预算而丢弃最终消息、permissions 或权威状态。每个子任务实现一项有界改动。

验收：代表性峰值符合审查通过的预算；不出现重复重叠拉取；部分失败时无关实体仍正确；提供冷/热场景证据；包含操作次数或突发回归测试。没有测得收益的更改不予接受。

### PERF-03 与 PERF-04，休眠与唤醒

分别定义 `active`、`idle`、`background` 和 `suspended`。窗口隐藏不代表服务器或 agent 可以停止。任务执行、审批交付、必要心跳和权威实时状态仍须可用。只有在没有活动消费者时才暂停非必要发现、动画和刷新工作。说明窗口间共享哪些工作。

因用户聚焦/输入、相关实时事件、显式刷新和端点变更而唤醒。恢复只执行一次，取消过期请求，协调错过的状态，避免全量刷新风暴。覆盖操作系统睡眠/恢复、网络断开、服务器重启和多窗口。验收包含重复休眠/唤醒周期、不丢失审批或完成通知、有界内存和定时器、经过测量的唤醒延迟。状态转换表审查通过后再实现。

### HOST-01 至 HOST-04，平台替换

遵循 [ADAPTERS.md](../ADAPTERS.md)。分别盘点 GitHub、Local Git、Linear、发布元数据、skills catalog 下载、凭据、relay/tunnels 和模型 providers。区分协议传输、托管平台集成和应用操作。OpenCode SDK 仍是官方 OpenCode 边界。

HOST-01 以真实调用方/文件清单和 capability 表结束，并涵盖每种运行时。HOST-02 通过 GitHub adapter 端到端迁移仓库身份及 PR/status 读取。只有读取路径一致后，HOST-03 才处理修改操作和认证。HOST-04 需要选定内部托管平台产品、URL/认证要求和可访问的测试环境；缺少这些条件时，记录阻塞前置条件，并且只将确定性契约 fixture 作为离线证据。

### RUN-01 和 RUN-02，受控 OpenCode 启动

已于 2026-10-08 被[集成规范](OPENCODE-INTEGRATION-SPEC.md)中的五模式连接和 profile 感知重新加载契约取代。实现在[里程碑队列](OPENCODE-INTEGRATION-MILESTONES.md)中跟踪为 INT-00/INT-00L/INT-01/INT-02/INT-06/INT-06L。此次迁移不代表旧任务已实现。外部进程所有权、明确失败和进程内 OpenChamber backend 仍是要求。

### LOG-01 和 LOG-02，诊断

盘点现有每日 JSONL 运行时日志、受管 OpenCode 事件、stderr 尾部、MCP 故障报告和 Logs 设置页。识别缺口，不要替换现有机制。提出一种事件 schema，包含时间戳、严重性、子系统、操作/关联 ID 和运行时身份；默认排除秘密及用户提示。

定义文件大小/数量/年龄保留策略、事件最大尺寸、队列长度和写入失败行为。限制高频日志并公开丢弃事件计数器。提供筛选、安全导出和明确的诊断包预览。验收覆盖轮换、磁盘已满、目录不可用、记录格式错误、并发来源和脱敏。日志不得成为主要峰值负载，也不得让空闲应用持续繁忙。

### VIEW-01 至 VIEW-03，双屏与标签

初始提案：工作区标签选择独立的项目/会话上下文；第二个原生窗口可在另一台显示器上呈现另一个上下文。构建新的 shell 概念前，先检查现有原生多窗口和 Mini Chat 支持。确定选择是联动还是独立、键盘导航、标签关闭行为、未保存草稿、活动任务可见性，以及共享或窗口本地设置。

将持久标签身份与已挂载内容分开存储。非活动标签遵循经审查的休眠规则，同时服务器任务继续运行。两个窗口不得启动重复受管服务器、重复写入或倍增后台轮询。验收：在不同缩放比例的显示器间移动、拔掉显示器、恢复屏幕外窗口、关闭/重新打开标签、保留草稿/焦点/滚动位置、在正确上下文收到审批，并截取真实 UI 截图。VIEW-01 必须先产出经审查的交互规范，之后才能改源码。

### QA-01，独立审查

在指定 commit 上审查集成后的 diff，不要只看任务摘要。验证更新限制、分支 ancestry、个人功能回归、打包行为、CI 发布边界和文档限制。按具体风险归纳发现，并附文件/行号和复现步骤。为每项修复分配任务 ID，并重跑受影响检查。只有审查者可以将已接受的任务标为 `done`。

## 决策日志

QA-02 限于 `packages/ui/src/stores/useConfigStore.prewarm.test.ts` 中不完整的 storage fixture，以及 `packages/ui/src/components/sections/logs/LogsPage.tsx` 中未使用的 `currentFilePath`。应确定真实 storage 契约，不要再增加宽泛的模块 mock。验收为 prewarm 测试通过且 UI lint 通过，不改变行为或抑制规则。已观察到的失败见 [VALIDATION.md](../VALIDATION.md)。

| 日期 | 决策 | 原因 / 重新评估条件 |
| --- | --- | --- |
| 2026-09-07 | 将上游合并到 `codex/personal`，保留旧 refs | 现有本地/fork 功能历史包含等效的改写 patch；避免重复合并或强推 |
| 2026-09-07 | 立即实现打包/版本/更新策略；其他功能先规划 | 用户明确选择此范围 |
| 2026-09-07 | 个人语义版本从 0.1.0 开始 | 与上游独立；个人发布时再审慎调整 |
| 2026-09-07 | 仅生成 CI 产物，不替换应用 | 用户需要通知及受源码控制的个人维护 |
| 2026-09-07 | 首先支持 Windows x64；继续使用 AppData | 当前工作站和既有 Electron runtime；完整可移动盘数据便携是独立需求 |

## 证据模板

每个任务证据文件记录：任务 ID、基线/最终 commit、负责人、状态、变更文件、验收清单、准确命令及结果、生产/运行时产物、未测试边界、回滚说明、审查者身份和发现。静态检查通过的代码更改，在所需运行时边界完成检查前仍保持 `review`。按同一 ID 保留按时间排列的尝试记录，包括失败假设。

## 本地验收：DIJIANG 2.1，2026-09-12

- 将客户端项目模式接入受管 MCP 生命周期，保留活动客户端和权威运行会话，处理多个自有 BGPM 连接，并增加有界的释放/恢复/保留日志。打包验证发现 HTTP 400 后，修复路由缺失的 JSON parser。
- 20 项聚焦 MCP 测试和 3 项资源报告测试通过。原生验证使用两个真实 BGPM 连接：10 个进程、497 MiB working set；空闲释放后自有进程归零。运行会话保护及提示时恢复均通过。这是受控生命周期结果。
- Workspace 类型检查通过。聚焦 ESLint/Oxlint 通过。完整 lint 仍有既有 QA-02 `LogsPage.tsx` 未使用 `currentFilePath` 错误。
- 构建便携包后，仅重新打包服务器端 JSON parser 修复，并沿用已验证的 UI/原生资源。已安装版本 SHA256 为 `13D5E2D806275FB39B358282AEF44C1E77E5876BA4B490DFB58175933DAFD828`。
- 更新现有开始菜单 `OpenChamber.lnk`，保留 `dev.openchamber.desktop`，并通过该入口启动。旧快捷方式备份在已安装可执行文件旁；2.0 仍可用。
- 普通用户验收时间为 15:14:54 CST：13 个报告目录处于空闲状态，记录了五次 MCP 释放；原生采样在新应用树中发现零个 MCP guards 和零个 Node helpers。保留了七个基础进程，working set 合计 1163 MiB，机器 CPU 为 0.21%。这些是当前观察值，并非与先前启动进行标准化比较的完整应用性能数据。
- 证据：`Temp/idle-native-result-final.log`、`Temp/portable-install-2.1.json`、`Temp/idle-workspace-types.log`、`Temp/idle-workspace-lint.log` 和 `Temp/idle-dead-code-final.log`。未要求执行 Git 命令、提交或发布。未测试其他平台的原生释放行为。

## 本地验收：DIJIANG 3.5，2026-09-21

- 维护者将图表归为 3.x“更多打开方式”功能的扩展。发布身份为 `1.23.0-DIJIANG.3.5`；初步本地 `4.0` 产物已被取代，不是发布候选。
- 增加 PlantUML 聊天/文件渲染以及源码/图片导出、九种 Mermaid 样式、深色模式线条对比度和共享的展开视图鼠标/上下文菜单控件。未变化的目录刷新会保留状态身份。未复现报告中的滚动卡顿；不声称原场景 FPS 有所改善。
- Workspace 类型检查通过。聚焦 renderer、设置、viewer 和发布策略检查通过，包括四项双语历史/版本测试。完整 lint 仍有前文记录的 QA-02 未使用 LogsPage 变量。
- 完整便携构建完成 web staging、固定版本 OpenCode 验证、原生重建和 Electron 打包。更新双语发布历史后，重新构建并打包最终 UI。本地 EXE SHA-256：`44247A42516DEFF49BB4FE853CCF20F1E84CAE5B85ECCCDB17684DD21D2D889F`。
- 使用独立临时 profile 启动最终 EXE。About 显示 `1.23.0-DIJIANG.3.5` 和 OpenCode `1.18.30`；health 返回 200，普通构建的 debug endpoint 返回 404。实际 Files 预览渲染了 PlantUML 和 Mermaid；PlantUML 大型 viewer 可缩放，并提供 reset/copy/export 菜单项。界面没有缩放按钮。随后关闭测试实例。
- 证据位于 `.codex-temp/diagrams-qa/`：`release-3.5-package.log`、`release-3.5-final-assets.log`、`release-3.5-final-package.log` 和 `portable-3.5-profile/{result.json,acceptance.png,cleanup.json}`。这些是本地验收产物；CI 产物会携带推送的源码 commit。
- 未替换已安装的用户应用或数据。回滚方式仍是打开保留的上一版便携可执行文件。已安装 VS Code 和移动设备行为不在本次验收范围。
