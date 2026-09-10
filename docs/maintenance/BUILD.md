# Personal builds and update policy

## Version ownership

Workspace `package.json` versions continue to follow community releases. Edit `packages/web/personal-build.json` to increment the independent DIJIANG revision: `1`, `2`, `3`. It is a single positive integer. A community merge alone does not reset or increment it.

Example identity: `1.22.2-DIJIANG.1`. CI uses the same identity and records its run and attempt in `build-info.json`, without adding version levels. SemVer treats this as a prerelease identifier; the update checker compares only the community component. Build metadata records both versions and the CI source commit when available.

## Local Windows x64

Install the existing lockfile dependencies with `bun install --frozen-lockfile`, then run `bun run electron:build`. Print the next identity without building with `node scripts/build-personal.mjs --version`.

The script uses existing web asset staging, pinned OpenCode preparation/verification, Electron bundling, native module rebuild and `electron-builder`. It explicitly requests `portable`, Windows x64 and `--publish=never`. Output is under `packages/electron/dist/personal/<version>/`, with one `.exe` and `build-info.json`. NSIS installer packaging remains available through the package script with an explicit target; the default Windows target is portable.

Portable here means a standalone executable without an installation step. Electron user data/logs and OpenCode configuration still use their established AppData/home locations. Keep that data when replacing an executable. Full removable-drive data isolation is not implemented.

## Actions

`.github/workflows/personal-portable.yml` runs on pushes to `codex/personal` or manual dispatch. It uses the same local script, pinned action revisions, Node 22 and Bun 1.3.14. Permissions are read-only and outputs are uploaded as Actions artifacts with 30-day retention. It does not create GitHub releases, publish npm packages, upload updater manifests or commit version changes.

The community release workflow is gated to the community repository. Do not enable its publishing chain for personal packages. This task does not push or dispatch Actions. After the reviewed branch is pushed, inspect the actual run before accepting CI packaging.

## Notification-only behavior

`packages/web/personal-build.json` is the source of truth, with enforcement in `server/lib/personal-build.js`. Desktop checks only GitHub release metadata, using a bounded request timeout. A failed request remains an error. It never asks electron-updater to download metadata/artifacts or install an update in personal mode. Auto-download and auto-install-on-quit stay disabled.

Desktop download/install IPC and pending-install restart paths reject replacement. The Web update-install route returns 403 before invoking package-manager or process operations. CLI `update` rejects before discovering/stopping running instances. Direct package-manager execution is also guarded. The shared update dialog keeps release notes and the release link, and replaces install controls with a translated personal-build notice.

OpenCode's separate update functionality is outside this OpenChamber replacement policy; RUN-01 will define control of managed and external OpenCode processes. Manually running a package manager outside OpenChamber remains an explicit external action.

## Validation and handoff

Run the personal update tests, HTTP/CLI policy tests, workspace type/lint checks, dead-code inspection and the real packaging script. Check a packaged launch, version display, update notice and close, and verify bundled native modules/OpenCode. Record actual results in [PLAN.md](PLAN.md); a successful compile is not a packaged launch or a successful Actions run.

Replacement is manual: build from a reviewed integration, close the running app, keep the prior executable and data, then start the new executable. If startup regresses, close it and reopen the prior build. Review any future persisted-data migration before using an older binary on that data.
