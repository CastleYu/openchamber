# DIJIANG 3.7 测试计划

本文记录 `1.24.2-DIJIANG.3.7` 准备工作的测试范围。
这里列出功能覆盖范围和证据索引。第二次合并社区更新后，完整自动化门禁已通过；原生便携版和外部服务验收仍需单独进行。

## 测试运行器

根目录的 `test` 脚本先运行隔离脚本测试套件，再运行 SDK、UI、VS Code、
Electron 和 Web 各软件包的测试套件。`scripts/run-isolated-tests.mjs` 会递归查找
`*.test.*` 和 `*.spec.*` 文件，跳过构建目录和依赖目录，并以最多四个工作进程分别运行每个文件。

隔离运行器会为 TypeScript 文件和导入 `bun:test` 的文件选择 Bun；为导入
`node:test` 的 JavaScript 文件选择 Node 的 `--test`。没有这两种导入的文件会标记为未知，
而不是静默跳过。这是基于文件名和导入语句的启发式判断，不会调用 Vitest。

Web 软件包通过 `packages/web/vitest.config.ts` 使用 Vitest。该配置将 `bun:test`
映射到软件包 shim，纳入共享 UI 的 Vitest 文件，并提供这些测试所需的浏览器别名。因此，
Web 测试应使用 Web 软件包命令，而不是隔离 Node 命令。根目录测试命令会在 SDK 和 UI 套件之后运行 Web 软件包测试。

## 功能覆盖矩阵

| 范围 | 主要证据目标 | 运行器或命令 | 证据类型 | 仍需验收 |
| --- | --- | --- | --- | --- |
| 更新历史解析及中英文一致性 | `packages/ui/src/lib/settings/updateHistory.test.ts` | 在 `packages/ui` 中运行 `bun test src/lib/settings/updateHistory.test.ts` | 对排序、分类、类别、贡献者和预览标记的单元断言 | 在每个已挂载界面中检查实际显示的筛选项和类别分组 |
| 设置注册表、各界面取值及持久化投影 | `packages/ui/src/lib/settings/registry.test.ts` 和 `search.test.ts` | 从 `packages/ui` 运行针对性 Bun 测试 | 注册表、解析器和搜索的单元证据 | 最终合并后重新检查生成的快照 |
| Mermaid/PlantUML 显示和导出 | UI 图表测试及现有图表验证记录 | `bun run --cwd packages/ui test`，以及文档中列出的夹具命令 | 单元证据，以及已有的隔离浏览器/文件证据 | 针对最终发布构建重新运行 |
| 文件预览、打开和保存行为 | Files 视图测试及文件打开维护证据 | UI 软件包测试及隔离 Electron 夹具命令 | 单元证据、打包夹具证据和原生边界证据 | 使用最终可执行文件进行原生打包验收 |
| 会话加载、侧边栏和工作状态 | 共享 UI 同步/侧边栏测试 | `bun run --cwd packages/ui test` | 单元证据和状态协调证据 | 使用 Web、桌面版和 VS Code 进行跨界面运行检查 |
| MCP 生命周期和重连行为 | Web 服务器 MCP 测试及现有生命周期证据 | `bun run --cwd packages/web test` | Node/Vitest 单元证据及隔离进程证据 | 检查长时间运行的打包版本 |
| Electron 启动、关闭、SSH 和更新器 | Electron 测试及打包探测 | `bun run --cwd packages/electron test` | Node 单元证据及原生夹具证据 | 对最终便携版进行安装、更新和退出生命周期验收 |
| SDK 和扩展契约 | `packages/sdk` 测试/构建及扩展夹具 | `bun run --cwd packages/sdk test` 和 `bun run --cwd packages/sdk build` | SDK 单元/构建证据 | 在最终应用中安装并运行已构建的扩展 |
| Web 路由及 UI Vitest 套件 | Web 服务器测试及共享 UI Vitest 文件 | `bun run --cwd packages/web test` | 分开记录的 Node 和 Vitest 结果 | 运行最终完整套件，并对便携版进行 API 冒烟检查 |

## DIJIANG 回归用例

每行都表示社区更新合入后需要保留的契约。模拟测试通过，只能证明该契约通过了自动化检查，不能据此声称已使用安装后的应用。

| 功能 | 成功路径 | 失败、清理或边界路径 | 负责的测试 |
| --- | --- | --- | --- |
| 便携版身份和更新 | 稳定版/调试版版本字符串及双语历史记录与构建身份一致 | 仅查询版本的命令不会打包或覆盖元数据；个人构建会拒绝安装器端点，同时保留社区版行为 | `scripts/build-personal.test.mjs`、`packages/ui/src/lib/settings/updateHistory.test.ts`、`packages/web/server/lib/opencode/openchamber-routes.test.js`、`packages/ui/src/lib/web-update.test.ts` |
| 原生文件打开 | 可通过系统或所选应用打开由窗口持有的副本；无需解压即可列出 ZIP 中央目录条目 | 取消操作、大小限制、无效压缩包结构、进程退出和窗口销毁都会释放临时文件并拒绝过期结果 | `packages/electron/file-transfers.test.mjs`、`packages/web/server/lib/fs/zip-directory.test.js`、`packages/web/server/lib/fs/routes.test.js` |
| 经过身份验证的文件资源 | 工作区内读取和明确请求的工作区外读取使用相同运行时契约；图片/媒体 URL 在浏览器和桌面端均可用 | 中止信号、范围请求、416 响应、操作系统拒绝读取及工作区外写入限制均会明确体现 | `packages/web/src/api/file-assets.test.ts`、`packages/web/server/lib/fs/routes.test.js`、`packages/web/server/lib/fs/byte-range.test.js` |
| 图表 | Mermaid 样式选择和 PlantUML 渲染会保留源码、预览及 SVG/PNG 导出 | 不完整的流式文本会等待；渲染/导出失败仍作为错误处理；更改样式不会复用过期输出 | UI Markdown、图表和图片导出测试；打包版视觉检查仍需单独进行 |
| 受管进程所有权 | 受管 OpenCode 在启动时注册，并在退出后移除；CLI 在 Windows 上会核验恢复出的 PID 身份 | 启动失败、超时、显式关闭、父/子进程退出、孤儿清理及身份未知时，都不会误报注册表健康且为空 | `packages/web/server/lib/opencode/lifecycle.test.js`、`managed-process-registry.test.mjs`、`packages/web/bin/cli.test.js` |
| MCP 重连和空闲释放 | 受管 OpenCode 2.x 子进程会加载插件目录；服务器连接失败时会按有界退避策略重连 | 不干预已禁用或需要身份验证的服务器；空闲释放会保留活动工具；用户自己的 OpenCode 配置使用内容回退方案；外部/VS Code 运行时不会收到受管插件 | `packages/web/server/lib/mcp-reconnect/*.test.js`、`packages/web/server/lib/opencode/managed-config-file.test.js` |
| 会话资源预算 | 重点会话更早刷新；后台批次保留每个文本增量；侧边栏只加载符合条件的目录 | 重连、过期快照、隐藏视图、已中止的请求和卸载都会释放租约，且不会将获取失败显示为空结果 | `packages/ui/src/sync/event-pipeline.test.ts`、`packages/ui/src/lib/performance/projectResources.test.ts`、`packages/ui/src/components/session/sidebar/list/sessionBootstrapDemands.test.ts` |
| Guest 和 SDK 边界 | 共享 SDK 会将 Windows 盘符路径识别为文件系统路径；已构建示例符合契约 | 路径遍历、缺少授权、服务已禁用、请求已取消及服务进程已停止时，操作都会失败，且不会泄露能力 | `packages/sdk/src/contract.test.ts`、`packages/sdk/scripts/examples.test.ts`、`packages/web/server/lib/guests/{files,service,ssh-install}.test.js` |

隔离测试运行器会在独立进程中分别运行每个 Bun/Node 测试文件。Vitest 会单独运行 Web 套件；其中排除的四个原生 Node 文件由 `test:node` 执行。这样，一个文件中的模拟或进程级环境变更就不会影响下一个文件。完整根目录命令是发布门禁；针对性重跑只用于诊断某个范围。

## 命令

从对应的软件包目录运行针对性检查：

```text
bun test src/lib/settings/updateHistory.test.ts src/lib/settings/registry.test.ts src/lib/settings/search.test.ts
node scripts/run-isolated-tests.mjs scripts
bun run --cwd packages/sdk test
bun run --cwd packages/ui test
bun run --cwd packages/vscode test
bun run --cwd packages/electron test
bun run --cwd packages/web test
```

完整的根目录入口是 `bun run test`。单独运行 `bun test` 会绕过软件包编排，不可替代完整套件。
需要针对性结果时使用对应软件包命令。未运行的命令不得记为通过。

## 证据规则和未完成事项

每项结果都要记录准确的提交、命令、运行器、退出状态和相关输出。静态检查、单元测试、浏览器夹具、打包运行时检查和外部服务检查应作为不同证据类型分别记录。测试文件通过，不能证明原生 Shell、中继、OpenCode 进程、移动端布局或发布构件正常工作。

最近一次审查的社区 main 提交为 `0af1eb00c`。上面的回归映射为每一类保留的 DIJIANG 功能列出负责的自动化测试，并至少包含一个边界或清理用例。完整根目录运行器、便携版打包和原生验收共同构成最终发布证据；软件包测试数量已记录于 `DIJIANG-3.7-DELIVERY.md`。

覆盖情况按契约和运行时边界审查，不使用臆造的代码行百分比。仓库没有全局插桩覆盖率脚本。单元测试不能证明长时间运行的外部 MCP 连接、真实移动端或 VS Code 渲染、针对在线主机的 SSH 行为，或便携版应用的关闭清理。这些仍是明确的运行时验收边界，不能算作已由模拟测试覆盖。
