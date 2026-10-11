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

- 2026-10-11 session-knowledge owner lease: `bunx vitest run server/lib/session-knowledge/runtime.test.js` cannot transform this existing `bun:test` test file; use `bun test server/lib/session-knowledge/runtime.test.js`. An initial Bun test exposed a syntax typo in the new fixture, which was corrected before the regression run. Scoped oxlint reports existing anti-slop findings at runtime.js lines 24, 129, 161, 213, 235 and runtime.test.js lines 30-31; none is in the new code.

- 2026-10-11 R2 write verification: the controlled model probe incorrectly awaited a fixed success response after rejecting a question and timed out. Verify authoritative pending-request retirement and the question tool error instead, then explicitly stop that probe session. The isolated process/home were removed. A previous source discovery searched a nonexistent config-settings/config-settings.js; discover module paths before reading.

- 2026-10-11 R2 anti-slop: authored conditional empty-object spreads in Legacy update triggered three diagnostics. Replaced them with explicit property assignments; rerun the changed-source check.

- 2026-10-11 R2 transport verification: the exact transport probe requires an explicit fixture-root argument; the initial invocation omitted it and failed before starting a process. Pass artifacts/legacy-1.2.27. Source discovery must use rg -g '*runtime.js' against a directory on Windows rather than a positional wildcard. Vitest esbuild spawn EPERM requires scoped escalation for the same focused command; use the confirmed package executable path.

- 2026-10-11 R2 verification follow-up: baseline oxlint copies under ignored artifacts produced "No files found"; use temporary sibling source copies and remove them after checking. Do not interpret an empty scan as a clean baseline. Optional CIM process inspection was denied; use the existing exec session handle. Discover lint config paths rather than assuming .oxlintrc.json.

- 2026-10-11 R2 UI discovery: positional wildcard paths in rg fail with Windows os error 123; use an existing directory and -g filters. The UI package has no root README; enumerate docs before reads. These discovery failures did not run or modify product code.

- 2026-10-11 R2 HTTP test setup: PowerShell braced path syntax failed parsing; an outer wrapper expanded $LASTEXITCODE and emitted -ne; report inspection used the package cwd instead of the repository root. Use direct exec_command with explicit repository workdir, a single PowerShell layer, and individually listed test paths. The final focused rerun passed. The UI package has no root README; use rg --files before reading package documentation.

- 2026-10-11 R2 UI-host contract setup: default sandbox denied writing the test log into dijiang-next; reran the unchanged test using scoped escalation for that execution worktree. New cross-workspace HTTP test uses Bun JavaScript because server proxy modules have no TypeScript declarations, avoiding type assertions or compiler suppression.

### 2026-10-11: context verification path discovery

Reading an assumed UI type-log filename and `packages/ui/README.md` failed because those paths do not exist. Enumerate artifact/document paths before reading. The real type log is `artifacts/int03-conversation-ui-types.log`; the UI package has no root README. No source was changed by these failed reads.

### 2026-10-11: integration discovery wildcard

A positional `connection*.js` path was rejected by Windows rg with error 123. Re-ran using the existing directory and `-g` filters. No source was changed by the failed search.

### 2026-10-11: browser fixture preparation

The first fixture observer subscribed the project directory while the UI used its no-project chat directory. The generated helper also used `host.close` instead of the exported `host.stop({ exitProcess: false })`. Corrected the helper and stopped only its verified parent/upstream PIDs before restarting. A browser click timed out after its target disappeared on navigation; refresh the DOM controls after a route change.

### 2026-10-11: VS Code contract runner sandbox

Subagent Bun/Node focused test launches against dijiang-next failed before executing tests with EPERM under the default sandbox. Main reran the exact scoped tests with require_escalated in the authorized execution checkout. These startup failures are not product test failures.


### 2026-10-11: isolated runner and browser controls

Node --test could not resolve extensionless imports in four TypeScript VS Code suites. The repository runner sends all TypeScript files to Bun; rerunning these four with Bun passes 14 tests. Two unchanged JavaScript suites pass nine tests. A positional OpenCode* search failed on Windows; enumerate with rg --files and -g instead. A question choice changes Next to Submit, so query the current controls after choosing. The held model fixture exposes Stop generating while its partial text is not yet committed; assert authoritative busy/idle and abort state rather than waiting for a text fragment. These observation/runner failures do not establish product failures.

### 2026-10-11: fixture cleanup junctions

Initial cleanup correctly refused six Bun cache junctions. Verified every junction and target remained within its named task-owned fixture root, removed only the links with Directory.Delete(path, false), rechecked for reparse points, then deleted the two exited roots. Process and port absence were checked before deletion.

### 2026-10-12: inspection checkout and paths

A search guessed a nonexistent UI legacy/sessions.ts path. Enumerate existing adapter files with rg --files before reading. Two check-log reads used the cdee helper checkout instead of the dijiang-next execution checkout. The actual checks completed successfully; use explicit execution-root paths for logs. A literal helper edit stopped on CRLF versus LF after three completed replacements. Normalized line endings and made the remaining replacements resumable before continuing. These inspection/helper failures do not establish product failures.

The resumed helper matched an already extended parameter prefix and duplicated onHeldClose, producing a test parse error. Removed that duplicate and reran the reviewed tests. Do not resume substring replacements whose replacement contains their original anchor.

The strengthened abort case confirmed that Bun settles the bridge request with 502 but does not emit upstream socket close within the five-second test. Added a native Node runtime check for VS Code socket cancellation instead of treating Bun socket behavior as product evidence.

A declaration-file read also guessed legacy-session-http.d.ts, which does not exist. Use the new legacy-session-api.d.ts and enumerate declarations before future reads.

### 2026-10-12: native Legacy fixture selectors

A positional ChatInput* wildcard and a guessed src/locales directory failed during inspection. Enumerate with rg --files and pass -g to an existing directory. The first real VS Code journey reached the permission card after successful text and attachment turns, but its exact Allow once button matcher missed the rendered Allow Once plus shortcut text. Match the observed case-insensitive label prefix. This locator timeout is not a product failure; retain its failed evidence separately before rerunning.

The second native journey completed permission, question and stop checks. Its deliberate unsupported fork probe rejected fetch with the explicit Legacy admission error rather than returning an HTTP Response. Assert that named bridge refusal as an accepted outcome; unrelated fetch failures still fail the probe.

Calling location.reload inside the VS Code test webview produced no second test result and the fixture reached its 240-second deadline. The IDE and upstream were observed live before waiting on the same process to finish. Replace that fixture navigation with actual panel disposal and provider.createOrShow(sessionID), then verify a fresh production webview restores history and sends another turn.

### 2026-10-12: R2 current-profile and Relay fixtures

The current-profile fixtures initially omitted confirmed external settings; production startup correctly refused them. Persist the isolated confirmed external record before composing the host. Current OC1 1.18.33 uses profile oc1, not the exact Legacy profile. A Node fixture initially checked exitCode only after kill; signalCode also establishes terminal completion, and independent process inspection confirmed absence. Its first failed shutdown also emitted UV_HANDLE_CLOSING; subsequent successful runs did not reproduce it.

Resolve ws from the owning Web package and esbuild from the existing VS Code dependency. Windows generated/dynamic ESM imports need file URLs; a resolved CommonJS ws index supplies its default export. The local Layer-1 broker must assign a connection ID for the production client; the old scripted fixture supplied its own. The first handshake deadline ended that fixture before retry. Legacy SDK calls through the Web/Relay host require its /api base prefix; a root /session path was correctly refused by the tunnel allowlist. None required a dependency or transport change.

A guessed managed-config-v2.js path did not exist; use enumerated managed-config-file.js and config-v2.js. The document-context inspection also included nonexistent .codex/root DEV-PLAN paths; the real plan is docs/maintenance/DEV-PLAN.md. A sandbox process-use inventory returned access denied; the same targeted read succeeded with escalation before cleanup. The routing focused Vitest first hit esbuild spawn EPERM in the sandbox; its exact targeted escalation passed. An agent initially guessed session-work/index.js; consumers are in server/index.js and session-work/runtime.js.

- 2026-10-12 context recheck: a timestamp read assumed DEV-PLAN.md was at the checkout root and returned path-not-found. Discovery with rg --files confirmed docs/maintenance/DEV-PLAN.md. Subsequent reads used the discovered path.

## R3 advanced-operation validation, 2026-10-12

- A pre-existing Legacy read test assumed a fixed order for concurrent catalog requests. The first run reported 159 pass / 1 fail; compare the complete request set rather than completion order. The corrected five-file suite passes all 160 tests.
- The exact-host driver initially used the synchronous prompt endpoint, which is intentionally outside the admitted UI contract. Use prompt_async and wait for an authoritative completed assistant message.
- File search initially missed a file created after instance initialization. Create known files before startup and request type=file explicitly; the exact host journey then passes. This is a fixture correction, not a new product fallback.
- Selectively retained upstream sources do not include server/routes/find.ts. Inspect the retained OpenAPI and discover available paths instead of assuming a full source checkout. The helper checkout also lacks docs/maintenance; documentation lives in the dijiang-next execution checkout.

- Sandbox CIM inventory returned access denied. Repeat the same scoped inventory with escalation; never interpret a failed inventory as an empty process list. Exclude the inventory process itself because its command contains fixture paths.
- Cleanup stopped on Bun cache links before deleting fixtures. Inventory links without traversal, unlink each link itself, then remove only checked task-owned roots. The final receipt records six removed fixture homes and all link-only actions.

### 2026-10-12: R3 recovery inspection and test environment

- An inspection guessed a nonexistent `packages/ui/src/lib/opencode/v1/operations.ts`; actual files are `sessions.ts` and `projection.ts`. Discover paths with `rg --files` before reading.
- The first blocking-resync test lacked browser `requestAnimationFrame`, used by toast dismissal. Added a test-local animation-frame implementation, restored after the suite, then reproduced the actual two stale-nonempty failures. Logs: `artifacts/int04-blocking-resync-before.log` and `artifacts/int04-blocking-resync-red.log`.
- Initial Node Vitest path `node_modules/vitest/vitest.mjs` was absent in this checkout; Node exited 1 with MODULE_NOT_FOUND. The original output is preserved in `artifacts/int04-web-initial-runner-path-failure.log`. Correct installed entrypoint: `packages/web/node_modules/vitest/vitest.mjs`.
- Reading the anti-slop log before its sequential job started returned path-not-found. Wait for the active validation runner before reading generated logs.
- Initial source read used the cdee checkout for `artifacts/legacy-1.2.27`; the fixture is in dijiang-next. Future reads use the actual repo path.
- Initial probe SDK resolution from the helper directory failed because the helper checkout has no installed SDK. A CommonJS `createRequire` attempt failed because the SDK exports only ESM. The helper now imports the installed SDK entry directly from the actual repo.
- First live wire attempt used a non-existent `probe` command and OC1 returned `UnknownError` because `Command.get()` returned undefined. The probe now enumerates `command.list` and invokes a command returned by the exact server.
- The first anti-slop baseline was placed under ignored `artifacts`, so its zero diagnostics were not a measurement. Repeated the check using a temporary sibling TSX in the same owning directory; removed it in `finally`.
- A second exact-source inspection requested absent `permission/next.ts` and `question/index.ts` after listing showed only selective routes/tool files. The snapshot omits these internals; use the existing route files and executable evidence, and retain that source limitation.
- Recovery closeout: sandboxed `Get-CimInstance Win32_Process` returned access denied. Process-use verification for task-owned fixture cleanup requires the same narrowly elevated read; do not interpret denied inventory as no running process. A guessed package UI README path was also absent; subsequent discovery confirmed the package has no root README.
- Probe review found continuation checks could match a previous completed assistant. The final successful run captures message IDs before each prompt, requires a new completed assistant, and verifies the original pending tool part completed after reply. The explicit post-restart turn also records exclusion of every prior message ID. Earlier weaker assertions are not final acceptance evidence.

- 2026-10-12T01:33:10.5866814+08:00: Initial source listing used the current cdee worktree-relative path; the legacy source tree exists only under the specified dijiang-next target. No target files were modified by the failed read.
- 2026-10-12T01:33:27.0261863+08:00: OpenCode 1.2.27 sources place permission state under permission/next.ts, not permission/; initial lookup used stale directory name. No source writes.
- 2026-10-12T01:33:36.7924241+08:00: PermissionNext and Question module imports exist in the source snapshot but their expected source files are omitted; inspected routes/tool only. Need locate companion files or declare source coverage limitation.
- 2026-10-12T01:34:46.0331794+08:00: Attempt to append the required failed-patch note was denied by sandbox; retrying exact approved target write with elevation. Driver file remains unchanged.

- 2026-10-11T17:35:38.265Z: TypeError: Cannot read properties of undefined (reading 'address')
    at newClient (file:///C:/Users/74756/.codex/worktrees/cdee/openchamber/artifacts/r3-host-recovery.mjs:52:67)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async startOpenCode (file:///C:/Users/74756/.codex/worktrees/cdee/openchamber/artifacts/r3-host-recovery.mjs:64:12)
    at async file:///C:/Users/74756/.codex/worktrees/cdee/openchamber/artifacts/r3-host-recovery.mjs:128:18; checks=; fixture=C:/Users/74756/.codex/worktrees/dijiang-next/openchamber/artifacts/int04-host-recovery-AJhbTb

- 2026-10-11T17:38:55.461Z: AssertionError [ERR_ASSERTION]: permission model tool did not expose a pending/running message part
    at file:///C:/Users/74756/.codex/worktrees/cdee/openchamber/artifacts/r3-host-recovery.mjs:169:12
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5); checks=exact 1.2.27 plus production proxy/session owners and isolated auth gate; fixture=C:/Users/74756/.codex/worktrees/dijiang-next/openchamber/artifacts/int04-host-recovery-h2CUMd

- 2026-10-11T17:39:32.009Z: AssertionError [ERR_ASSERTION]: permission model tool did not expose a pending/running message part; observed=[{"id":"prt_12c0c6252001JODqNMBkN9WOZW","type":"text"}]
    at file:///C:/Users/74756/.codex/worktrees/cdee/openchamber/artifacts/r3-host-recovery.mjs:171:12
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5); checks=exact 1.2.27 plus production proxy/session owners and isolated auth gate; fixture=C:/Users/74756/.codex/worktrees/dijiang-next/openchamber/artifacts/int04-host-recovery-sFVliR
- Recovery checkpoint commit preflight rejected an extra blank line at EOF in this failure log after merging the probe notes. Normalized the final newline, preserved the failure, and reran diff validation before staging. No commit was created by the failed attempt.


## 2026-10-12 R3 recovery investigation

- 2026-10-12: Reading `packages/ui/src/sync/interrupted-turn-tools.test.js` failed because the guessed path does not exist. Discover the actual test path with `rg --files` before the next read. No product behavior was exercised by this failure.
- The same read batch also referenced nonexistent `reconnect-session-status.test.js`; the discovered owner is `reconnect-recovery.test.ts`. Use only the discovered test paths below.
- A later transport search referenced nonexistent `sync/pipeline.ts` and `vscode/src/opencodeManager.ts`. Use the discovered `sync/event-pipeline.ts` and `vscode/src/opencode.ts` owners instead of guessed filenames.
- Further guessed paths `vscode/src/bridge/`, `lib/opencode/sync-source.ts` and `sync/reducers.ts` were absent; discovered owners are `bridge.ts`, `sync/source.ts` and `sync/event-reducer.ts`. Discover before reading.
- Read of `int04-bootstrap-vscode-build.log` before its build phase started failed. Check file existence or the live build handle before reading phase output. A later suppressed lookup of the not-yet-created build receipt returned exit 1; this was not a build failure.
- R3 Web build failed in esbuild: VirtualAlloc errno=1455, fatal out of memory; VS Code build completed independently. Retry Web alone with process-local GOMEMLIMIT=512MiB and GOMAXPROCS=2. No dependencies, paging configuration or toolchain installation changed. Default-sandbox CIM process query was denied; the same read-only query succeeded with narrow escalation.
- Native recovery fixture submitted before configured model hydration, selecting the default free provider; no restart acceptance was exercised. Restrict enabled_providers to the controlled loopback provider and wait for its composer model label. Probe review also corrected API snapshot prefixes, retained-ID subset assertions, and a false requirement that persisted upstream running tools must be rewritten by local UI reconciliation.

## 2026-10-12 R3 native recovery probe notes

- A guessed `ChatInputControls.tsx` selector path was absent; the inventory identified `ModelControls.tsx`. The build-log readiness read also preceded the VS Code build phase. These were inspection/probe setup issues.
- The first Web build hit Windows `VirtualAlloc` errno 1455 and ran out of memory. The isolated constrained retry passed; the VS Code build completed. No native UI recovery conclusion follows from those builds.
- Early native recovery probes stopped on editor selection, composer controls, restart acknowledgement, and controlled-model hydration checks. The latest recorded probe still did not establish model hydration, so native restart recovery and production UI acceptance remain open.
- 2026-10-12 Astra readonly recovery consultation: rg with Windows path globs failed with os error 123. Directory search with -g succeeded; no source was modified by the consultation.

- A targeted rg read guessed `ChatInputControls.tsx`, which does not exist. The preceding file inventory identifies `ModelControls.tsx`; use inventoried paths for follow-up reads. No product failure or source change resulted.

- Subsequent searches guessed a top-level `interrupted-turn-tools.ts` and a `__tests__/blocking-request-resync.test.ts` path. The implementation is in `sync-context.tsx`; the interruption test is `__tests__/interrupted-turn-tools.test.ts`. Use `rg --files` across the sync directory before narrowing test paths.

- Cleanup initially retained all directories because their isolated Bun caches contain junctions. Inspection confirmed internal junction destinations. The first boundary validation retry indexed a scalar Target string as a character and stopped before deletion. Normalize Target to an array before indexing, verify all destinations remain within each fixture, then unlink each junction non-recursively.

- Native fixture gwOKAo exited before producing evidence.json: actual VS Code ide.log reports renderer process gone reason=oom, code=-536870904 while Web build was concurrent. Missing evidence is an environment failure, not a product verdict. Wait for build completion and verify available memory before rerunning the native probe serially; fixture finally stopped its owned upstream/model processes.

- A targeted read guessed packages/vscode/webview/VSCodeApp.tsx and failed because that path does not exist. Discover the owning app with rg --files before reading; no source changed.

- R3 native recovery FCun7x still failed after reconnect ordering was corrected. Astra consultation and source inspection identified server.connected bootstrap replacing busy with an empty status map without interruption reconciliation. The final correction reuses successful status coverage and reconciles on each OC1 recovery commit. Two newly added ordering regressions failed before the correction and passed after it. Final actual-host evidence: artifacts/int04-bootstrap-settle-native-evidence.json.

- 2026-10-12: A read-only search guessed packages/web/server/lib/opencode/kernel-policy.js, which does not exist, and rg returned os error 2. No source changed. Locate policy ownership with rg --files and the existing compatibility/legacy-contract modules before future reads.
- 2026-10-12: Two reads attempted the OC2 evidence file while its confirmed runner was still live, before the report existed. Use the live session handle and log until termination, then inspect its report. No runner was restarted on the basis of the missing report.
- 2026-10-12: OC2 recovery probe falsely required the final history record to be an assistant. Read-only inspection of its isolated database proved the explicit user turn and completed assistant, followed by OC2's persisted idle record. Corrected the probe to require the completed assistant after the specific new user record and exact completion text. Product source was unchanged. Preserve the failed report and diagnostic separately before rerunning.

﻿- Runner attempt failed before producing usable results: Windows PowerShell treated Bun stderr as NativeCommandError under ErrorActionPreference=Stop. No source files were edited; rerunning with redirected Process streams.
- Test runs exited 1 for all four files: Bun reported EPERM reading the actual repo at C:\Users\74756\.codex\worktrees\dijiang-next\openchamber (test file, repo root, and tsconfig paths). This is an environment sandbox access failure; no tests could execute. Results/logs were saved, and tests were not retried.

- 2026-10-12: Two evidence/log reads used the wrong worktree-relative artifacts directory. Product evidence belongs to dijiang-next; driver logs belong to cdee. Use explicit absolute roots for mixed-worktree reads. No test or product source was affected.

### 2026-10-12 INT-05 MCP tranche

- Read-only research guessed missing legacy-request.js, runtime-client.ts, retained config/config.ts, client.oc1.test.ts and UI README/DOCUMENTATION paths; literal Windows wildcard paths also failed. No source changed. Use rg --files and rg -g against existing directories. Mixed-worktree test reads must use the actual product root.
- Main review removed a child-agent guard that wrongly refused current OC1 MCP operations and removed unused facade declarations. Regression tests now retain current OC1 and reject wrong generations.
- New UI transport tests initially reused a consumed Response and assumed one directory carrier for every method. Fresh responses and actual SDK GET query / POST encoded-header assertions pass.
- Parallel workspace lint exhausted memory in VS Code with exit 134. Other packages passed; isolated VS Code lint then passed. Full workspace type checking passed.

# INT05 MCP edit failures

- 2026-10-12: PowerShell parser rejected an edit script because a here-string header was followed by literal escape text on the same line. No file writes from that command occurred; split future edits into simpler PowerShell literals or use the patch tool.
- 2026-10-12: Bun focused tests from the actual checkout failed before collection with EPERM reading both test files and package tsconfigs. This is a sandbox access issue; rerun the same command with narrowly scoped elevated access.
- 2026-10-12: First elevated focused test run collected 106 tests and found two assertion failures: the operation list expectation omitted the three new MCP constants, and the binding still allowed MCP operations outside the Legacy profile. Both are in-scope implementation/test issues and are being corrected.
- 2026-10-12: A follow-up PowerShell replacement found the operation-list change but its multiline runtime guard anchor did not match the file's line endings. The test-list write completed before the guard check; inspect the runtime lines and apply the guard separately.
