# Personal builds and update policy

## Version ownership

Workspace `package.json` versions continue to follow community releases. The
independent personal revision lives in `packages/web/personal-build.json`, in
`featureVersion`, and always has two numeric levels: `feature.fix`.

- A new feature or a refactor increments `feature` and resets `fix` to zero.
- An optimization, bug fix or maintenance correction increments `fix`.
- A release containing both uses the feature increment.
- `feature` starts at one and `fix` starts at zero. Neither permits leading zeros.
- A community merge alone does not reset or increment the personal revision.

The previous `DIJIANG.1` is the historical baseline for `DIJIANG.1.0`. The first
fix release under this rule is `1.23.0-DIJIANG.1.1`. Further fixes become `1.2`,
`1.3`, and so on; the next feature or refactor release becomes `2.0`. Readers
continue accepting old single-level installed identities, but new builds use
two levels.

Example identity: `1.23.0-DIJIANG.1.1`. CI uses the same identity and records its run and attempt in `build-info.json`, without adding version levels. SemVer treats this as a prerelease identifier; the update checker compares only the community component. Build metadata records both versions and the CI source commit when available.

## Local Windows x64

Install the existing lockfile dependencies with `bun install --frozen-lockfile`, then run `bun run electron:build`. Print the next identity without building with `node scripts/build-personal.mjs --version`.

The script uses existing web asset staging, pinned OpenCode preparation/verification, Electron bundling, native module rebuild and `electron-builder`. It explicitly requests `portable`, Windows x64 and `--publish=never`. Output is under `packages/electron/dist/personal/<version>/`, with one `.exe` and `build-info.json`. NSIS installer packaging remains available through the package script with an explicit target; the default Windows target is portable.

Portable here means a standalone executable without an installation step. Electron user data/logs and OpenCode configuration still use their established AppData/home locations. Keep that data when replacing an executable. Full removable-drive data isolation is not implemented.

When asked to package and install locally, deploy the portable release executable
first. Use a versioned directory and a shortcut to that executable, retain the
previous build and existing user data, and verify the deployed launch. Use the
NSIS installation path only when the maintainer explicitly requests it. A normal
release has no `-DEBUG` suffix and keeps performance diagnostics disabled.

For a local diagnostic portable build, run `node scripts/build-personal.mjs --debug`.
It keeps the personal revision and appends `-DEBUG`, for example
`1.23.0-DIJIANG.1.1-DEBUG`. The debug desktop enables the existing server's
`/api/system/performance/debug` endpoint; ordinary desktop builds return 404.
CI keeps its normal build flags.

## Actions

`.github/workflows/personal-portable.yml` runs on pushes to `codex/personal` or
manual dispatch of that branch, only in `CastleYu/openchamber`. It uses the same
local build script, pinned actions, Node 22 and Bun 1.3.14. The build job has
read-only permissions and retains the portable EXE and metadata as Actions
artifacts for 30 days; unpacked application files are excluded.

A separate publish job has `contents: write`. `scripts/publish-personal.mjs`
checks the build version, source commit, architecture and notification-only
policy, creates a draft tagged `v<personal-version>`, and uploads the EXE,
`build-info.json`, complete `update-history.md` and `SHA256SUMS.txt`. It checks
GitHub's size and SHA-256 for every attachment before publishing. Release text
comes from `changelog/unreleased.md` at the same source commit.

Published versions are skipped on later pushes. A failed draft can be retried
only from its original source commit. Draft/tag conflicts require a deliberate
version increment; failed upload or digest verification leaves a draft. No npm
package, updater manifest or version-changing commit is produced.

The community release workflow stays gated to the community repository. After
an authorized push, inspect both personal jobs and the public release assets;
a successful push or build alone does not establish publication.

## Notification-only behavior

`packages/web/personal-build.json` is the source of truth, with enforcement in `server/lib/personal-build.js`. Desktop checks only GitHub release metadata, using a bounded request timeout. A failed request remains an error. It never asks electron-updater to download metadata/artifacts or install an update in personal mode. Auto-download and auto-install-on-quit stay disabled.

Desktop download/install IPC and pending-install restart paths reject replacement. The Web update-install route returns 403 before invoking package-manager or process operations. CLI `update` rejects before discovering/stopping running instances. Direct package-manager execution is also guarded. The shared update dialog keeps release notes and the release link, and replaces install controls with a translated personal-build notice.

OpenCode's separate update functionality is outside this OpenChamber replacement policy; RUN-01 will define control of managed and external OpenCode processes. Manually running a package manager outside OpenChamber remains an explicit external action.

## Validation and handoff

Run the personal update tests, HTTP/CLI policy tests, workspace type/lint checks, dead-code inspection and the real packaging script. Check a packaged launch, version display, update notice and close, and verify bundled native modules/OpenCode. Record actual results in [PLAN.md](PLAN.md); a successful compile is not a packaged launch or a successful Actions run.

Replacement is manual: build from a reviewed integration, close the running app, keep the prior executable and data, then start the new executable. If startup regresses, close it and reopen the prior build. Review any future persisted-data migration before using an older binary on that data.
