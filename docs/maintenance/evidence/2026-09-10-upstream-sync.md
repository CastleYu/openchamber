# Upstream integration, 2026-09-10

## Commits and scope

- Initial personal tip: `14b070050fdd58e7d710f785ccdaa648501169db`.
- Performance panel: `7e40d3f8`.
- Single-integer DIJIANG revision: `88371889e38ed7ac270780f55dc0e0df27ac06c5`, the integration base.
- Fetched `upstream/main` on 2026-09-10: `d073858dc231c91eaa0236a69547b6a50a8bd15c`, release v1.23.0, 92 incoming commits.
- Validated merge: `c971fa700c7e4c43b00cc364604481a2bc822088`. Both the integration base and pinned upstream are verified ancestors.
- Origin is `https://github.com/CastleYu/openchamber.git`; upstream is `https://github.com/openchamber/openchamber.git`. Origin's personal branch had no missing commits at fetch time.
- Backup: `codex/backup-sync-20260910-1338`. Integration worktree: `.worktrees/sync-20260910-1338`, branch `codex/sync-20260910-1338`.

Only performance-panel changes and DIJIANG version changes were committed from the original dirty checkout. Git monitoring, occupancy, walkthrough, existing Turkish edits and temporary files remain separate user work. Shared dictionaries were staged by feature, not wholesale.

## Conflict decisions

Resolved 25 conflicted files. Dictionary additions from both sides remain; send-shortcut translations follow the new upstream behavior. Visual-setting types retain personal entries and upstream scrollbars. Config loading uses upstream's parsed settings loader while retaining desktop demand-scoped prewarming. Bootstrap fixtures retain personal project-enumeration guards and upstream question tests.

The upstream desktop-host update route now reaches the native updater, but personal checks still return `notifyOnly` and HTTP install returns 403 before native callbacks. IPC install and pending-install restart remain guarded. New native-route tests assert those denials. Desktop version parsing now accepts packaged `DIJIANG.<integer>` identities without applying the suffix twice. The resulting identity is `1.23.0-DIJIANG.1`.

Turkish stale integration references and duplicate keys were repaired. The prewarm fixture now supplies the real settings-loader and session-storage exports. One upstream trailing blank line was removed to pass staged whitespace checking. Upstream SDK 1.18.30, lockfile changes and release files were retained; no personal release notes or publishing changes were authored.

## Validation

- `bun install --frozen-lockfile` passed in isolation.
- Workspace `bun run type-check` passed for all workspaces.
- Focused Oxlint passed for the monitor and personal identity modules/tests. `bun run dead-code` completed; its existing export/type inventory and temporary smoke-file reports were inspected.
- Collector: 2 tests passed. Personal version/update policy: 6 tests passed. Config prewarm: 3 tests passed.
- Isolated sync, relay-client and Electron tests: 86/88 files passed. The two failures are `issue-1637-2270.test.ts` and `issue-2039.test.ts`; the same 5 failing cases per file reproduce on a clean checkout of the pinned upstream. Their test and runtime source files are identical to upstream.
- Isolated sidebar and hook tests: 45/45 files passed.
- Web updates, package-manager, settings, relay-host and Git tests: 242 passed, 16 failed, 1 skipped across 16 files. All 15 Git failures reproduce by name on clean upstream, including Windows paths, CRLF, shell-hook and quoting assumptions. The remaining npm-pack test reproduces `spawnSync npm ENOENT` on clean upstream. The 14 other files passed, including the updated desktop-host policy assertions.
- Workspace lint has the pre-existing unused `currentFilePath` error in `LogsPage.tsx:119`; that file is unchanged from the personal base. Other workspaces passed.
- Staged whitespace check passed and no unresolved merge entries remain.

Raw logs are local to the integration worktree (`sync-*.log`). Clean-upstream reproductions are in `.worktrees/upstream-check-20260910`.

## Native evidence and limits

Web production assets, OpenCode CLI 1.18.30 staging/verification and Electron main bundling passed. Full portable packaging stopped at native rebuild with MSB8040: this machine lacks the Visual Studio Spectre libraries. No successful final executable is claimed.

An isolated Electron process using the built resources loaded `openchamber-ui://app/index.html`, returned `1.23.0-DIJIANG.1`, rejected direct installation, and displayed the real process-performance panel. The HMR native bridge independently returned the same version, installation rejection and HTTP 200 metrics. HMR component-mount waiting was interrupted by reloads; complete panel interaction is evidenced by bundled UI, not that HMR run.

Artifacts: `.worktrees/sync-20260910-1338/sync-native-profile/{result.json,panel.png}` and `sync-hmr-profile/result.json`. The tests used an unavailable external OpenCode endpoint, so this is shell and process-monitor validation, not an agent conversation or MCP workload. Test instances and the task's Vite server were closed.

## Promotion and publication

The personal branch was confirmed at the integration base and fast-forwarded. Remaining work was preserved in stash `9dc433b38335dbe14db7256cb74a951a438a3f08`, which remains available alongside the older stash and backup branch. The snapshot covered 56 modified tracked files and 24 untracked files.

Restoration required 12 conflict resolutions. The unrelated occupancy field moved into upstream's settings registry, including its parser, live-store binding and both generated snapshots. Git prefetch retains policy gating/configurable capacity and upstream's timed-out-request accounting. Walkthrough retains commit comparisons and separate load/generation cancellation. Those adaptations remain uncommitted in the original checkout; they are not part of the published integration.

All 24 untracked files match their original SHA-256 hashes. All 7 modified tracked files untouched by upstream match the saved content after newline normalization. Shared changed files were merged with upstream; the original copies remain in the exact stash. No conflict entries or staged files remain. `git diff --check` passed. Restored-work validation: workspace type-check passed; Git store 43 tests, walkthrough store 17 tests, registry 10 tests and four backend-policy files with 19 tests passed. Registry Oxlint still reports its upstream unknown-parameter contracts at lines 110 and 609; the added occupancy parser and test have no new finding.

Automatic approval rejected an initial batch restoration script. It was not executed. Recovery proceeded through individual reviewed patches; the three retired settings definitions were restored only after documenting their entire occupancy-only delta and moving that behavior into the new registry.

The user authorized pushing only `codex/personal` to `origin`. Its existing workflow creates portable artifacts on push; a push does not prove the workflow passed. Do not publish to upstream, force-push, or change the branch's existing upstream tracking.
