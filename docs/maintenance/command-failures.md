# Command environment notes

## 2026-09-10

- The upgrade verifier initially expected the desktop personal version from `/api/version`. That endpoint reports the community server version (`1.22.2`); the installed desktop identity is `1.22.2-personal.0.1.0`, verified separately through the installer registration. Check each version at its owning boundary.
- Automatic approval quota exhaustion temporarily blocked the already-authorized upgrade after backup. On user continuation the same scoped cleanup and installer commands succeeded.

- Resuming the task invalidated earlier terminal session IDs. Read the saved build/test logs and inspect exact test command lines instead of retrying an expired session ID.
- Vite fixture servers exit when their pipe stdin closes. Use a PTY for interactive verification and stop only the fixture's own process.
- Fully isolated OpenCode smoke runs must disable parent-project configuration discovery and bound SDK requests. The corrected native smoke passed and confirmed child-process cleanup.

## 2026-09-09

- The isolated UI smoke initially collided with an existing listener on port 4599. Its OpenCode and MCP processes cleaned up successfully. Request port 0 from `startWebUiServer` and use `getPort()` for the assigned port; do not reuse or stop the existing listener.

- Automatic approval initially rejected the isolated MCP smoke command because its usage quota was exhausted. After the user requested continuation, the same command was approved and the native lifecycle check passed.
- The full Git service suite has Windows failures in untouched paths: slash normalization assertions, CRLF expectations, shell script hooks, and quoted `cmd /c` setup commands. Run the affected diff suites separately; do not treat these failures as an occupancy regression.
- Workspace lint reports an unused `currentFilePath` in `components/sections/logs/LogsPage.tsx`, outside the occupancy changes, plus an existing dependency warning in `MobileChangesSurface.tsx`. Keep these separate from focused validation.

- Optional `packages/ui/README.md` and sibling OpenCode source paths are absent. Check paths before reading; use the pinned upstream source when local source is unavailable.
- PowerShell does not expand wildcards in ripgrep path arguments. Search the existing parent directory with `-g` instead.
- `bun run type-check` could not start workspace subprocesses in the sandbox. The same command with scoped escalation started successfully.

## 2026-09-07

- `git fetch origin` could not write `.git/FETCH_HEAD` under the workspace sandbox. The approved retry of the same Git command succeeded. Use scoped Git escalation for repository metadata writes; ordinary source edits remain sandboxed.
- `Get-Content packages/ui/README.md` found no file. Check optional package documentation with `Test-Path` before reading it.
- Ripgrep paths containing shell-style wildcards did not resolve on Windows. Pass existing directories and use `-g` filters instead.
- Node test isolation and Vite/esbuild child-process creation failed with `spawn EPERM` in the sandbox. Run individual Node test files directly when isolation is unnecessary; use scoped escalation for the actual packaging/test process tree.
- The first portable build reached Electron Builder but found a stale local dependency tree, missing `@opencode-ai/sdk@1.18.29` for `@openchamber/web`. Reconcile installed dependencies with `bun install --frozen-lockfile` after an upstream merge before retrying packaging.
- Optional output logs may not exist while their preceding command is still running. Check `Test-Path` before reading them.
- `Get-CimInstance Win32_Process` was denied in the sandbox. Use scoped read-only escalation when native process ownership must be inspected.
- A first portable smoke launch exposed no CDP renderer. The test environment had set `ELECTRON_RUN_AS_NODE` to an empty value; remove the variable entirely for Electron GUI launches and record early process exits before waiting for CDP.
- `--background` startup can intentionally create no renderer. GUI smoke tests need a normal window; `OPENCODE_HOST` must be a full URL. The corrected portable smoke loaded `openchamber-ui://app/index.html`, returned the personal version and rejected update IPC.
- On 2026-09-07, automatic approval review rejected final asset rebuilding because its account usage limit was exhausted. No alternate execution bypass was used. After the user resumed on 2026-09-08, the same scoped build escalation was accepted.
- HMR smoke initially pointed Vite at its default API port 3001 instead of the isolated Electron backend. Seed `desktopLocalPort` and use matching `OPENCHAMBER_PORT`/`OPENCHAMBER_HMR_API_PORT` in the test environment. Desktop About uses its own dialog, not the mobile-only Settings navigation entry.
- Automatic approval rejected termination by port alone. Read-only inspection proved PID 51608 was this task's project Vite command started at 13:17:18. A retry targeting that PID and rechecking its command was approved.
- Reusing the HMR debugging port let a later smoke attach to the wrong page. Final portable verification used a dedicated port, explicit packaged mode, the `openchamber-ui:` URL requirement and a 90-second timeout. It passed version-display and update-denial checks. Cleanup requests were retried only after approval-service quota errors cleared and the user resumed.

## 2026-09-10 upstream sync

- Automatic approval rejected a batch restoration script as too broad. It was not executed. Restore conflicts were instead reviewed and patched individually. The three old settings definitions were replaced only after a read-only diff proved their entire saved delta was occupancy support and that support had been migrated into the new registry.
- Stash restoration exposed a source NUL that made useWalkthroughStore appear binary. A three-way candidate with equivalent escaped NUL characters merged cleanly; its complete diff was reviewed before applying that one file.

- Sandbox Node-to-Git and Bun workspace subprocesses failed with EPERM / Failed to start process. The same scoped commands ran with escalation.
- The clean upstream comparison worktree needed both web and UI node_modules links; the root link alone cannot resolve Vitest or @pierre/diffs.
- The upstream package-import test calls npm without a Windows executable shim and fails with spawnSync npm ENOENT on both upstream and integration.
- Windows Git fixtures assume POSIX paths, LF, executable shell hooks and command quoting. Compare their failures against the exact fetched upstream before attributing them to integration.
- Native rebuild reached MSB8040 because Visual Studio Spectre libraries are absent. Web assets, OpenCode CLI verification and Electron main bundling completed; do not call this a successful portable package. The dependency already ships Windows prebuilds for an isolated runtime check.
- The smoke helper exports evaluateValue, not evaluate. Use the actual export when constructing the CDP probe.
- A failure-log patch assumed a nonexistent heading. Anchor patches to observed text.
- CDP Browser.close can close the socket without a response; wait for the child exit with a bounded timeout rather than await that response indefinitely. A later port probe correctly returned ECONNREFUSED after the owned process exited.
- HMR reloaded during a long component-mount wait. The separate HMR bridge check passed; full panel interaction was validated with bundled assets. Keep those claims separate.

## 2026-09-10 performance panel
- Isolated preview scanned unrelated workspace HTML and warned about VS Code aliases. Limit optimizeDeps.entries to its own HTML. Theme/settings 404s belong to this minimal fixture, which only registers the real performance route; they are not full-server integration results.
- Follow-up: native collector and build:web again hit sandbox spawn EPERM. The same scoped commands succeeded in starting with escalation; native sampling completed. PowerShell rg does not expand a wildcard in a path argument; discover exact filenames first.
- Follow-up inspection attempted absent packages/ui/README.md and hooks/usePerformance.ts. Polling lives in components/layout/PerformancePanel.tsx; discover optional files before reading them.
- Optional ui/popover.tsx and packages/ui/README.md are absent; use the existing Dialog primitive and verify optional paths first.
- A patch assumed a heading that was absent in this log; append entries without guessing context.
- apply_patch could not create a new nested performance directory; create the directory explicitly before adding its files.
- Locale files use different dictionary declarations; inspect exact declarations before patching. apply_patch reported a reparse-point error on ko.ts; inspect filesystem metadata before retrying.
- Transient mapped-file write failures occurred during locale edits; wait for the running type checker and replace the completed file atomically if needed. Metadata confirmed the locale files are regular files.
- Native performance smoke hit spawn EPERM in the sandbox; retry the same read-only collector with scoped escalation.
- build:web hit esbuild spawn EPERM; dead-code hit Bun temporary-directory AccessDenied. Retry the same required checks with scoped escalation.
- Optional ThemeSystemProvider.tsx was absent; discover provider filenames before reading.

## 2026-09-12 file opening design inspection
- Read-only searches used guessed filenames and literal wildcard paths, causing rg errors 2, 3, and 123. Discover exact paths with rg --files first; pass directories with -g filters instead of wildcard path arguments. Corrected reads located RightSidebarTabs.tsx and message/MessageBody.tsx. No application source changed.

- 2026-09-12 implementation inspection: PowerShell quoting around a regex caused a parse failure. Use single-quoted regex patterns and discovered paths; the corrected read succeeded.
- 2026-09-12: Node direct write to main.mjs failed with UNKNOWN on the mapped workspace. Use same-directory temporary write and atomic rename for subsequent edits.
- 2026-09-12: bun workspace type-check could not start child processes in sandbox; rerun the same check with scoped escalation.
- 2026-09-12: IDE registry discovery hit sandbox spawn EPERM; reran the same read-only discovery with escalation.
- 2026-09-12: Electron is package-local rather than root node_modules; resolve its executable via createRequire(packages/electron/package.json). Node test runner also requires escalation for subprocess EPERM.
- 2026-09-12: Independent HMR used the default proxy port and fell back to bundled UI. Set OPENCHAMBER_PORT to the observed test backend port before HMR navigation. Electron smoke must attach app.whenReady().then rather than block initial module loading with top-level await; corrected smoke passed.
- 2026-09-12 QA: standalone Markdown components need SyncProvider in addition to runtime/theme/i18n providers. Test imports use unique module URLs after HMR reload. Preserve evaluation promises on window to avoid CDP Promise was collected.
- 2026-09-12: Two apply_patch attempts omitted a plus marker inside a multiline template; split the edit script and test hunk to apply successfully. No files changed in failed attempts.
- 2026-09-12: Get-CimInstance was denied in the restricted shell; scoped process inspection succeeded with escalation. An obsolete maximum-compression build was intentionally canceled before the final normal-compression package; only its own partial archive was removed.

- 2026-09-14 render audit: optional .codegraph and project-local stop-that-shit skill paths were absent; discover first and use plugin catalog path. PowerShell baseline download failed TLS authentication; Node fetch worked, but full source archive hit ENOSPC on H: temporary storage. Removed only this audit's partial v1.22.0.zip; use targeted raw source reads instead.
- 2026-09-15 chat restoration: default-sandbox debug build could not spawn the bundler; dead-code could not access Bun temporary storage. Retry the same build/check with scoped escalation. Reasoning test fixtures also needed a FilesAPI object for the existing file-menu wrapper; methods still reject unexpected I/O.
- 2026-09-15 visual verification: sandboxed Chrome did not expose its CDP endpoint; retry the same isolated browser fixture with scoped escalation.
- 2026-09-15 inspection: runtimeFetch is not under lib/api; discover the module with rg --files rather than assuming its path.
- 2026-09-15 visual fixture: CSSVariableGenerator.generate returns declarations, so wrap them in :root when inserting a standalone style element; otherwise theme colors fall back and assertions misreport the app.
- 2026-09-15 release: automatic approval rejected Git staging/commit because implementation plus release was not treated as explicit commit authorization and directory staging was considered potentially broad. No staging or commit was executed.
- 2026-09-15 stable promotion: Node test runner subprocesses hit sandbox spawn EPERM; rerun the same focused release/update-policy tests with scoped escalation.
- 2026-09-15 stable checks: personal-update-route.test.js uses Vitest, not node:test. Run it through the web package Vitest command; the two .mjs policy/publication files use Node.

## 2026-09-16 upstream fetch sandbox boundary
- 2026-09-20 diagram investigation: PowerShell does not expand wildcard path arguments passed to rg. Use an existing directory with rg -g filters. The guessed markdown/mermaid.ts and project-local stop-that-shit skill do not exist; discover files first and use the catalog skill path.
- 2026-09-21 diagram export QA: Playwright MCP's VM does not support dynamic Node imports (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING). Read the built module through the shell and pass its text into page.evaluate; browser-side module import and PNG validation succeed. beautiful-mermaid is installed under packages/ui/node_modules, not the workspace root.
- 2026-09-21 diagram fixture: imports from .codex-temp/diagrams-qa need two parent traversals to reach the repository root, not three; corrected fixture paths before rebuilding.
- 2026-09-21 fixture server: nested JavaScript/HTML quotes in node -e were split by PowerShell. Put the small server in a task-local .mjs file and execute that file instead.
- 2026-09-21 Mermaid settings tests: Vitest/esbuild startup failed with sandbox spawn EPERM. Retry only the same settings-helpers.test.js command with scoped escalation.
- 2026-09-21 settings suite: the existing packed-package test invokes execFileSync('npm') and fails with Windows ENOENT; the registry drift fixture also lacks the existing occupancy key. The new Mermaid style case passes; keep these unrelated failures distinct.
- Command: git fetch upstream main.
- Failure: cannot open .git/FETCH_HEAD: Permission denied; repository metadata is read-only in the task sandbox.
- Recovery: request narrowly scoped elevated execution for the same fetch and comparison command.

- 2026-09-21 performance investigation: Get-NetTCPConnection -State Listen was denied in the restricted shell while checking local endpoints. No process details or secrets were inspected; continue with known artifacts or use an approved scoped port-only fallback.
- 2026-09-21 performance investigation: inline Node CDP probe failed due PowerShell/JavaScript quote escaping before execution. Use a temporary script through apply_patch or encode the evaluated expression without nested quotes.
- 2026-09-21 performance investigation: isolated Chrome CDP probe could spawn Chrome but its debugging endpoint was unreachable from the restricted shell. Retry the same probe with scoped escalation if an actual browser trace is required.
- 2026-09-21 performance investigation: isolated OpenChamber service logged a non-Git working-directory error while probing an existing project (`git rev-parse --show-toplevel`); this was external project state and did not affect the OpenChamber source or trace.
- 2026-09-21 performance investigation: rg pattern used an unescaped JSX brace and failed to parse. Re-run each literal search separately or use fixed-string mode.
- 2026-09-21 sidebar refresh optimization: packages/ui type-check reached existing diagram localization errors in dirty parent files (`es.ts`, `pt-BR.ts`, `uk.ts`); focused helper test and oxlint passed.
- 2026-09-21 PlantUML preview integration: packages/ui type-check is blocked by concurrent parent PlantUML/diagram declarations and duplicate locale keys (`diagramEngines.ts`, `MarkdownRendererImpl.tsx`, multiple *.settings.ts`); no FilesView-specific type error was reported.
- 2026-09-21 workspace type-check: sandboxed Bun filter could not start subprocesses. Retry the same workspace type-check with scoped escalation.
- 2026-09-21 diagram dependencies: Bun add failed with AccessDenied accessing its temporary directory. Retry the exact user-authorized mermaid/@plantuml/core install with scoped escalation.
- 2026-09-21 diagram integration fixture: Vite config loading hit the same sandbox esbuild spawn EPERM; retry the same localhost-only fixture command with scoped escalation.
- 2026-09-21 diagram React fixture: the default OpenCode SDK entry pulled Node process code into the browser. Reuse the web package's explicit SDK client alias and browser defines in standalone fixtures.
- 2026-09-21 diagram fixture: SimpleMarkdownRenderer requires SyncProvider through useEffectiveDirectory. Supply the normal provider; isolated fixtures without a backend also produce expected API 404s, which are not renderer failures.
- 2026-09-21 diagram downloads: the Playwright MCP persistent page closed when downloads started. A separate browser context with acceptDownloads:true successfully saved all tested diagram files; use that isolated context for download acceptance.
- 2026-09-21 lockfile review: Node spawning git hit sandbox EPERM. Read git show directly through PowerShell into a task-local file instead. Frozen Bun installation also needs the same scoped temporary-directory access as Bun add.
- 2026-09-21 closure audit: broad popup SVG selectors also matched toolbar icons; scope diagram assertions to [data-markdown="mermaid"] > svg. Guessed Electron/VS Code paths were absent; rg --files located packaged-ui-protocol.mjs at the Electron package root and webviewHtml.ts under VS Code src.
- 2026-09-21 diagram interaction follow-up: guessed FilePreviewCommentMenu folder and wildcard path passed to rg did not exist/expand; discover exact paths with rg --files and search existing directories.
- 2026-09-21 diagram follow-up QA: switching Mermaid style replaces its DOM asynchronously; wait for original SVG identity to change before capturing a screenshot. A screenshot attempted during replacement detached and produced no file. Base UI package inspection must use the resolved node_modules/@base-ui/react path, not a wildcard store path.
- 2026-09-21 theme follow-up: optional theme/types.ts and Base UI internals/types.d.ts paths were absent. Inspect the existing local module imports or discovered package files instead of guessing type-file locations.
- 2026-09-21 3.5 release: the UI-only repack invoked package.mjs from the repository root, so electron-builder could not resolve the package-local Electron installation. Web asset staging completed. Re-run only packaging from packages/electron with the same explicit portable/x64/version/output arguments.
- 2026-09-22 版本核查：本地尚未获取 `v1.23.0-DIJIANG.3.5` 标签，`git show` 无法读取。改用 `gh release view` 核对发布目标，并检查已有的准确提交 `a81e9c665`；无需获取远端对象或修改分支。
- 2026-09-22 Astra migration planning: rg received the literal Windows path packages/*/package.json and reported OS error 123. Search an existing directory with -g package.json instead. packages/ui/README.md is absent; discover documentation with rg --files before reading. The web reader rejected the official migration Markdown URL with unsupported content-type; the official HTML model guide returned the migration section successfully.
- 2026-09-22 DIJIANG 3.7：补丁所猜测的 Markdown 锚点不存在，应用失败且未改动文件。应先核实上下文，再单独应用源码补丁。
- 2026-09-22 DIJIANG 3.7：猜测的 `small-model/auth.js`、`web/vitest.config.js` 和 CLI 生命周期通配路径均不存在。应先查找文件；实际位置分别为 `opencode/auth.js`、`web/vitest.config.ts` 和 `bin/lib/cli-lifecycle.js`。
- 2026-09-22 DIJIANG 3.7：通过 `npx` 指定 Bun 版本，未能让每个由 Node 启动的测试工作进程都使用该版本。两个 UI 测试进程用了全局 Bun 1.3.14，并卡在 `web-update.test.ts`。核实各自 PID、父 PID 和可执行文件路径后，只停止了这两个测试子进程。应仅在任务进程内将已定位的 Bun 1.4.2 目录置于 `PATH` 前端，不修改用户或全局 `PATH`。
- 2026-09-22 DIJIANG 3.7：`bun run -e` 只打印用法；内联执行应使用 `bun -e`。直接使用指定版本运行测试后，八个 Web 更新用例全部通过。
- 2026-09-24 DIJIANG 3.7：完整 Web 测试在受限 Windows shell 下无法启动 Node 测试工作进程（`spawn EPERM`）。应仅对同一测试命令使用限定范围的提权执行，并将 Bun 1.4.2 的目录限制在该进程的 `PATH` 中。
- 2026-09-24 DIJIANG 3.7：暂存已审查的跟踪文件清单时，Git 对 `packages/ui/src/components/sections/logs` 发出忽略路径警告，因为新的上游忽略规则命中了目录名。跟踪文件的改动实际已暂存；继续前用 `git status` 逐项核实，新文件则按准确路径添加。
- 2026-09-24 DIJIANG 3.7：在受限 shell 中用 `git checkout --theirs` 解决上游所属的 `changelog/unreleased.md` 冲突时，无法创建 `.git/index.lock`。应对原命令使用限定范围的提权执行；按仓库发布说明规则保留上游正文。
- 2026-09-24 DIJIANG 3.7：向 `rg` 传入字面路径 `packages/ui/src/lib/i18n/messages/*.ts` 时，Windows 将通配符判为非法路径。应直接搜索现有目录，或使用 `rg -g '*.ts'`，不要依赖 shell 展开该通配符。
- 2026-09-24 DIJIANG 3.7：从 `packages/ui` 使用 `../../../.codex-temp` 作为 UI 类型检查日志路径，会解析到仓库外；PowerShell 无法创建，因而该次退出结果不能算有效检查。应改用 `../../.codex-temp` 或工作区绝对路径并重跑。
- 2026-09-24 DIJIANG 3.7：自动审批拒绝了动态收集全部未暂存跟踪路径的 `git add` 命令。应先核对准确的改动路径，再以明确列出的文件逐项暂存，保留无关及未跟踪文件。
- 2026-09-24 DIJIANG 3.7：受限沙箱中的 `bunx vitest` 无法访问 Bun 临时目录（`EPERM`），工作区级 Bun 脚本也无法启动子进程。只对同一聚焦验证使用限定范围的提权执行，不修改全局 Bun 设置。
- 2026-09-24 DIJIANG 3.7：Node 原生 `--test` 起初在受限沙箱中无法启动；限定提权后又无法解析 VS Code 测试中的无扩展名 TypeScript 导入。应以该包的独立 Bun 测试命令为准，不能把原生 Node 尝试判作产品失败。
- 2026-09-24 DIJIANG 3.7：本机 VS2022 工具集缺少带 Spectre 缓解的库；Web 资源暂存及 OpenCode CLI 验证已成功，但 `node-pty` 原生重建仍以 MSB8040 失败。仅用于本地便携包验收时，备份已安装的 `node_modules` 绑定配置文件并移除其中的 Spectre 属性；打包后恢复。已提交源码及 GitHub CI 配置保持不变。
- 2026-09-24 DIJIANG 3.7：便携包构建期间，可选的 CIM 进程命令行查询返回“拒绝访问”。应改用构建日志、限定范围的进程状态和退出码，不再扩大进程检查范围。
- 2026-09-24 DIJIANG 3.7：首次便携包 CDP 探测遇到目标页面导航，第二次封装程序启动在解包前退出。应重试连接稳定的渲染进程，并分别检查封装程序启动与解包后应用运行；只停止任务隔离配置目录下的进程。
- 2026-09-24 DIJIANG 3.7：长时间 QA 探测无法保存截图，因为 H: 空间耗尽。首次便携运行留下了任务自己的 1.97 GB 解包目录；确认没有进程使用且解析后的路径位于 `.codex-temp` 内，才仅删除该目录。之后磁盘约有 2 GB 可用空间。避免在空间受限的工作区反复完整解包便携程序。
