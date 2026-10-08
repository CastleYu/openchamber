# Shared Agent client

The [Chinese review copy](../../../../../docs/maintenance/zh-CN/CAGENT-UI-CLIENT.md)
is synchronized during review and archived at final handoff.

`client.ts` parses OpenChamber-owned Agent routes and returns operation-specific
contracts. It does not call a CAgent Server API or replace the OpenCode facade.
The host owns adapter loading, credentials, independent approval and dispatch.
The canonical schemas and operation types live in
`packages/web/server/lib/agent`; their browser imports contain no host I/O.

Create one `AgentClient` for the consuming lifecycle and dispose it on teardown.
Its production ports use `runtimeFetch` for current endpoint/auth resolution and
subscribe to endpoint retirement. `inspect()` requires complete runtime and
feature snapshots with matching identities. Carry its returned scope into later
requests. A scope includes a local endpoint revision, so switching A to B to A
still retires old work. Host dispatch independently rechecks backend identity.

Inputs are parsed before transport, outputs before consumption. Authoritative
failures throw fixed `AgentClientError` codes and never become empty success.
Dispatch sends exactly once. Entered writes with lost, malformed or retired
responses report `unknown-outcome`; consumers must retain the original request
ID and use `readAttempt()` instead of automatically replaying. An explicit null
attempt means no ledger record. Historical attempts may have older revisions,
but must match the requested ID, family and connection.

Web, Electron, hosted mobile and Capacitor use their existing HTTP runtime ports.
VS Code keeps the owned-route `unsupported-runtime` refusal until its host is
implemented. App roots now use its protected family selection, but no conversation presentation or existing OpenCode sync consumer uses its operation client yet. Production host
feature support remains absent; this module enables no CAgent feature.

Focused checks use `client.test.ts` and the adjacent runtime-fetch/runtime-switch
tests with Bun. Tests inject transport ports without mocking modules. They cover
request fidelity, complete snapshots, A/B/A retirement, disposal and uncertain
writes. The native startup probe described in `CAGENT-EXECUTION.md` also exercised
this client against the actual loopback server. Both use synthetic adapters and
do not establish real CAgent compatibility.

## Protected family bootstrap

`selection()` reads GET `/api/agent-backend/selection` before a binding is
required. It returns the protected backend family and host selection revision,
plus the client's endpoint scope. Missing, malformed or failed authority throws
a fixed error; callers never infer OpenCode from failure. A/B/A retirement,
caller cancellation and disposal use the same request lifetime as other reads.

This descriptor contains no adapter identity, credentials or feature grants.
An explicitly selected CAgent remains CAgent when adapter loading fails.
`AgentBootstrap` and `BackendGate` choose the family before mounting the lazy
OpenCode application in Web, Electron main/mini-chat and hosted-mobile roots.
Capacitor first reuses native saved-instance connection/authentication through
`MobileBackendGate`. Discovery failure remains retryable and never selects
OpenCode. Endpoint retirement removes the selected application; stale responses
and disposed StrictMode owners cannot restore it. Common appearance settings
and runtime reset remain outside the gate; the gate does not remove every
OpenCode module import. CAgent currently displays an unavailable integration
page, with no conversation or backend actions. All 13 locales include its copy.

A future conversation root must obtain a matching runtime/feature snapshot
before opening. Selection is informational and is not a lease across a later
host change. Same-endpoint family changes require rediscovery; no hot selector
or CAgent native-resume journey is delivered here. VS Code retains its explicit
unsupported response and its existing OpenCode root.

## Neutral conversation state

`AgentConversation` in `conversation.ts` consumes the client directly, without OpenCode wire models. A caller supplies an inspected backend snapshot and explicit opaque workspace/session IDs. Opening verifies returned ownership; history rejects another session's records and duplicate identities. Missing project paths, timestamps, provider/model and usage remain absent. No local directory mapping is inferred.

The controller preserves normalized page order, updates overlapping IDs in place and keeps older loaded records when a partial refresh cannot establish deletion. It does not sort by missing times, infer live execution from history, poll automatically or invent optimistic server messages. Failed loads retain prior data with a distinct failure state. New loads, sends, selection changes and endpoint retirement invalidate obsolete completions. Endpoint retirement synchronously clears visible conversation state, including A/B/A changes.

Before reads or writes it checks the operation and feature snapshot; host dispatch independently rechecks current authority. Send captures its workspace/session and request ID once. Entered writes with unknown outcomes are retained and block another send. `resolve()` consults the durable host attempt ledger without replay; null evidence leaves uncertainty unchanged, and a changed request cannot be overwritten by an earlier lookup. Accepted/complete send receipts do not establish assistant or tool completion. Dispose releases listeners and in-memory state.

`AgentRequestJournal` is an injected durable identity store. A production owner must supply its storage port and an opaque namespace derived from its endpoint/auth runtime identity before constructing the controller. Never use a raw URL or credential as that namespace. No application mounts this store yet. Without injection, continuity remains limited to the controller's lifetime.

With a journal, send records family, connection, workspace, session and request ID synchronously before dispatch; failed persistence prevents transport. It stores no prompt, credential or wire payload. Each request has an independent versioned strict-schema record, bounded to 16,384 UTF-16 code units, with IDs bounded to 1,024 and namespace to 128. Storage failure and corrupt records are explicit errors. Reads examine only the requested owner; corruption cannot block another session. Records have no automatic eviction. Multiple instances preserve distinct request records; this is not a cross-window send lock.

Reopening a controller restores unresolved records as unknown and blocks new sends. Matching authoritative accepted/complete/not-sent evidence clears only its request; another pending request remains unknown. Failed cleanup keeps uncertainty and the record. A host duplicate also keeps uncertainty until the prior outcome is queried. A pre-transport cancellation removes its known-unsent marker. Request identity continuity does not infer live activity or assistant completion. The future app owner must keep its namespace stable across reload and isolated across runtime identities, and expose recovery errors without deleting uncertain records.

Web, Electron, hosted mobile and Capacitor can use this shared state controller. VS Code retains the owned-route refusal. No app mounts it yet, and host support remains unavailable until presentation, observation strategy and all recorded feature consumers pass their gates. These synthetic state tests are preparation for actual chat integration, not CAgent or UI acceptance.
