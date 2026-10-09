# OpenCode 1.2.27 Legacy specification

Status: exact source/schema acquired, 2026-10-09; executable acceptance remains open. See the [Legacy evidence checkpoint](OPENCODE-LEGACY-EVIDENCE.md).
Parent: [OpenCode integration specification](OPENCODE-INTEGRATION-SPEC.md).

## Compatibility promise

Provide a dedicated `Legacy 1.2.27` profile for installations that cannot upgrade OpenCode. It is selected automatically from verified server identity or manually by the user. Every OpenChamber operation that touches OpenCode uses this profile's contract, including browser requests, server jobs, events, config/auth/plugin writes and host bridges.

The existing OC1 adapter and its newer-runtime tests are a starting implementation, not 1.2.27 acceptance. Earlier documents deferred exact-version testing for the initial dual-kernel delivery. This milestone supersedes that deferral only for its Legacy deliverables: they cannot be accepted on tests against a newer OC1 binary. OC1 and OC2 remain supported and retain their regression gates.

The profile covers all OpenCode-facing operations consumed by OpenChamber, not every unused endpoint in the OpenCode product. The inventory must include dynamically assembled requests and injected plugin calls. OpenChamber-owned filesystem/Git routes retain their own contracts; any OpenCode interaction within them still uses the selected profile.

## Selection and identity

Persist the requested selection separately from the resolved profile. The choices are Auto, OC1, OC2 and Legacy 1.2.27. Expose detected version, selected profile, version provenance and any verification limitation in connection settings.

| Requested selection and evidence | Result |
| --- | --- |
| Auto; verified stable version 1.2.27 | Resolve OC1 generation and Legacy profile before any feature request. |
| OC1; verified stable version 1.2.27 | Resolve Legacy within OC1. Selecting the generation cannot bypass exact-version adaptations. |
| Auto/OC1; another supported OC1 version | Use the existing OC1 profile and its explicit capabilities. Do not claim Legacy acceptance. |
| Auto/OC2; supported OC2 version | Use OC2. Preserve current minimum-version and capability checks. |
| Legacy; verified stable version 1.2.27 | Select Legacy and verify its read-only contract checks. |
| Legacy; version absent but endpoint responds | Permit an explicit manual declaration only after the Legacy read-only contract checks pass. Mark the version user-declared/unverified; never call this automatic detection or exact-version acceptance. |
| Explicit selection contradicts reported version or contract | Show a mismatch and require correction; do not switch profiles automatically. |
| Auto; version absent, contradictory probes, auth failure or unreachable server | Distinguish these states and request correction/manual selection. No profile is guessed from a failed SDK call. |

Normalize a leading `v` and build metadata for exact stable-version comparison. A `1.2.27` prerelease or fork with incompatible behavior is not automatically treated as the tested stable build. Record and verify that fork separately. Probe candidates only on the selected endpoint; connection discovery must not search for another server.

The existing health/info probe owner must define the Legacy read-only check set from verified 1.2.27 evidence in milestone INT-00L, the Legacy-specific preflight. Checks exercise available identity/catalog/read contracts without creating sessions, disposing instances or writing configuration. Health alone is insufficient when the endpoint cannot report a version. Authentication failures are surfaced before a manual override can be considered usable.

For owned processes, compare the selected executable's version with the responding endpoint. Do not load modern-only plugins before this resolution. For external servers, remote identity is authoritative; a locally installed CLI does not prove the remote version. Choosing Legacy never downloads, replaces or downgrades a binary.

Selecting another profile at the same URL increments the runtime epoch. Capture profile/epoch for every request, queued send, event stream and delayed write. Retire old clients, stop old subscriptions and reject stale completions. A backend switch must not silently convert work queued under another profile.

## Operation ownership

Place Legacy-specific codecs and operation implementations under the existing OC1 UI and server boundaries. Reuse an existing OC1 operation only after verifying that its request and response contracts match 1.2.27. Do not clone the entire OC1 service or spread version comparisons through UI components.

Use the official SDK through a narrow compatible wrapper where it preserves the verified request. When a current SDK emits a newer shape, use an explicitly documented SDK-gap/version wrapper at the same boundary. Record method, path, headers, query, body, error and cancellation behavior. A type assertion against current SDK declarations does not establish an old server contract.

Capability outcomes are supported, adapted, or unsupported, with evidence and a reason. A not-yet-verified operation remains blocked for the experimental profile rather than being sent through modern OC1 by default. Unsupported calls fail at the service/host boundary before network or filesystem side effects, including callers that bypass UI controls.

Full Legacy acceptance requires the baseline user journeys below. A capability label cannot be used to discard core chat, permissions/questions, stop, history or the existing automation features. If evidence proves a requested feature impossible on 1.2.27, record the concrete limit and resolve its product disposition before accepting that milestone.

## Required operation ledger

INT-00 expands each group into individual consumed methods/events and records evidence gaps. Each implementation milestone adds its exact request/response fixtures and positive/failure tests to the rows for its consumers and owner. The historical interface IDs are cross-references, not exact-version proof. INT-00L owns the Legacy read-only preflight and exact-version contract evidence.

| Group | Coverage and existing inventory | Legacy completion evidence |
| --- | --- | --- |
| L01 Identity and transport | Health/version, directory/project/path/VCS, auth, proxy prefix, base path, headers, abort and timeout; UI-01/17, HTTP-01/02/03 | Exact read responses; authenticated and unauthenticated behavior; correct directory scope and proxy forwarding. |
| L02 Sessions and history | List/get/create/update/delete/archive, children, metadata, message/part reads and paging; UI-02/03, HTTP-04/10/11 | Real stored session round trips; missing fields are absent rather than fabricated; failure is distinct from empty history. |
| L03 Prompt and activity | Prompt async, attachments, model/agent choice, busy/retry/idle, interrupt and completion; UI-04/06/11 | Accepted request is distinct from completed turn; actual tool/text stream, stop and terminal state agree. |
| L04 Commands and shell | Command catalog/dispatch, shell input/output and errors; UI-05 | Capture actual shell response shape before projecting it; preserve output and message identity. |
| L05 Session operations | Fork, compact, diff, revert/unrevert, todo, file discovery and supported move operations; UI-07/08/09/10/16 | Before-message boundaries, full diff content and recovery are verified; new-only operations are explicitly gated. |
| L06 Human decisions | Permission list/reply, rule persistence where supported, question list/reply/reject; UI-12/13 | Real delivery, answer, failure and reconnect cases; no fabricated request IDs, form fields or automatic acceptance on parse failure. |
| L07 Catalogs and settings | Providers/models/defaults, agents, commands, skills, config read/write; UI-14/18/19, CFG-01/02/03 | Exact config schema and credential owner; read-after-write and apply outcomes; unsupported fields refused before save. |
| L08 MCP and plugins | MCP status/connect/disconnect/auth, tools, plugins and generated hooks; UI-15, CFG-04 | Exact plugin API/config compatibility and real MCP lifecycle; no unverified newer plugin is injected. |
| L09 Session events | Session lifecycle/status/error, messages/parts/tools, ordering and identity; EV-01/02/05/06 | HTTP history and SSE give consistent IDs and completion; malformed/partial events trigger scoped recovery. |
| L10 Decision and feature events | Permission/question events, catalog/MCP/usage changes and added vocabularies; EV-03/04/07 | Recover actual pending items; map only supported vocabulary, retain honest unavailable state for absent metrics. |
| L11 Autonomous features | Queue, scheduled tasks, assist, goals, routing, memory/knowledge, notifications, multi-run and generated helper tools; HTTP-06/07 and all current direct callers | Run with UI closed; prompt/metadata/status use Legacy; apply the dispatch result contract below and test normal send, ambiguous outcomes, restart and duplicate triggers. |
| L12 Reload and runtime management | Directory/global dispose, readiness, shutdown, managed launch, upgrade eligibility; HTTP-08, CFG-02 | Verified dispose scope and recovery; only owned process trees stopped; Legacy upgrade is disabled unless separately chosen outside the compatibility promise. |
| L13 Credentials and OAuth | Provider and MCP auth requests/callbacks, redirects, persisted secrets, explicit auth configuration; HTTP-09, UI-18 | No newer credential database assumption; correct callback routing and secret ownership on the actual version. |
| L14 Host bridges | Web proxy, dedicated VS Code message/SSE, Electron in-process backend, hosted/Capacitor mobile; CFG-05 | Same selected profile reaches all entrypoints; no raw OC1 escape in a bridge bypasses Legacy. |
| L15 Newer product capabilities | Current Stats, server metadata, advanced queue/steer/admission, staged revert, PTY and message indexing consumers; UI-16/20 and post-inventory additions | Explicit per-operation supported/adapted/unsupported decision. API novelty alone does not justify removing a pre-existing user feature. |

A release ledger is complete only when every consumed operation maps to one of these groups and has its own disposition. Existing direct SDK escapes, package imports and generated source require a second manual pass after mechanical extraction.

## Contract acquisition and uncertainties

Pin the exact upstream 1.2.27 source/schema and an actual 1.2.27 executable with origin and digest. Capture sanitized requests, responses, failure envelopes and SSE from an isolated data directory. Preserve raw field structure, status codes and ordering while removing credentials and user content. Link samples to the executable identity and reproduction command.

This planning run did not start 1.2.27 or retrieve a usable pinned schema. The official raw OpenAPI URL returned a cache miss. Do not fill missing contracts from modern OC1 typings. The following are verification questions, not established incompatibilities:

- Whether shell returns a bare message or a message/parts envelope.
- Whether diff data contains before/after text, patch text, or multiple variants.
- Whether validation errors use a success/data/errors envelope or another shape.
- Which permission/question fields and event payloads are actually present.
- Whether replay identifiers exist and whether resumption guarantees ordering.
- Whether the server supports idempotency keys and their retention period, or reliable lookup of a request's result by request ID.
- Which disposal methods/scopes exist, their response shape and config-apply effect.
- Which metadata, plugin, OAuth, model-selection and newer operation fields the old binary accepts.

The evidence source order is exact-version server/source/schema, then executable samples and regression fixtures. A fixture derived only from modern SDK types is not an exact-version reference.

### Dispatch result contract

Before submitting a dispatch, persist its intent and attempt through the existing owner. Track `pending`, `accepted`, `unknown`, and terminal `completed` or `failed` outcomes. Reuse the existing queue/task owner; do not add a separate dispatch engine.

If the server accepts a request but its response is lost, or the client crashes during submission, recover the attempt as `unknown`. Do not resend it automatically or report success or failure. Automatic reconciliation requires a reliable request-ID result query. Automatic resubmission requires exact 1.2.27 evidence of an idempotency key still within its retention period, or an authoritative query proving the original was not accepted and cannot execute later. An absent query result alone is insufficient. Time or text matching alone cannot establish whether a request ran.

Without that evidence, keep the affected task available for inspection, waiting, or an explicit user resubmission. Before resubmission, tell the user that the original may already have run and that repeating it may duplicate side effects. Let unrelated tasks continue. Test normal single dispatch, accepted request with lost response, crash during send followed by restart, repeated triggers, and any proven server deduplication behavior. Do not claim exactly-once delivery without evidence that establishes it.

## Recovery, config and storage

Do not assume SSE replay. Implement the recovery behavior established by exact-version evidence; when replay is absent or incomplete, reconcile scoped messages, status and pending permissions/questions through authoritative reads. Coalesce recovery per active directory/session, preserve successful unrelated scopes and reject stale epochs. A failed recovery cannot clear pending approvals or declare a busy session idle.

Derive completion from actual terminal message/state evidence. HTTP acceptance, an empty delta, disconnect or elapsed time cannot finish a turn. Normalize known error shapes at the profile boundary and preserve actionable messages without leaking sensitive payloads.

Use only config fields, credentials and plugin hooks verified for 1.2.27. Keep external configuration ownership explicit: do not write a local config file and claim the remote server has applied it. Unsupported remote config writes return an actionable limitation. Local managed Legacy data uses a version/profile-owned scope where modern/OC2 migrations could alter compatibility. Existing external paths remain user-owned; no automatic cross-profile data migration.

OpenChamber may store its own supplementary metadata only through an explicit owned record and a tested round trip. Do not imply that the old server persisted fields it ignored. Protect existing data before enabling a newer runtime against the same store; profile switching is not a database downgrade strategy.

Apply reload under the [integration dispose contract](OPENCODE-INTEGRATION-SPEC.md#33-reload-and-dispose): directory-scoped disposal is the default for directory changes, and global disposal requires a change whose scope needs it plus a deliberate user action. If only global disposal exists, expose its scope and activity impact before execution. A directory reload must report unsupported rather than silently broadening to global scope.

## Acceptance matrix

| Gate | Required evidence |
| --- | --- |
| Exact identity | Real stable OpenCode 1.2.27 version, executable/source origin and digest; automatic selection and manual selection exercised separately. Manual unverified mode cannot satisfy this gate. |
| Core conversation | Connect, list/create/open history, text and attachment prompt, tool activity, permission/question reply, stop, command/shell, fork/compact/diff/revert, completion and reopen. |
| Failure and recovery | Wrong credentials, unavailable server, malformed response/event, interrupted stream, server restart, pending decision recovery and stale results from a profile switch. |
| Unattended operation | Queue and scheduled prompt plus assist/goal behavior with UI closed; dispatch intent and attempt persist; ambiguous outcomes remain unknown without proven deduplication/result lookup; metadata/state persists correctly. Test normal single dispatch, accepted-but-unanswered requests, crash and restart during send, repeated triggers, and verified deduplication behavior. |
| Settings and lifecycle | Provider/agent/MCP/skill/config writes where supported, generated plugin loading, disposal/apply, owned startup/quit and external ownership. |
| Isolation | Legacy ↔ current OC1 ↔ OC2, including same endpoint reused with a new profile; separate session/cache/auth scope, no accidental migration or cross-profile write. |
| Hosts | Real web and Windows portable flows, VS Code bridge/runtime checks, hosted mobile and Capacitor connection journeys. Explicitly record native platforms not exercised; untested host rows remain open. |

A milestone can land an internal experimental profile while later groups remain disabled. A release must not advertise full Legacy support until every required group and host gate is accepted or the maintainer explicitly narrows that release's promise. A missing 1.2.27 executable/endpoint blocks exact-version acceptance, not completion of these planning documents.
