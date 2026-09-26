# Dual OpenCode integration design

Status: accepted design, implemented on the OC1 core. The adoption ledger records contract and runtime evidence; publication is a separate gate.

## Decision

Start from personal OC1 commit `4ac81115c17c203c89c5b52f93a930af32ea2163`. Preserve its complete behavior while integrating the product changes in upstream OpenChamber `v2.0.1`, commit `63bd5070c8620432817e1e67de77791f801bcf3e`. OpenChamber's tag is not the OpenCode binary version. The final product has one application, two protocol implementations, and deliberate feature behavior for each protocol.

The initial OC1-shaped contract is an integration step, not permission to stop with an old UI that merely connects to OC2. Completion includes the upstream feature inventory, with changed existing functionality retaining its OC1 behavior and genuinely new OC2 functionality disabled on OC1. Queue, scheduled tasks, assist, goals, questions, fork, compaction, statistics, memory, MCP, skills, and DIJIANG remain baseline functionality.

Use the existing module boundaries. Add protocol implementations only where requests, events, persistence ownership, or behavior differ. Keep shared presentation, scheduling, persistence of OpenChamber-owned records, and native transport single-owned. Do not introduce another service or copy either repository.

The current skills describe an OC2-only product. The explicit dual-kernel request supersedes that assumption; implementation must update the canonical instructions when the boundary is implemented. Preserve their transport, parsing, ownership, and runtime-switch rules.

## Source findings that constrain the design

* OC1 `lib/opencode/client.ts` returns SDK1 types directly and exposes `getSdkClient()` and `getScopedSdkClient()`. Bootstrap, sync, global sessions, multirun, provider settings, OAuth, and all app roots consume these. Swapping this file alone cannot implement dual APIs.
* Upstream `model.ts` preserves message/part store layout, but aliases provider, model, config, permissions, status, and other records to OC2 wire types. Importing it wholesale is not a protocol-neutral contract.
* Upstream `projection.ts` and `events.ts` already own OC2 message projection and deterministic part identities. Keep their naming and algorithms where adopted. Share their projection between HTTP history and streaming.
* Server queue, assist, and goal runtimes issue OpenCode requests independently of the browser. Both versions must work when no UI is open.
* OC1 configuration uses deferred apply/restart and file credentials; upstream uses changed entity schemas, watched plugin directories, and credential database ownership. These are behavior differences, not just route prefixes.
* `git diff --shortstat` across UI, web, VS Code, and Electron reports 1,243 changed files, 70,871 additions, and 49,586 deletions between the supplied commits. This includes product evolution and personal changes. It is neither an implementation estimate nor evidence that all those files require a compatibility adapter.

## Concrete boundaries

### UI OpenCode operations

Keep `lib/opencode/client.ts` as the existing caller-facing service. Move actual OC1 protocol operations to `lib/opencode/v1/` and introduce `lib/opencode/v2/` using upstream request and projection code. Keep runtime fetch, error propagation, directory identity, and endpoint lifecycle owned once. Avoid two copies of the whole service, including filesystem and attachment utilities.

Define a small explicit operation contract based on inventory consumers. It needs sessions and message pages, prompts, stop, fork/revert/compact, permission/question or form operations, provider/config catalog operations, and bootstrap data. Do not recreate either generated SDK as a generic facade. Replace direct SDK access at its actual consumers with these operations. No `SDK1 | SDK2` escapes into stores or components.

The shared session/message/part contract initially preserves the OC1 consumer layout. Adopt upstream names and new fields where they are semantically shared. Do not invent zero cost, token counts, fabricated timestamps, IDs, or permission meanings merely to satisfy a type. Missing upstream-only information stays absent and the corresponding display is capability-driven.

Catalog/config types require a separate decision for each inventory row. Preserve a shared value only where its meaning matches. Use explicitly tagged OC1/OC2 records for genuinely different permission rules, forms/questions, and editable config. Keep version-specific editors or action handlers local to their owning feature; share surrounding layouts and navigation. The adapter must not flatten advanced OC2 forms into an OC1 question and lose behavior.

### Event and sync boundary

Keep child-store scheduling, global indices, optimistic reconciliation, runtime switching, and message loading shared. OC1 retains its original event decoding and recovery meaning. OC2 adopts upstream event decoding/projection and resume behavior. Each publishes typed domain mutations into the existing reducer/store boundary. Where upstream already uses a compatible mutation shape, reuse it.

Do not translate OC2 raw JSON into a fictitious SDK1 event stream. In particular, session events, message content replacement, delta addressing, permission resolution, and form lifecycle need typed operations with honest semantics. HTTP history and events must construct the same part identity. The event transport owns reconnect; a protocol implementation owns what resumption means for that protocol.

### Server operations

Add focused protocol operations inside `packages/web/server/lib/opencode/`, selected during runtime composition. Existing queue, scheduled tasks, assist, goals, activity probes, notifications, and memory call those operations for session reads, message tails, prompt dispatch, mutation, and status. Keep each feature's decision-making and OpenChamber record persistence in its current module.

Keep the public `/api` OpenChamber route tree. Explicit OpenChamber routes retain precedence over generic forwarding. The proxy selects the actual upstream prefix and forwards faithfully; it does not become a second full protocol conversion engine. Browser protocol adapters and server internal operations use the same resolved runtime generation. Version checks belong at those entry boundaries, not throughout feature functions.

Maintain OC1 config/auth/plugin implementations alongside the specific OC2 alternatives. Shared file utilities may remain shared. OC1 retains its original save/apply/restart behavior; OC2 uses its watched config semantics. Select the plugin generator, auth owner, and lifecycle path before any write. Automatic OC2 migration/top-up must never execute while OC1 is selected. Storage roots and session IDs must not imply interchangeability between kernels.

### Runtime identity and selection

Resolve one generation descriptor per active endpoint/epoch before bootstrap. Use explicit generation and capabilities, not UI-owned guesses. Unsupported/unreachable/unknown remain different outcomes; failed probing must not silently choose OC1. Ignore OC1 minor-version branching during design, as requested. The maintainer subsequently authorized the currently available OC1 runtime for this delivery; 1.2.27-specific execution is deferred and is not a release gate.

A changed endpoint or generation invalidates clients, in-flight result authority, stream, stores, and protocol-scoped caches through the existing switch flow. Resolve URLs and credentials at call time. Keep the descriptor scoped to runtime identity rather than a process-global mutable mode that a second window can overwrite.

| Runtime | Intended behavior |
| --- | --- |
| Web | Server resolves generation; UI and autonomous server features use it. |
| Electron | Reuse in-process web backend; native shell passes selected binary/runtime identity and does not implement the protocol again. |
| VS Code | Extension host resolves generation; webview operations, dedicated message/SSE bridges, config and credential handlers use it. |
| Hosted mobile | Same remote server descriptor and adapters as web. |
| Capacitor | Connection selection happens before descriptor resolution; reconnect and switching clear the previous descriptor. |

## Work allocation after inventory approval

The lead owns operation names, shared contracts, composition, package dependencies, and integration. Lock those contracts before parallel edits.

| Group | Exclusive implementation ownership | Depends on |
| --- | --- | --- |
| Contract and composition | runtime descriptor/capabilities; UI operation/model contracts; server operation contracts; manifests and lockfile | Reviewed API and feature inventory |
| UI protocol | `lib/opencode/v1`, `v2`, facade and direct SDK callers outside sync | Frozen contracts |
| Event and sync | `sync` protocol ingress, bootstrap/message loaders, event projection ownership | Frozen contracts and UI operation signatures |
| Autonomous server | queue/scheduler/assist/goal/activity integrations and server protocol operation implementations | Frozen contracts |
| Configuration and platform | config/auth/plugin version implementations; VS Code/native integration | Descriptor, server and UI contracts |
| Upstream product integration | Upstream feature components/settings and DIJIANG reconciliation, grouped by exclusive feature directories | Inventory classifications and capabilities |

Some caller files overlap product integration. Assign each such file to one agent and have other groups request a change through that owner. Do not let multiple agents edit app roots, `client.ts`, `model.ts`, package manifests, or server composition simultaneously.

Merge order: baseline restoration and ledger; shared descriptor/contracts; OC1 extraction with behavior retained; OC2 operations and event path; server autonomous operations; config/auth/plugins/platform; complete upstream feature integration and OC1 policy gates; DIJIANG reconciliation; final integration evidence. OC1 extraction is not delivery completion. Validation details belong to the lead's separate acceptance plan.

## Keeping future upstream updates manageable

Track content adoption independently of Git ancestry. The existing personal branch already contains OC2 merge history; restoring OC1 with a new reviewed commit preserves that history but does not mean those OC2 behaviors are active.

Maintain one adoption ledger keyed by upstream range and feature/API contract. Each record names upstream source paths or symbols, current local owner, OC1 policy, OC2 policy, adopted commit/blob, and evidence status. Allowed states should distinguish adopted unchanged, adapted, intentionally OC1-preserved, intentionally unsupported on OC1, and still pending. Every inventory row must have an owner and final state.

For each update, compare upstream pinned content with next upstream content first. Then map changed paths and API symbols through the ledger. Changes in adapters need both protocol reviews; changes in shared UI require field and capability review; changes in server autonomous behavior require both runtime owners. Additions under API-facing directories cannot silently disappear because an older merge commit is already an ancestor.

Preserve upstream file names and exports where practical. Keep original OC1 behavior in clearly owned version modules; avoid prefixing or renaming every shared file. No formatting sweeps. Record local protocol transformations beside their upstream source identity so reviewers can compare small source ranges.

Measure maintenance with changed shared files, version-specific code size, conflict files on a sample update, and unclassified inventory rows. Do not promise a small numeric diff before implementation. Narrow boundary changes reduce repeated reasoning, but adopting all 2.0.1 product changes still requires a broad one-time integration.

Promotion to the personal branch should be explicit reviewed restoration/reversion commits followed by the dual integration commits. Retain existing history. Do not reset published history or claim an already merged OC2 ancestor as proof of content adoption.

## Decisions and risks for lead review

The inventory must settle exact canonical operation signatures and which upstream additions require local version-specific presentation. It must also settle ownership for every server-side OpenCode call, not only the UI client. A full generic SDK abstraction would increase work and diff; an incomplete facade would let version checks leak into every consumer.

The largest semantic risks are message/part identity, reconnect authority, question/form and permission differences, autonomous prompt behavior, and config/auth/plugin writes. The largest maintenance risk is freezing the whole old product while calling OC2 connectivity complete. The largest data risk is allowing generation selection to reuse another generation's persisted ownership or migration lifecycle.

This document is source-backed design, not runtime proof. Existing OC1 minor-version support is deliberately not inferred from SDK names or from preservation of old source.

## Command observation

2026-09-26: reading `packages/ui/README.md` in the upstream comparison checkout failed because that optional package README does not exist. Check existence or discover optional documentation before reading it. The web package README and module documentation were available. No code command or implementation test was run.
