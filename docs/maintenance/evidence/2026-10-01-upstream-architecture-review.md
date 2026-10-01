# Upstream intake architecture review

Source review on 2026-10-01. Personal baseline `0e735328b`, reviewed comparison `v2.0.1`, target `1ac782ef6c8a718cf0fdf66306269a25718ad7c7`. DIJIANG `featureVersion` remains `4.0`. This review makes no runtime or test-pass claim.

## Integration decision

Apply and adapt the comparison-to-target content delta on the retained personal tree. Keep the current UI protocol facade, `v1`/`v2` implementations, server `kernel-operations.js`, generation descriptor, config ownership and epoch checks. Bring the new upstream owning modules across together with their actual consumers. Review automatic merges at these boundaries as carefully as conflicts.

A whole upstream-tree replacement followed by restoration of selected OC1 files is the worse practical choice. The current protocol behavior spans callers, sync, autonomous server features, configuration and native hosts. Restoring only the client or kernel operations cannot restore it. The ordinary merge base between personal and target is `0af1eb00cacee54492295935549c513af614a5ac`, not the reviewed v2.0.1 comparison. An ordinary merge therefore includes earlier semantic changes that were deliberately adapted or removed.

A three-way application of the v2.0.1-to-target patch preserves personal files untouched by that delta and can be a useful mechanical starting point. It cannot establish parity or OC1 preservation. The delta contains 1,326 files including media and documentation. The packages delta excluding Markdown and `*.test.*` contains 736 files, 57,922 insertions and 11,824 deletions. These counts describe review scope, not effort. Prior deferred ledger entries must be reconciled separately; a recent delta cannot complete an older missing feature automatically.

## Priority 0: permission policy and persistence

Own the combined change in:

- `packages/web/server/lib/permission-auto-accept/runtime.js` and new `modes.js`.
- `packages/web/server/lib/routing/runtime.js`, `store.js`, `classifier.js`, `jev.js` and `routes.js`.
- `packages/ui/src/stores/utils/permissionAutoAccept.ts`, `permissionStore.ts`, `sync/event-pipeline.ts`, `sync/vscode-permission-auto-accept.ts` and permission composer/settings controls.
- `packages/web/server/index.js` for composition and notifications, and existing VS Code boolean bridge consumers.

Latest upstream has explicit `ask`, `safety`, and `auto` policies. `safety` replies only after an `accept` classification. Missing or failed classification holds for the user; `auto` skips classification. The current routing runtime explicitly accepts after classification failure and retains the older global safety switch. This is an observable policy change. Select the old evaluator for OC1 and the new mode evaluator for OC2.

Upstream reuses `permissionAutoAccept.sessions`, converts persisted booleans to strings and immediately saves the conversion. `true` becomes `safety` when the legacy safety switch was enabled, otherwise `auto`. The current reader accepts only boolean entries. Blind migration would both change OC1 behavior and make rollback discard policy entries. Keep the OC1 boolean record intact and give OC2 modes an explicit persistence owner, or implement a generation-aware record that preserves both representations. Do not infer policy from session IDs alone. Default modes apply only to newly created root sessions, while children inherit explicit parent policy.

The current permission runtime captures generation, endpoint and epoch, clears its runtime caches and passes replies through `kernelOperations.replyPermission`. Upstream sends directly to `/api/session/:sessionID/permission/:id/reply` with `decision: 'once'`. Retain the local identity guard and operation dispatch. OC1 still uses its own reply route and body. New held/replied outcome caches must be cleared on runtime changes as well. Keep held requests eligible for user notifications; the legacy `sessions: true` projection also represents safety mode and cannot alone suppress notifications or authorize a reply.

The classifier adds `classification.json` and `classifier-endpoint.json`; custom endpoint credentials stay in the server-owned file with restrictive mode. Preserve OC1 routing availability, prompt-body model selection and old global-switch behavior. OC2 keeps session model/agent selection, classifier selection, pinned endpoint policy and failure-to-hold semantics. Current `routing/runtime.js` already uses `kernelOperations` and identity checks. Do not replace it with the upstream OC2-only implementation.

## Priority 0: protocol and autonomous callers

Adapt these existing owners rather than replacing their contents:

| Owner | Required treatment |
| --- | --- |
| `packages/ui/src/lib/opencode/client.ts` | Keep facade dispatch. Port synthetic-context IDs, Spaces page marks, directory-scoped active status and provider filtering to the OC2 implementation and suitable shared contracts. |
| `packages/ui/src/lib/opencode/v2/sessions.ts`, `v2/catalog.ts` | Own changed OC2 requests and projections. Keep `v1` semantics intact. Context IDs must be minted before the prompt ID to retain transcript order. |
| `packages/ui/src/lib/opencode/model.ts`, `projection.ts`, `events.ts` | Keep honest shared records and OC1 projection. Upstream `model.ts` uses OC2 wire aliases and cannot replace the personal contract wholesale. New shell signal is live-only. |
| `packages/ui/src/sync/session-actions.ts`, `sync-context.tsx`, `event-pipeline.ts` | Preserve OC1 actions and event ingress while adding OC2 synthetic handling, Space lifecycle callbacks and stream-activity handling. Retain stale-epoch rejection and optimistic rollback. |
| `packages/web/server/lib/opencode/kernel-operations.js`, `proxy.js` | Preserve generation-specific prefix, result shapes and mutation ownership. Add only consumed operations. Space list/event hooks must not change OC1 array or stream contracts. |
| `packages/web/server/lib/session-goal/runtime.js`, `session-assist/runtime.js`, new `session-work/*`, `session-lineage.js` | Latest goal checker and work-classification behavior are changes to existing features. Keep original OC1 decisions, prompts, metadata and lifecycle. Adopt OC2 checks through kernel operations, retaining existing cancellation and child-activity handling. |

Upstream adds goal classifier/small-model audit selection and work-based assist gating. These are not proof that Goal or assist is a new OC2-only feature. OC1 keeps those established features. New capability presentation must not hide the retained implementations.

## Priority 1: enterprise boundary

Upstream `packages/web/server/lib/enterprise-mode.js` owns machine policy, environment fallback, local-only network policy, extension allowance and pinned relay/classifier endpoints. It fails closed on unreadable machine policy. Its `isProviderConnectRequest` recognizes only OC2 `POST /api/integration/:id/connect...` and `/api/experimental/integration/wellknown`. That matcher does not cover retained OC1 auth/provider OAuth paths. Current proxy, for example, explicitly registers `/api/provider/:providerID/oauth/callback`.

If enterprise mode applies while OC1 is selected, enforcement must enumerate the retained provider credential and OAuth mutation routes in `opencode/routes.js`, `proxy.js`, and VS Code bridge handlers. Merely adopting the upstream matcher would leave a bypass. If the feature is OC2-only under the agreed product policy, reject its activation in OC1 rather than advertising enforcement there.

Take the enforcement graph together: `server/index.js`, `opencode/routes.js`, `routing/runtime.js`, `guests/enterprise.js`, `guests/install.js`, `guests/updates.js`, `guests/routes.js`, relay/tunnel, dictation/TTS, notifications, package-manager, `packages/electron/main.mjs` and VS Code host paths. UI policy state is informational. Electron remains an in-process server owner; preserve portable startup and notification-only update policy.

## Priority 1: Spaces

Keep upstream Spaces ownership under `packages/web/server/lib/spaces` and the matching UI modules. The target has an explicit off state where the host, manager, event sources and Docker execution are not started. Preserve that behavior. Gate host construction, startup from saved settings, switch activation and routing on OC2 capability, not only the settings control.

The new `host.js`, `dispatcher.js`, `space-events.js`, `space-sessions.js`, `space-archive.js` and `space-opencode.js` depend on OC2 page, stream and export/import behavior. Archive exports `/api/experimental/session/:id/export` and imports checked records into the host's OpenCode. This cannot silently archive into an OC1 host. Do not add an unrequested OC1 conversion layer.

Shared integration files include `server/index.js`, `opencode/proxy.js`, global event hub, shutdown/HMR ownership and UI sync/client roots. Host global active state does not cover sessions inside a Space. Latest client deliberately queries active state in the Space directory and uses host providers with Space-specific models/defaults. Preserve these distinctions so a host empty snapshot cannot settle an active Space turn. Space events need independent reconnect handling and directory identity. A generation switch must stop the old host routing/event ownership before accepting requests for the next runtime.

## Priority 1: extensions origins and file editors

Adopt SDK and host changes as one contract. Exact owners are `packages/sdk/src/{manifest,parse,frame-policy,file-editor,host,protocol,contract,index}.ts`, `packages/web/server/lib/guests/{catalog,grant-scope,html-styles,enterprise,install,updates,routes}.js`, UI `lib/guests/{file-editor-channel,file-editors,frame-url,useGuestFrameUrl,host-bridge}.ts*`, and `components/views/files/GuestFileEditor.tsx` with its Files-view consumers.

`origins` is a new approved capability with an exact persisted origin list, not a general boolean network permission. `grant-scope.js` requires the stored list to match. The frame policy permits approved origins for data, images, fonts, styles and media, but not remote scripts/workers. Retain that CSP and reapproval relationship in server-served, relay and native frame documents. Enterprise checks treat origins as data egress.

File editors exchange document content, changes and saves through the host channel. Preserve current DIJIANG file-opening/editor choices when adding matching guest editors. SDK manifest adoption alone does not establish a usable editor. Under the requested new-feature policy, capability-gate newly added origins/editor offerings for OC1; keep existing extension behavior and grants. The SDK parser can understand a contribution without activating it on an unsupported runtime.

## Dependencies and acceptance boundaries

The target pins `@opencode/client` and `@opencode/schema` to `2.0.18` in root, UI and web manifests; VS Code pins the client to `2.0.18`. Keep `@opencode-ai/sdk` `1.18.31` for OC1. Update the OC2 pair together and regenerate the lockfile from resolved manifests. Preserve personal build commands and `featureVersion: 4.0`; package version is a separate adoption claim. The upstream web build also adds a heap-size environment assignment, which must retain the existing Windows packaging path.

Acceptance needs generation-switch tests, saved-policy migration/rollback cases, permission classifier failure cases, both reply wire contracts, enterprise mutation denial, Space off/start/switch/archive behavior, origins reapproval/CSP and editor save behavior. Existing dual-kernel tests remain part of the gate. Source inspection here does not replace live kernels, native packaging, Docker acceptance or UI checks. No Docker process was started by this review.

## Target advance during implementation

The official main advanced by nine commits to 201de9de2ca97530aeaf66d24dd727b91d8f107c while implementation was in progress. The intake ledger adds this delta and records its adoption. The retained OC1 core, explicit OC1/OC2 owners, portable default and DIJIANG 4.0 policy stay as reviewed above.
