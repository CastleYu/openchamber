# Dual-kernel implementation DAG

Status: implementation assignment plan. Source baseline: personal OC1 `4ac81115c17c203c89c5b52f93a930af32ea2163` in `.worktrees/dual-kernel-20260926`; product reference: upstream OpenChamber `v2.0.1` / `63bd5070c8620432817e1e67de77791f801bcf3e` in `.worktrees/upstream-v2-20260926`. Read `DUAL-KERNEL-ARCHITECTURE.md`, `DUAL-KERNEL-INTERFACES.md`, and `DUAL-KERNEL-VALIDATION.md` in this directory before dispatch. All paths below are relative to the implementation worktree unless prefixed with `.codex-temp`.

## Completion rule and dispatch protocol

The deliverable is the existing OC1 and DIJIANG product with generation-specific protocol support and selected v2.0.1 product changes. Preserve the established OC1 product structure; do not rewrite it to match every upstream layout change. Classify every one of the 154 product-ledger rows as adopted, retained, intentionally not adopted, or unimplemented, with a reason and evidence. For changed old behavior, OC1 executes its old path. Only a feature verified to be genuinely new to the product is disabled for OC1. An OC2 API or event that is new in name does not prove the feature is new. The currently available OC1 runtime is the live gate for this delivery; record its exact version. OC1 `1.2.27` specific execution is deferred and is not a release gate.

Each implementation agent reads the root guide, matching skills, nearest `DOCUMENTATION.md` and package `README.md` before editing. Each returns: changed files, inventory row IDs closed, source/contract evidence, commands with exit codes, behavior still open, and handoff notes. A failing environmental command must be recorded as instructed by `AGENTS.md`. Agents edit only their exclusive files. A needed cross-owner change is a request to the owner, not a second edit. Tests for an owned module belong to that same owner. Source and test files not listed below must be allocated by the lead first.

The lead owns architecture decisions, canonical operation signatures, common types, dependency manifests/lockfile, root app composition, integration and final acceptance. Assign bounded implementation to **Luna medium** when the contract is frozen and the code change is mechanical; use **Sol medium** for protocol semantics or cross-runtime flows. The task-tree review uses **Sol medium**. User-requested code inspection and final integrated design/completeness review use **Astra low**; review at natural integration gates instead of forcing a separate Sol review after every Sol implementation. The lead personally resolves review findings and runs the final gates.

## DAG and first executable batch

```text
T00 baseline + ledger ──┬── T01 detection ── T03 shared contracts ─┬── T04 UI OC1 ── T05 UI OC2 ── T06 UI consumers
                        │                                             ├── T07 event/sync ingress ── T08 realtime server
                        │                                             ├── T09 server operations ── T10 autonomous workflows
                        │                                             ├── T11 config/auth/plugins ── T12 metadata
                        │                                             └── T13 VS Code / T14 native-mobile
                        └── T02 contract audit ───────────────────────┘
T05,T06,T07,T08,T10,T11,T12,T13,T14 ── T15 upstream product integration ── T16 DIJIANG regression
T04..T16 ── T17 contract and real-runtime acceptance ── T18 promotion/release
```

`T00`, `T01`, and read-only `T02` may start now. `T01` owns detection and a descriptor proposal only; it does not edit UI bootstrap or server operation composition. The lead freezes `T03` after `T02` has enumerated real consumers and `interface-inventory.md` is reviewed. If the restoration worktree has not yet been returned to the pinned OC1 source, `T00` must finish before any source edit; agents can still review source and draft fixtures meanwhile. Dispatch at most one active writer for each row's files.

| ID | Owner and exclusive files | Required operation and acceptance | Depends |
| --- | --- | --- | --- |
| **T00** baseline/ledger, lead | `docs/maintenance/DUAL-KERNEL-ADOPTION.md` and baseline restoration commit set; no product source assigned here | Restore exact personal OC1 behavior while preserving dirty files and published ancestry; record upstream path/symbol, local owner, OC1 policy, OC2 policy, adopted source SHA and evidence for every inventory row. Run pinned focused baseline tests and distinguish pre-existing failures. | none |
| **T01** generation detection, **Sol medium** | New `packages/web/server/lib/opencode/compatibility.js`, existing `opencode-resolution-runtime.js`, `bootstrap-runtime.js`, `routes.js` detection branch only, plus same-stem tests. Lead owns any overlap in `routes.js` with later proxy work. | Probe `/global/health` and `/api/info` read-only, validate response/version evidence, return tagged `oc1`, `oc2`, `unsupported`, `unreachable`, or `unknown`; no silent OC1 fallback. Bind descriptor to endpoint identity and epoch rather than mutable process global. Preserve current OC1 launch/external ownership. Contract test both endpoints, ambiguous/failure outcomes and endpoint change. **First writer task.** | T00 for edits |
| **T02** call-contract closure, **Sol medium**, read-only | No source edits; append missing consumer/signature decisions to `.codex-temp/dual-kernel/contract-proposal.md` | Reuse `interface-inventory.md` and its stable operation ledger instead of repeating its full scan. Resolve only unresolved dynamic URL/SDK aliases, direct `getSdkClient`/`getScopedSdkClient` escapes, `session.todo`, `tool.ids`, OAuth callback, config/plugin hooks and any operation signature the ledger cannot yet justify. Name request/response fields, directory/credential source and error semantics for those decisions. Mark uncertain OC2 semantics for fixture validation. | inventory ledger |
| **T03** descriptor and operation contract, lead | `packages/ui/src/lib/opencode/model.ts`; new `packages/ui/src/lib/opencode/{runtime,operations}.ts`; new server operation contract files under `packages/web/server/lib/opencode/`; manifests and `bun.lock` if required; app root files only in lead's integration commit | Freeze a small domain operation set, selected by one endpoint descriptor. Separate shared meaning from tagged OC1/OC2 permission, form/question and editable-config records. Use optional fields for absent data; never synthesize cost/tokens/IDs. Include typed unsupported result and explicit in-flight invalidation on endpoint switch. Get Sol medium review of the task-tree/contract decision before parallel protocol writers begin; contract fixtures compile against every actual consumer. | T01,T02, inventory review |
| **T04** OC1 UI protocol, **Sol medium** | New `packages/ui/src/lib/opencode/v1/**`, OC1-only tests there | Move OC1 OpenCode requests/projection behind T03 operations without changing request paths, SDK1 shapes, headers, errors, IDs, stream assumptions, or async prompt semantics. Keep `client.ts` and existing SyncProvider untouched until integration by lead. Prove golden OC1 request/response fixtures and old focused tests. | T03 |
| **T05** OC2 UI protocol, **Sol medium** | New `packages/ui/src/lib/opencode/v2/**`, protocol-only tests there; upstream `projection.ts` and `events.ts` are reviewed source, not automatic copy | Implement OC2 requests from upstream v2.0.1 and HTTP message/part projection, cursor pages, prompt/interrupt, revert stages, compact, permission/form, catalog and MCP. Preserve deterministic part identity between history and stream. Independent fixtures require exact method/path/query/body/status and missing fields. New API primitives get explicit capability handling; no invented OC1 implementation. | T03 |
| **T06** UI facade and SDK escape closure, **Sol medium** | `packages/ui/src/lib/opencode/client.ts`, non-sync `packages/ui/src/lib/opencode/**` top-level files, `packages/ui/src/lib/{gitApi,debug,btw}.ts`, other direct SDK consumers allocated here by lead before edits; corresponding tests | Select T04/T05 for current descriptor, preserve shared runtime fetch/directory/error/attachment utilities. Replace raw SDK escape uses with exact T03 operations, including Git generation and debug. Do not expose `SDK1 | SDK2` downstream. A broad consumer discovered outside ownership goes to its owner. | T04,T05 |
| **T07** UI event/sync, **Sol medium** | `packages/ui/src/sync/**`, `packages/ui/src/lib/opencode/events.ts`, `projection.ts`, and sync tests; excludes app roots | Keep OC1 decoder and recovery meaning; add OC2 typed domain mutations based on upstream event projection. Cover session, text/reasoning/tool/step, permission/form, synthetic, usage, status and retained labels. Maintain HTTP/event part identity, out-of-order and duplicate handling, queue state, reconnect snapshot authority and runtime switch invalidation. Replace SyncProvider's SDK reference with descriptor/operation epoch. | T03,T04,T05 |
| **T08** proxy and realtime, **Sol medium** | `packages/web/server/lib/opencode/{proxy,watcher,network-runtime,core-routes}.js`, `packages/web/server/lib/event-stream/**`, same-stem tests; `routes.js` changes through T01 owner/lead | Keep OpenChamber `/api` route precedence; forward OC1 browser `/api/*` to upstream `/*`, OC2 to upstream `/api/*`, preserving auth, body, abort and SSE cancellation. Select `/global/event` vs `/api/event`, process generation-specific events without raw-v2-to-fake-v1 JSON translation. Validate reconnect, event side effects, explicit route precedence and failure propagation. | T01,T03 |
| **T09** server protocol operations, **Sol medium** | New `packages/web/server/lib/opencode/{v1,v2}/**` and focused tests only | Implement minimal server-side operations used by queue, scheduler, assist, goal, activity, notifications and memory: session/status/tail, prompt/command, mutation, agent/model and metadata where applicable. Preserve per-directory identity and abort/credential rules. Tests enforce exact OC1/OC2 HTTP/SDK contracts and reject unsupported before dispatch. | T03 |
| **T10** autonomous server workflows, **Sol medium**, split sequential or by directory | `packages/web/server/lib/{message-queue,scheduled-tasks,session-assist,session-goal,session-knowledge,notifications}/**` and owned tests/docs. Each directory may be a separate **Luna medium** task only after T09 signatures and fixture behavior are frozen; files never shared across agents. | Route every direct OpenCode call through T09; preserve existing OC1 queue dispatch, scheduled tasks, assist/goal, knowledge and notification behavior without an open browser. OC2 follows changed prompt/status/message semantics. Prove no queue double-send, no failure-as-empty, delayed task recovery and persisted record ownership. | T09,T08 |
| **T11** config, auth, plugin and lifecycle, **Sol medium**, split by nonoverlapping directories/files | `packages/web/server/lib/opencode/{config-*,settings-*,auth*,credential*,managed-plugin*,plugin*,agent-tool*,env-*,lifecycle*,v1-migration*}.js` and tests; `packages/web/server/lib/agent-tool/**` only if explicitly assigned; lead owns shared `routes.js` | Select generation **before writes**. OC1 keeps config file shape, `OPENCODE_CONFIG_CONTENT`, auth.json, generated plugin and deferred apply/restart. OC2 gets watched managed config/plugin directory, new plugin hook contract and credential owner. Guard v2 top-up against OC1. Preserve backups/failed-write rollback and verify each version with config/plugin fixtures. Bound any platform shared file reassignment before edits. | T01,T03,T09 |
| **T12** session metadata/storage, **Sol medium** | `packages/web/server/lib/openchamber-sessions/**`, metadata-related tests; session-goal files remain T10 | Keep OC1 session metadata/archive writes in its existing OpenCode API. OC2 uses merge-then-PATCH metadata and an OpenChamber archive overlay. The upstream legacy metadata JSON belongs to earlier OC2 versions, not this OC1 baseline. Verify generation-scoped storage roots, no cross-generation migration or silent data sharing, malformed/failed writes and rollback. | T01,T03,T09 |
| **T13** VS Code host/webview, **Sol medium** | `packages/vscode/src/{opencode.ts,sseProxy.ts,bridge-proxy-runtime.ts,bridge-config-runtime.ts,opencodeConfig.ts}` and `packages/vscode/webview/api/**` plus focused tests; any additional bridge file allocated by lead | Resolve generation in extension host, then choose managed binary acceptance, health, proxy prefix, SSE endpoint, message path and config/credential writer. Preserve process ownership and cancellation. Webview receives the same descriptor as host; no host/webview mismatch. Test both kernels through bridge and verify existing OC1 VS Code features. | T01,T03,T08,T11 |
| **T14** Electron, hosted/Capacitor and entrypoints, **Sol medium** | `packages/electron/**`, `packages/mobile/**`, `packages/web/bin/**` and targeted tests/docs; UI app roots remain lead owned | Electron keeps one in-process backend and selected binary/runtime identity; hosted mobile and Capacitor use the server descriptor and clear it on switch/reconnect. Keep local/remote credential handling and native lifecycle. Validate routes/packaged assets and platform-specific connection flows; do not duplicate protocol adapters in native shell. | T01,T03,T08,T13 where shared bridge contract applies |
| **T15** selected upstream v2.0.1 product changes, lead partitions by feature-owned UI directories | `packages/ui/src/components/**`, `packages/ui/src/hooks/**`, `packages/ui/src/stores/**`, `packages/ui/src/lib/api/**`, `packages/ui/src/apps/**`, `packages/ui/src/App.tsx`, style/locales and feature tests; each partition receives exclusive files | Classify all 154 product rows. Adopt the selected features, retain existing OC1 behavior, and record intentional non-adoption or unimplemented work with a reason. Adopt shared UI only where the OC1 product contract supports it; keep generation-specific handlers for changed permissions/forms/config. Preserve OC1 queue, scheduled tasks, fork, compaction, statistics, memory, skills, MCP, multirun, auto-review and DIJIANG. A product row closes only with its disposition and required evidence. | T06,T07,T10,T11,T12,T13,T14 |
| **T16** DIJIANG reconciliation, lead with bounded **Luna medium** leaf tasks | Personal-only feature paths assigned after diff and ledger classification; no T04–T15 owned file touched concurrently | Reapply every personal feature omitted or changed by upstream intake, preserve existing behavior in OC1, define OC2 equivalent or explicit capability reason, and run feature tests. Audit all v1.24.2 and DIJIANG baseline rows; zero unclassified rows. | T15 |
| **T17** acceptance, lead; test execution **Luna medium**, final inspection **Astra low** | Contract fixtures/tests and acceptance evidence, no new product source ownership | Apply validation design: generation, mapping, proxy, SSE, config/plugin, autonomous workflows, web/desktop/VS Code/mobile transport; use isolated real OC1 and OC2 runtimes, one compact conversation per generation, exact source SHAs and commands. Review every row, no unresolved placeholder or unknown. Keep automated test evidence separate from real runtime evidence. | T04–T16 |
| **T18** promotion and release, lead; CI/release execution **Luna medium**, failure escalation **Sol medium** | Reviewed implementation commits, explicit staged files, BUILD.md version/release workflow | Preserve branch ancestry and unrelated changes, integrate reviewed commits, run final gates, produce portable release on requested fork and verify tag/asset SHA. No force push. | T17 |

## Inventory row routing

The following numbering is the ordinal order of the tables in `interface-inventory.md`; freeze stable IDs in the adoption ledger before editing the tables. An ID denotes a consumed interface row, not a single API name. Every row receives an implementing task, fixture, runtime result and final ledger state.

| Inventory rows | Primary implementation / required secondary consumer |
| --- | --- |
| UI-01 path/project | T04,T05; T06 caller closure; T15 project presentation |
| UI-02 session CRUD/list | T04,T05; T07 paging/reconcile; T12 archive/metadata; T15 |
| UI-03 messages | T04,T05; T07 identity/replay; T15 |
| UI-04 promptAsync/prompt | T04,T05; T07 completion/stop; T10 queue and scheduler |
| UI-05 command/shell | T04,T05; T10 queue; T15 |
| UI-06 abort/interrupt | T04,T05; T07 live idle/abort; T15 |
| UI-07 revert | T04,T05; T07 revert events; T15 |
| UI-08 compact | T04,T05; T07 compaction events; T15 |
| UI-09 fork | T04,T05; T15 selection UX |
| UI-10 todo | T04; T05 local/OC2 source disposition; T07/T15 |
| UI-11 status/active | T04,T05; T07/T08 recovery; T10 activity |
| UI-12 permissions | T04,T05; T07/T15 rule and pending UX |
| UI-13 question/form | T04,T05; T07/T15 separate answer validation |
| UI-14 config/catalog/skills | T04,T05; T11 writers; T15 editors |
| UI-15 MCP/tool IDs | T04,T05; T11 integration; T15 tool discovery |
| UI-16 OC2 additional primitives | T05; T15 feature-by-feature OC1 baseline classification, T10 synthetic queue where used |
| HTTP-01 health; HTTP-02 warmup agent; HTTP-03 status warmup | T01/T11; T09 server operations; T13 VS Code for HTTP-01 |
| HTTP-04 PWA sessions | T08 proxy; T09 paging; T15 PWA display |
| HTTP-05 global/directory SSE | T08; T07 sync; T13 VS Code |
| HTTP-06 queue endpoints | T09,T10; T07 queue state |
| HTTP-07 scheduled prompt | T09,T10 |
| HTTP-08 upgrade | T11; T14 CLI/native policy |
| HTTP-09 OAuth callbacks | T08,T11; T13 VS Code where used |
| HTTP-10 OpenChamber-owned config/archive/project routes | T08 route precedence; T11/T12 storage; T15 UI |
| HTTP-11 OC2 metadata PATCH | T09,T12; T15 display |
| EV-01 session lifecycle/status | T07,T08; T10 activity |
| EV-02 message/part/tool | T05 projection; T07,T08; T15 display |
| EV-03 permission | T07,T08; T15 UX |
| EV-04 question/form | T07,T08; T15 UX |
| EV-05 diff/todo/vcs/project | T07,T08; T15 feature disposition |
| EV-06 connected/update labels | T07,T08 with envelope/sequence fixture |
| EV-07 added vocabulary | T07,T08; T15 baseline classification |
| CFG-01 config schema/managed injection | T11; T13 VS Code; T15 editor |
| CFG-02 deferred/live apply | T11; T13; T15 settings UX |
| CFG-03 credential owner | T11; T13; T15 provider UX |
| CFG-04 generated plugin/hooks | T11; T10 integration; T13 where extension injects |
| CFG-05 VS Code runtime | T13; T07 shared UI sync |

The inventory currently has 20 UI, 11 HTTP, 7 event and 5 config/platform rows. The mechanical extractor is an audit aid, not evidence that this map is complete. T02 must resolve dynamic URL construction, SDK aliases and direct consumers before T03 freezes signatures. T17 compares the final ledger to all inventory rows and independently scans for unowned OpenCode calls and OC2-only features accidentally enabled on OC1. New findings get a row and owner before a completeness claim.

## Command observation

2026-09-26: a read of `packages/web/server/lib/opencode/compatibility.js` in the OC1 worktree failed because that module exists only in the upstream OC2 tree. `T01` therefore creates the OC1-side compatibility module or chooses another single-owned probe module after inspecting `opencode-resolution-runtime.js`; do not assume the upstream file exists in the restored baseline.

## Cross-owner locks

1. `client.ts`, `model.ts`, `App.tsx`, `apps/*App.tsx`, `routes.js`, package manifests and lockfile are integration locks. Only the named owner edits each at a time; others submit a concise patch request. The lead merges consumer changes after T04/T05/T07 compile.
2. T11 must allocate exact config/auth/plugin files before parallel leaf dispatch. `opencode/agent-tool` and `web/server/lib/agent-tool` are different owners; compare both plugin contracts. T10 splits by entire autonomous directory, never by methods in one runtime file.
3. T15 partitions upstream UI by feature directories and named shared screens. Any upstream patch touching `sync/**` routes to T07; `lib/opencode/**` routes to T06; `components/**` routes to its one T15 owner. `packages/vscode/**` routes to T13.
4. Server generation is resolved once for a runtime epoch. T08, T09, T11 and T12 receive it from the same composition; no independent sniffing after writes begin. T13 resolves a separate endpoint descriptor in the extension host. Two windows may not overwrite each other's runtime identity.
5. Every task's review includes the relevant risk class from `openchamber-change-discipline`: cross-workspace compile, persisted round trip, or platform/runtime test. `bun run dead-code` applies when import/export/source shape changes; authored TypeScript/JavaScript rewrites get `bunx oxlint <changed-paths>`. Keep test commands scoped until integration.

## Independent review resolutions

The lead accepted the task review on 2026-09-26 with the following precise ownership amendments. These narrow the broad table assignments above.

- T10 additionally owns `packages/web/server/lib/openchamber-control/**`; its direct SDK calls consume T09 operations. T12 owns `openchamber-sessions/routes.js` and its tests, including non-metadata session operations. T11 owns `opencode/skill-routes.js` and tests. T09 provides shared server operations but does not edit those callers.
- T06 owns only its facade and explicitly allocated top-level helper files. T15 owns ProvidersPage, ProviderOAuthMethods, McpOAuthSignIn, useAgentGroupsStore, useGlobalSessionsStore, useMultiRunStore and MultiRunFusionDialog. T06 can complete its facade before these consumers are converted; final SDK escape closure is a T15 integration gate, avoiding a dependency cycle.
- T13 additionally owns `packages/vscode/src/bridge-git-special-runtime.ts` and its tests.
- Immediately after T07, the lead integrates descriptor/operation injection into App.tsx and the MobileApp, VSCodeApp and ElectronMiniChatApp roots. This is a named composition gate before product acceptance, not a deferred assumption.
- T01 is limited to tested generation detection and declarations; T03 integrates the actual descriptor into server/UI/host composition. Binary resolution is not endpoint generation evidence.

| Added inventory row | Contract and implementation | Actual caller owner |
| --- | --- | --- |
| UI-17 bootstrap config/LSP/VCS | T03, T04/T05 | T07 bootstrap; T15 display |
| UI-18 provider auth/OAuth | T03, T04/T05, T11 credential callbacks | T15 provider components, T13 bridge |
| UI-19 direct SDK escapes | T03, T04/T05, T09 | T07 sync, T10/T12 server, T13 host, T15 stores/multirun |
| UI-20 statistics | T03 preserves distinct old metrics and new aggregate query; T04 old metrics, T05 new query | T15 preserves old token/context/turn/quota displays; genuinely new cross-session history remains OC2-only |

A new OC2 statistics endpoint does not replace all old statistics and does not justify fabricating an OC1 implementation of a new historical dashboard. Existing move-session and file-search behavior also remains in OC1 even though OC2 uses different method names.
