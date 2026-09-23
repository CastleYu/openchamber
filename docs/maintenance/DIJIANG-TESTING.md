# DIJIANG 3.7 testing plan

This document records the test map for the `1.24.2-DIJIANG.3.7` preparation.
It is the feature coverage map and evidence index. The complete automated gate
passed after the second community merge; native portable and external-service
acceptance remain separate from that result.

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
| Web routes and UI Vitest suites | Web server tests plus shared UI Vitest files | `bun run --cwd packages/web test` | Node and Vitest results, kept separate | Final complete suite and portable API smoke check |

## DIJIANG regression cases

Each row is a contract to keep after community intake. A passing mock is an
automated check of that contract, not a claim that the installed app was used.

| Feature | Successful path | Failure, cleanup, or boundary path | Owning tests |
| --- | --- | --- | --- |
| Portable identity and updates | Stable/debug version strings and bilingual history match the build identity | Version-only commands do not package or overwrite metadata; a personal build refuses installer endpoints while community behavior remains available | `scripts/build-personal.test.mjs`, `packages/ui/src/lib/settings/updateHistory.test.ts`, `packages/web/server/lib/opencode/openchamber-routes.test.js`, `packages/ui/src/lib/web-update.test.ts` |
| Native file opening | A window-owned copy can be opened through the system or a chosen application; ZIP central entries can be listed without extraction | Cancellation, size limits, invalid archive structures, process exit, and window destruction release temporary files and reject stale results | `packages/electron/file-transfers.test.mjs`, `packages/web/server/lib/fs/zip-directory.test.js`, `packages/web/server/lib/fs/routes.test.js` |
| Authenticated file assets | Workspace and explicitly requested outside-workspace reads use the same runtime contract; image/media URLs work across browser and desktop | Abort signals, range requests, 416 responses, OS read denial, and outside-workspace write restrictions stay visible | `packages/web/src/api/file-assets.test.ts`, `packages/web/server/lib/fs/routes.test.js`, `packages/web/server/lib/fs/byte-range.test.js` |
| Diagrams | Mermaid style selection and PlantUML rendering preserve source, preview and SVG/PNG export | Incomplete streaming text waits; render/export failures remain errors; changing style does not reuse stale output | UI Markdown, diagram and image-export tests; packaged visual check remains separate |
| Managed process ownership | Managed OpenCode is registered at spawn and removed after exit; CLI PID recovery checks identity on Windows | Failed startup, timeout, explicit close, parent/child exit, orphan cleanup and unknown identity never claim a healthy empty registry | `packages/web/server/lib/opencode/lifecycle.test.js`, `managed-process-registry.test.mjs`, `packages/web/bin/cli.test.js` |
| MCP reconnection and idle release | A managed OpenCode 2.x child loads the plugin directory; failed servers reconnect with bounded backoff | Disabled/auth-required servers are left alone; idle release preserves active tools; user-owned OpenCode config uses the content fallback; external/VS Code runtimes receive no managed plugin | `packages/web/server/lib/mcp-reconnect/*.test.js`, `packages/web/server/lib/opencode/managed-config-file.test.js` |
| Session resource budgets | Focused sessions flush sooner and background batches preserve every text delta; sidebar loads only eligible directories | Reconnect, stale snapshots, hidden views, aborted demand and unmount release leases without presenting fetch failure as an empty result | `packages/ui/src/sync/event-pipeline.test.ts`, `packages/ui/src/lib/performance/projectResources.test.ts`, `packages/ui/src/components/session/sidebar/list/sessionBootstrapDemands.test.ts` |
| Guest and SDK boundaries | Shared SDK classifies Windows drive paths as filesystem paths; built examples match the contract | Traversal, missing grants, disabled services, cancelled requests and stopped service processes fail without leaking a capability | `packages/sdk/src/contract.test.ts`, `packages/sdk/scripts/examples.test.ts`, `packages/web/server/lib/guests/{files,service,ssh-install}.test.js` |

The isolated test runner deliberately executes each Bun/Node test file in its
own process. Vitest runs the web suite separately, with four native Node files
excluded and executed by `test:node`. This prevents a mock or process-level
environment change in one file from affecting the next file. The full root
command is the release gate; a focused rerun only diagnoses one area.

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

The latest reviewed community main is `0af1eb00c`. The regression map above
covers every retained DIJIANG feature family with an owning automated test and
at least one boundary or cleanup case. The complete root runner, portable
packaging and native acceptance supply the final release evidence; package
test counts are recorded in `DIJIANG-3.7-DELIVERY.md` after they settle.

Coverage is reviewed by contract and runtime boundary, not by an invented line
percentage. There is no repository-wide instrumented coverage script. Unit
tests do not establish a long-lived external MCP connection, real mobile or
VS Code rendering, SSH behavior against a live host, or a portable app's
shutdown cleanup. Those remain explicit runtime acceptance boundaries rather
than being counted as covered by a mock.
