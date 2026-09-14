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
