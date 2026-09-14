# DIJIANG 1.2 performance and portable release

## Scope

This release addresses directory-driven MCP multiplication, Windows connection
cleanup, and oversized debug responses. It advances `featureVersion` from `1.1`
to `1.2`. User configuration files and existing running instances were preserved.
No dependency was added, and no Git or GitHub mutation was performed.

## Changes

- Directory bootstrap no longer reads MCP status or commands. OpenCode command
  discovery also initializes MCP through [prompt discovery](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/command/index.ts#L96). Foreground feature
  stores still own command and MCP loading; session, permission and question
  synchronization remain active.
- Reconnect monitoring starts on real demand or an already-running local
  connection. Passive checks inspect owned connection records rather than
  initializing MCP. Each managed startup has an independent record scope.
- Windows local MCP connections run in separate kill-on-close Job Objects.
  Children are assigned before they run, and detached descendants stay owned.
  PATH/PATHEXT command resolution preserves Windows npm/cmd launchers.
- Recognized BGPM npx commands reuse the installed 1.2.8 dependency tree from a
  stable runtime directory and start `dist/cli.js` directly. Explicit other
  versions and unsupported npx options retain their original command. User
  configuration is not rewritten, and packages are not downloaded.
- BGPM idle release reads the owned core's actual full state. Running tasks,
  historical tasks, unknown state and external shared ports prevent release.
  An empty service is released and restored before the next prompt resolves tools.
- Debug schema 2 retains exact aggregate totals, ten largest processes, omitted
  count, sampler duration, Node memory and physical-memory totals. It omits raw
  duplicated process rows, creation identities and V8/dependency dumps. The
  ordinary panel response is unchanged. Formal builds return 404 for debug.
- `AGENTS.md` and `BUILD.md` now direct local release installation to portable
  executables, with previous binaries and user data retained.

## Measurements

The isolated fixture uses the installed OpenCode 1.18.30 and BGPM 1.2.8, two
connected directories, and no model requests. Working sets include all observed
children of OpenCode, including launcher overhead, but exclude OpenCode itself.
These are process working-set sums, not unique physical memory.

| Stage | Original npx | Final optimized launch |
|---|---:|---:|
| Connected, median of three samples | 8 Node, 682.38 MiB | 4 Node, 439.68 MiB |
| Connected, maximum of three samples | 723.96 MiB | 496.50 MiB |
| Five seconds after disconnect | 8 Node, 671.48 MiB | 0 Node, 11.48 MiB |
| Thirty-five seconds after disconnect | 8 Node, 671.07 MiB | 0 Node, 11.48 MiB |

The connected-child reduction is approximately 35.6% at the median and 31.4%
at the maximum. Samples are taken at matching five-second intervals after both
connections report connected. The remaining 11.48 MiB
after release is OpenCode's console helper, not an MCP process. Keeping the npx
chain while adding only Job Object ownership also produced zero MCP Node
survivors after disconnect, independently verifying the cleanup mechanism.
Seventeen metadata-only directories created zero MCP Node processes. Reconnect
followed by another disconnect returned to zero MCP Node processes.

The debug comparison feeds the same 227-process dataset to the before/after
collectors. JSON shrank from 81,735 to 1,264 bytes, approximately 98.5%, with equal
aggregate memory. This is a serialization comparison, not a system CPU claim.

Evidence scripts and machine-readable results are in `Temp/verify-mcp-optimization.mjs`,
`Temp/mcp-final-verification.log`, `Temp/mcp-measured-final.log`, `Temp/mcp-guarded-npx.log`, and
`Temp/debug-payload-comparison.json`. Idle-hook integration uses a clock advance
to cross five minutes while keeping real OpenCode/BGPM processes, SDK requests,
task execution and WebSocket state. It checks active/history preservation,
empty release and awaited restore. No model conversation was submitted.

## Validation

- MCP reconnect/launch/idle unit tests: 18 passed.
- Directory bootstrap tests: 10 passed.
- Collector and personal version/update policy tests: 10 passed.
- Workspace type-check: passed in all five reported workspaces.
- Server-file Oxlint: passed. Bootstrap files retain existing assertion/type
  findings; this change introduces no type assertions.
- Workspace lint: blocked by the untouched `LogsPage.tsx:119` unused
  `currentFilePath`. Other reported workspace lint commands passed.
- Dead-code inspection ran. No new MCP launch or collector findings appeared;
  the report contains existing repository backlog.
- Web assets, Electron bundling, native rebuild and portable packaging passed.
- Packaged and installed executable launches exposed the expected version,
  mounted the performance control, returned 200 for metrics and managed OpenCode
  health, and returned 404 for debug. Final installation verification is recorded
  in `Temp/portable-installed-verification.log` and
  `Temp/portable-1.2-check/cleanup.json`.

Final installed-binary verification recorded 12 process identities and zero
survivors after close. The separate MCP fixture cleanup check compared 108
recorded PID/creation identities and found zero survivors.

The Windows table reports three samples per connected state and one per release
stage, not a latency percentile or a full 17-active-directory memory benchmark. Browser
rendering performance, external OpenCode, macOS and Linux were not benchmarked.

## Deployment

The normal release is `1.23.0-DIJIANG.1.2`, without a debug suffix. The portable
executable is deployed under the user's `Programs/OpenChamber-Portable` version
directory, with an `OpenChamber Portable` desktop shortcut. The prior installation
remains available. Existing user instances were not restarted; launch the new
shortcut after closing the old app to use the new runtime. Rollback is opening
the retained prior executable with the unchanged user data.

Final executable SHA256:
`B45846E8F2C6935777D800F9B93BF55FBC22B0BD33FC8496EA3228CECF750297`.
The deployed copy matches the generated portable artifact.

Command/environment failures and their corrected invocations are recorded in
`Temp/performance-optimization-errors.md`.
