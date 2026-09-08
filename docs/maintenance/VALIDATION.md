# Delivery validation, 2026-09-08

Scope: BR-01, REL-01 and REL-02. Independent release review remains pending. Source changes for performance, platform adapters, explicit OpenCode modes, logging enhancements and multiple screens/tabs are planned rather than implemented in this delivery.

## Branch evidence

Integration commit `a93285bf` merges community `cab07805` into the personal history. Both `upstream/main` and `codex/backup-feature-20260907` were verified as ancestors. The personal branch tracks `upstream/main`, uses `origin` as its push remote, and repository-local `pull.ff=only` prevents an implicit pull merge. The original three dirty files and `Temp/` were preserved, with the named stash retained.

## Passing checks

- Workspace `bun run type-check`: all workspaces passed. UI type-check was repeated after the final About dialog change.
- Focused ESLint for `AboutDialog.tsx`, `AboutSettings.tsx`, `UpdateDialog.tsx`, `desktop.ts` and `useUpdateStore.ts` passed.
- Oxlint for the new build script, personal metadata/policy module, release checker and new test files passed.
- `node packages/electron/personal-updates.test.mjs`: 5 tests passed. Covers personal/CI versions, same/newer community releases, HTTP/metadata failure, runtime install denial and desktop update wiring.
- Web update route, personal update route, CLI command and package-manager tests: 19 tests passed across 4 files.
- Existing log route/runtime tests: 20 tests passed across 2 files.
- Seven personal UI regression files passed, with 75 tests covering bootstrap demand filtering, directory/worktree eligibility, mounted/unmounted tray polling, global polling lifecycle and MCP failure hints.
- `git diff --check` passed. Maintenance document relative links and personal workflow YAML parsed successfully.
- `bun run dead-code` completed and was inspected. It reports an existing broad export/type backlog; the new personal build/policy modules were not reported.

## Build and runtime

`bun install --frozen-lockfile` reconciled the installed SDK with the merged lockfile. The complete `bun run electron:build` pipeline produced `packages/electron/dist/personal/1.22.2-personal.0.1.0/OpenChamber-1.22.2-personal.0.1.0-win-x64.exe` and `build-info.json`. Web assets, pinned OpenCode verification, main bundling and native rebuild succeeded. Windows signing credentials were absent, so the build is unsigned.

The final portable executable was launched with an isolated profile and a dedicated debugging port. It loaded `openchamber-ui://app/index.html`, returned `1.22.2-personal.0.1.0` through the desktop bridge, visibly displayed that version in the About dialog, and rejected direct `desktop_download_and_install_update` invocation. The test uses an intentionally unavailable external OpenCode endpoint; this verifies the shell/update boundary, not a real agent conversation. Runtime artifacts are under `artifacts/personal-smoke/`, including `result.json`, `packaged.png` and `about.png`. The final executable is 154,233,602 bytes.

The source Electron runtime also loaded through Vite HMR and returned the personal version/update denial. The full-app update-dialog fixture did not complete reliably across HMR reloads. The actual `UpdateDialog` was then rendered through an isolated Vite browser fixture with synthetic release metadata. Playwright verified the Chinese personal-build notice and found only the Close button in the dialog, with no download/install button. Screenshot: `artifacts/personal-dev/update-notice.png`. Unconfigured background API requests in that fixture are not a server-integration pass.

## Known validation gaps

- Full workspace lint reports one error in the existing Logs page: unused `currentFilePath` at line 119. It also reports an existing hook-dependency warning in `MobileChangesSurface.tsx`. This delivery does not modify those implementations.
- `useConfigStore.prewarm.test.ts` fails before executing tests because its storage module mock omits `getSafeSessionStorage`. The test and storage module are unchanged by this upstream merge; the missing mock contract needs repair in QA-02. This does not establish that the runtime prewarm behavior regressed, nor does it validate that behavior.
- No remote push, Actions dispatch, release publication, macOS/Linux packaging, full active-session acceptance or measured performance improvement is claimed.
- The personal CI workflow has been syntax/policy inspected, not run on a GitHub runner. After publication of the reviewed branch, QA-01 must inspect its actual artifact and run results.
- The portable executable does not isolate all user data onto a removable drive. Existing AppData/home configuration locations remain in use.

## Review handoff

Review the code diff and these artifacts, then mark BR-01/REL-01/REL-02 accepted or request concrete changes in [PLAN.md](PLAN.md). Keep the previous executable, branch backup and user-edit stash until the personal feature checklist is accepted. Do not replace a failure with an empty successful result or waive a runtime boundary because static checks passed.
