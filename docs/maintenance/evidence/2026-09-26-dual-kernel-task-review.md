# Dual-kernel task-tree review

Review basis: personal tree `4ac81115c17c203c89c5b52f93a930af32ea2163`, upstream OpenChamber `v2.0.1` / `63bd5070c8620432817e1e67de77791f801bcf3e`, the four design documents, and read-only source searches on 2026-09-26. This is a task and contract review, not runtime validation. The inventory was updated during this review with UI-17 through UI-20; those rows are included below.

## T01 admission

T01 can start once T00 records and protects the implementation worktree's existing dirty files. Its HEAD is the pinned OC1 commit. The source edits assigned to T01 do not overlap another active writer if `routes.js` remains owned by T01 and the lead until integration. OC1 `routes.js:93,347,380,402` currently reads `/global/health`; upstream v2 `routes.js:165,202,225` reads `/api/info`. Upstream `compatibility.js:64-80` documents a real trap: an OC1 `/api/info` may return HTML or proxy elsewhere. Valid detection needs the endpoint's JSON shape, a parseable version and matching major version. If both probes give valid but contradictory evidence, return `unknown`. Keep `unsupported` for a known generation outside the supported range, and `unreachable` for transport failure without a valid answer. Bind the result to URL/auth identity and endpoint epoch. `opencode-resolution-runtime.js` currently resolves a **binary**, not a server endpoint; its return object cannot alone identify an external server generation.

T01's assigned `bootstrap-runtime.js` should consume a descriptor only where it already participates in endpoint setup. `routes.js` has upgrade, health and version branches as well as detection (`:93-101,275,347-420`); isolate the detection edit and leave generation-specific upgrade policy to T11/lead. The implementation plan's path `docs/maintenance/DUAL-KERNEL-VALIDATION.md` is relative to the implementation worktree. The root checkout does not contain that document.

## Changes needed before freezing T03

1. **Assign all autonomous OpenCode callers.** T09/T10 list queue, scheduler, assist, goal, activity and notifications, but `packages/web/server/lib/openchamber-sessions/routes.js:2,113-119,201,248,263,582,682,750,848` has direct OC1 SDK and HTTP calls. `packages/web/server/lib/openchamber-control/service.js:2,148,174` also builds an OC1 client. `packages/web/server/lib/opencode/skill-routes.js:1,134` is a direct SDK caller. Upstream equivalents continue to use OpenCode (`openchamber-sessions/routes.js:630`, `openchamber-control/service.js:228,290,591-617`). Give each file a single writer, likely a new T10 directory partition for `openchamber-control`, T12 for `openchamber-sessions/routes.js` with T09 operation calls, and T11 for `skill-routes.js`. Add corresponding rows/fixtures to the ledger. A contract that omits these routes leaves old session creation, messaging, control tools or skills bound to OC1.
2. **Resolve UI ownership before T06 and T15 run.** Direct SDK calls survive outside `client.ts`: `packages/ui/src/components/sections/providers/ProvidersPage.tsx:225,260,477,512`, `ProviderOAuthMethods.tsx:108,148`, `components/sections/mcp/McpOAuthSignIn.tsx:28`, `stores/useAgentGroupsStore.ts:257`, `stores/useGlobalSessionsStore.ts:699,794`, `stores/useMultiRunStore.ts:123`, and `components/multirun/MultiRunFusionDialog.tsx:111`. T06 says it closes SDK escapes, while T15 owns these same feature files and depends on T06. Freeze their operation signatures in T03, assign the actual feature files to T15, and make T06 completion mean facade and its exclusive files only. T15 then closes the remaining direct calls. T07 owns direct sync callers (`sync/bootstrap.ts:66,204,206`, `session-actions.ts:382,503,627,891,909`) and needs the same signatures.
3. **Extend VS Code file ownership.** `packages/vscode/src/bridge-git-special-runtime.ts:3,69,173,187,202,238` independently creates an OC1 client and performs create, prompt, message read and delete. T13's exclusive file list omits it. Assign it and its test to T13, or require a named lead-owned integration edit before T13 can claim both kernels work in VS Code.
4. **Separate endpoint contracts from feature groups.** The updated UI-17 through UI-20 rows expose bootstrap (`global.config.get`, `lsp.status`, `vcs.get`), provider auth, direct SDK use, and statistics. Add those stable IDs to `tasks.md` routing and the adoption ledger before T03 signs off. UI-20 is an existing OC1 statistics feature even though `session.stats` is a v2 API (`upstream packages/ui/src/lib/opencode/session-stats.ts:98`). Preserve the OC1 calculation. UI-16 likewise includes old `experimental.controlPlane.moveSession` and `find.files` (`OC1 sync/session-actions.ts:382`, `client.ts:1909`), so those user behaviors cannot be OC2-only gates.
5. **Make detection consumers explicit.** T01's server descriptor does not automatically reach UI, autonomous callers and VS Code. T03 must name an endpoint identity/epoch read contract and its invalidation action. The UI app roots pass raw SDK objects into `SyncProvider` (`App.tsx:942,988`, `apps/MobileApp.tsx:1300`, `apps/VSCodeApp.tsx:121,141`, `apps/ElectronMiniChatApp.tsx:347`); T07 cannot complete the replacement while the lead-owned roots stay unchanged. Put that composition edit at a named lead integration gate immediately after T07, not only at final T15.

## Ownership for the new inventory rows

| Row | Contract owner | Caller and integration owner |
| --- | --- | --- |
| UI-17 bootstrap config, LSP and VCS | T03 signature; T04/T05 implementation | T07 `sync/bootstrap.ts`; T15 presentation if upstream changed it |
| UI-18 provider auth and OAuth | T03 signature; T04/T05 read/authorize path; T11 credential and callback owner | T15 provider components; T13 bridge only where the VS Code host handles credentials |
| UI-19 direct SDK calls | T03 exact operation set; T04/T05 and T09 implementation | T07 sync, T13 VS Code, T15 stores/multirun, T10/T12 server callers; T06 only its exclusive facade files |
| UI-20 statistics | T03 source-neutral statistics read contract; T04 OC1 calculation; T05 OC2 `session.stats` projection | T15 statistics presentation and regression |

T03 may start after T01 returns a tested endpoint descriptor, T02 identifies each caller and its request/response fields, and the lead assigns the direct callers above. Freeze a small set of intent-based operations rather than an SDK-shaped union. The descriptor must carry endpoint identity and epoch; every operation gets directory and cancellation context. The contract must distinguish OC1 `prompt_async` acceptance from completion, keep OC1 question and OC2 form answers tagged, and expose explicit unsupported results only for verified new behavior. T02 owns the full signature proposal; this review does not duplicate it.

## Scope and evidence corrections

- `tasks.md` still says 16 UI rows in its inventory routing summary; the inventory now has UI-17 through UI-20. Update the count and routing table together.
- T17's core live conversation is a milestone. The publication gate should explicitly require every existing OC1 feature and every adopted OC2 feature to have a ledger disposition and appropriate evidence, including DIJIANG. The validation document already says this; keep that demand when dividing work into short tasks.
- The current OC1 runtime is the delivery gate and its exact version must be recorded. This review makes no `1.2.27` release claim.
- The design documents are static evidence. No source was edited and no OpenCode runtime was started during this review.

## Command observations

- Reading `docs/maintenance/DUAL-KERNEL-VALIDATION.md` from the root checkout failed because the file exists in the implementation worktree. Subsequent reads used `.worktrees/dual-kernel-20260926/docs/maintenance/DUAL-KERNEL-VALIDATION.md`.
- A PowerShell `rg` call with Bash-style brace expansion produced a parser error. Subsequent searches passed explicit paths.
