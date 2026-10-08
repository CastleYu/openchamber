# CAgent consumer boundaries

Frozen 2026-10-09 against source `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6`. This is the CA-00 migration decision, not an implemented adapter or a CAgent support report. Read the [architecture](CAGENT-INTEGRATION-SPEC.md) first. The [Chinese copy](zh-CN/CAGENT-BOUNDARIES.md) contains the same decisions.

## Inventory and interpretation

The [source inventory](evidence/2026-10-08-cagent-consumers.json) records 118 UI declarations, 23 host operations and 496 named references. The [disposition registry](evidence/2026-10-09-cagent-boundaries.json) assigns every declaration and host operation exactly once to a contract owner, ownership class, migration decision and acceptance gate. Every recorded caller inherits its referenced method's disposition. Unused declarations remain obligations if retained as callable methods.

These groups organize review. They are not capability switches. CA-01 must assign a separate operation ID and guard to each callable backend operation; an adapter supporting one method cannot enable the rest of its group. Dynamic aliases, computed access and new consumers require the same dispatch guard. An unresolved caller keeps its dependent CAgent feature disabled until migrated. Neither source counts nor documentation prove server support.

## Contract ownership and file map

| Concern | Current owner and migration |
| --- | --- |
| Host composition | `packages/web/server/index.js` composes the selected backend dispatcher and registers authenticated owned routes before the OpenCode proxy. Generic proxy requests refuse CAgent. |
| Shared host contract | Introduce `packages/web/server/lib/agent/` for runtime-neutral domain contracts, operation constants, feature dependencies and dispatcher. Keep the adapter portable to the VS Code extension host. No Express, browser or Electron ownership in the adapter. |
| OpenCode protocol | `packages/web/server/lib/opencode/kernel-runtime.js`, `kernel-operations.js` and `kernel-operations.d.ts` retain OC1/OC2 wire translation behind the OpenCode adapter. SDK-shaped payloads and `raw` fields never become required CAgent domain data. |
| Shared UI facade | `packages/ui/src/lib/opencode/client.ts`, `operations.ts` and `model.ts` preserve caller behavior through neutral contracts. Raw SDK access remains OpenCode-only and rejects CAgent. `createDirectory(asProject)` is a backend mutation, although plain mkdir is host-owned. |
| Sync | `packages/ui/src/sync/source.ts` and `sync-context.tsx` need a CAgent source with normalized bootstrap, messages, status and event ordering. Retain OC1/OC2 sources. A generation field cannot stand in for backend family. |
| Host transport | Existing RuntimeAPIs, runtimeFetch and authenticated event transport carry neutral operations. No browser-held CAgent credentials or counterfeit `/session` protocol. |
| VS Code | `packages/vscode/src/bridge.ts` and `bridge-proxy-runtime.ts` bind the same adapter in extension host. Existing local FS/Git bridges retain their owners. CAgent stays unavailable there until that host integration passes. |
| Electron and mobile | Electron reuses the in-process web backend. Hosted mobile and Capacitor use the selected OpenChamber server. No additional CAgent process or protocol copy. Each host has its own acceptance row. |

Paths for new modules are implementation destinations, not existing files. Add focused owning documentation when introducing them. CA-02 freezes exact generated adapter paths and executable commands after CA-01 contracts compile.

## Feature dependencies

Each row is an all-of rule unless it names an alternative. Operation names describe required semantics, not guessed CAgent endpoints. Authorization, readiness, accepted evidence and host availability apply to every row. A failed optional feature cannot disable unrelated accepted features.

| Existing feature family | Ownership | Required semantics and migration decision |
| --- | --- | --- |
| Connection and workspace selection | Mixed | Accepted backend identity, explicit workspace binding and matching epoch. OpenCode Auto detection never selects CAgent. |
| Interactive chat | Backend-dependent | Identity, workspace binding, dispatch and observable completion, plus any decisions the selected mode can demand. Conversation acquisition is any-of verified create or verified bind-existing. History and Stop have separate gates. |
| Session list/history/reopen | Mixed | List/read and message pagination as applicable; host archive metadata remains namespaced. Missing messages are distinct from failed retrieval. |
| Commands and model/agent selection | Backend-dependent | Catalog plus matching dispatch/selection operation. A prompt must not masquerade as a command or an unsupported model change. |
| Permissions, questions and forms | Backend-dependent | Enumerate/observe plus answer/cancel semantics for the corresponding decision kind. Auto-accept also requires host policy and scoped reply authorization. |
| Queue and schedules | Mixed | Durable intent, conversation binding, dispatch, reliable activity/completion, cancellation where the mode requires it, and command catalog for queued commands. Refuse dispatch before taking an item. Existing blocked items survive switching. |
| Assist, goals and session-work | Mixed | Neutral messages, metadata persistence, activity/completion and dispatch; child observation, selection, commands and cancellation when used. Remove reconstructed SDK messages before enabling these readers. |
| Routing, control, context and knowledge | Mixed | Each recorded consumer's read/write/dispatch operations, plus OpenChamber policy/storage. Disable the affected action if a dependency is missing. |
| Notifications and PWA metadata | Mixed | Host delivery remains available; backend-derived title, selection, message or live status needs its corresponding read. Do not present stale history as live activity. |
| Share/fork/import/move/revert/summary/inbox/shells | Backend-dependent | Separate operation for each action and its prerequisite reads. Revert staging and shell cancellation require verified mutation/lifecycle semantics. No blanket advanced-features switch. |
| Local files, Git and terminal | OpenChamber-owned or mixed | Actual host access and authorization; backend file discovery is a separate operation. AI Git generation additionally requires conversation/dispatch/outcome support. Remote workspace paths grant no local access. |
| Backend config/providers/agents/skills/plugins/reload | Mixed | Corresponding verified backend reads/writes and apply lifecycle. Existing settings files, generated plugins and dispose calls remain OpenCode-only. |
| MCP and credentials/OAuth | Backend-dependent | Explicit catalog/connect/resource/credential/auth operations for that backend. Preserve existing secret ownership; no fallback to OpenCode OAuth. |
| CAgent additional features | Backend-dependent | Registered versioned extension handler, accepted schema/effect/authorization/outcome and supported renderer. New interaction or native privilege becomes `requires-host-development`. |

The machine registry fixes source method coverage. CA-01/CA-02 generate executable feature rules from these semantics and each concrete caller, including conditional operations. Until those rules are executable and verified, all CAgent features remain unavailable. This document does not authorize enabling a grouped feature from a manifest claim.

## Protocol leaks and direct paths

| Evidence | Decision and gate |
| --- | --- |
| 32 SDK-access references and 87 SDK imports in the source inventory | SDK imports can include types and are not all calls. Retain OpenCode adapters; migrate active CAgent consumers. Provider OAuth, `useMcpStore`, session move, sync and Git generation are explicit guard/migration targets in CA-01. |
| `message-queue/runtime.js` fallback `/session/status`, `/session/:id/message`, `/command`, `/session/:id/command`, `/session/:id/prompt_async` | Selected backend dispatcher is mandatory for CAgent. Raw fallback remains OpenCode-only. Block before queue consumption or send. |
| `session-goal/runtime.js` `openCodeFetch` wrapper and `item.raw` message reconstruction | Replace Goal's protocol-shaped reader with domain operations. Do not implement a fake OpenCode HTTP response over CAgent to preserve this wrapper. |
| UI `/api/opencode/runtime`, `/api/sessions/status`, `/api/session-activity` | Separate family-aware identity from generation; host status/activity aggregation requires neutral backend observation. |
| UI `/api/openchamber/sessions/.../metadata`, archive and unarchive | Keep host storage, bind IDs and metadata to backend/workspace ownership, and gate backend writes separately. |
| UI `/api/agent` fallback and config/agent writers | Keep OpenCode-only until backend-neutral catalog/write handlers exist. CAgent cannot reach OpenCode settings files. |
| UI `/opencode/directory` and backend file search | Split local directory creation from backend workspace creation/binding and backend search. Keep `/api/fs/directory-stat` and `/fs/*` host-owned with their current access checks. |
| `kernelOperations` consumers under queue, schedules, assist, goals, routing, notifications, control, context, knowledge, session-work and session-metadata store | Inject the guarded dispatcher into each consumer. Missing optional operations produce blocked actions, not fallback HTTP, empty success or another backend. Descendant activity and PWA reads follow the same rule. |

## Protected boundary and acceptance

The environment-local agent writes only the generated adapter workspace and sanitized operation fixtures allowed by its packet. Shared contracts, operation constants, feature rules, host/UI dispatch code, core tests, reference fixtures and kit runner are maintainer-owned and read-only. CA-02 records file digests and rejects changed protected files or out-of-scope edits independently of adapter commands.

CA-01 must cover this registry with typed operations and guards, preserve OC1/OC2 behavior, and test unsupported direct calls and backend changes before any effects. CA-02 supplies runnable per-operation packets and tests sparse support plus one synthetic extension. CA-03 alone can establish real CAgent support through local API evidence, live outcomes and maintainer activation. Untested hosts and unexamined operations remain unavailable with explicit reasons.
