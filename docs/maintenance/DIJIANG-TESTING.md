# DIJIANG 3.7 testing plan

This document records the test map for the `1.24.2-DIJIANG.3.7` preparation.
It is a plan and evidence index. It does not claim that the release has passed,
that every feature has automated coverage, or that a package has been accepted.
DIJIANG 3.6 verification and 3.7 maintenance remain in progress.

## Runner map

The root `test` script runs the isolated script suite, then the SDK, UI, VS Code,
Electron and web package suites. `scripts/run-isolated-tests.mjs` discovers
`*.test.*` and `*.spec.*` files recursively, skips build and dependency folders,
and starts each file in its own process with up to four workers.

The isolated runner selects Bun for TypeScript and files importing `bun:test`.
It selects Node's `--test` for JavaScript files importing `node:test`. Files
without either import are reported as unknown instead of being silently skipped.
This is a filename/import heuristic. It does not invoke Vitest.

The web package uses Vitest through `packages/web/vitest.config.ts`. That config
maps `bun:test` to the package shim, includes shared UI Vitest files, and supplies
the browser aliases required by those tests. Web tests therefore need the web
package command, not the isolated Node command. The root test command runs the
web package after the SDK and UI suites.

## Feature coverage matrix

| Area | Main evidence target | Runner or command | Evidence type | Acceptance still needed |
| --- | --- | --- | --- | --- |
| Update history parsing and English/Chinese parity | `packages/ui/src/lib/settings/updateHistory.test.ts` | `bun test src/lib/settings/updateHistory.test.ts` from `packages/ui` | Unit assertions for ordering, classification, categories, credits and preview marker | Verify rendered filters and category grouping in each mounted surface |
| Settings registry, per-surface values and persisted projections | `packages/ui/src/lib/settings/registry.test.ts` and `search.test.ts` | Focused Bun tests from `packages/ui` | Registry/parser/search unit evidence | Recheck generated snapshots after the final merge |
| Mermaid/PlantUML display and export | UI diagram tests and the existing diagram validation records | `bun run --cwd packages/ui test` plus the documented fixture commands | Unit and isolated browser/file evidence where present | Re-run against the final release build |
| Files preview/open/save behavior | Files view tests and the file-opening maintenance evidence | UI package tests and isolated Electron fixture commands | Unit, packaged fixture and native boundary evidence | Native packaged acceptance on the final executable |
| Session loading, sidebar and work status | Shared UI sync/sidebar tests | `bun run --cwd packages/ui test` | Unit and state reconciliation evidence | Cross-surface runtime check with web, desktop and VS Code |
| MCP lifecycle and reconnect behavior | Web server MCP tests and existing lifecycle evidence | `bun run --cwd packages/web test` | Node/Vitest unit evidence and isolated process evidence | Long-lived packaged runtime check |
| Electron startup, shutdown, SSH and updater | Electron tests and packaged probes | `bun run --cwd packages/electron test` | Node unit and native fixture evidence | Final portable install, update and quit lifecycle |
| SDK and extension contracts | `packages/sdk` tests/build and extension fixtures | `bun run --cwd packages/sdk test` and `bun run --cwd packages/sdk build` | SDK unit/build evidence | Install and exercise a built extension in the final app |
| Web routes and UI Vitest suites | Web server tests plus shared UI Vitest files | `bun run --cwd packages/web test` | Node and Vitest results, kept separate | Resolve unrelated merge failures before release claim |

## Commands

Run focused checks from the owning package:

```text
bun test src/lib/settings/updateHistory.test.ts src/lib/settings/registry.test.ts src/lib/settings/search.test.ts
node scripts/run-isolated-tests.mjs scripts
bun run --cwd packages/sdk test
bun run --cwd packages/ui test
bun run --cwd packages/vscode test
bun run --cwd packages/electron test
bun run --cwd packages/web test
```

The complete root entrypoint is `bun run test`. Bare `bun test` bypasses the
package orchestration and must not be used as a full-suite substitute.
Use the package commands when a focused result is needed. Do not turn a command
that was not run into a passing claim.

## Evidence rules and open items

Record the exact commit, command, runner, exit status, and relevant output for
each result. Keep static inspection, unit tests, browser fixtures, packaged
runtime checks, and external-service checks as separate evidence types. A test
file passing does not prove a native shell, relay, OpenCode process, mobile
layout, or release artifact works.

At the time of writing, the following remain open: final upstream conflict
resolution, final version/history alignment, complete SDK and mixed-runner
execution, final portable packaging, and runtime acceptance across web, desktop,
VS Code and mobile. No coverage percentage is recorded because no complete,
trusted coverage run has been performed for this release preparation.
