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
subscribe to endpoint and configured authentication retirement. `inspect()` requires complete runtime and
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
implemented. App roots use protected family selection and the separate CAgent conversation page consumes this client. Existing OpenCode sync consumers remain separate. Production host
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
OpenCode module import. CAgent mounts its own conversation page with capability-gated actions. All 13 locales include its copy.

The conversation root obtains a matching runtime/feature snapshot
before opening. Selection is informational and is not a lease across a later
host change. Same-endpoint family changes require rediscovery; no hot selector
or CAgent native-resume journey is delivered here. VS Code retains its explicit
unsupported response and its existing OpenCode root.

## Neutral conversation state

Configured bearer, credential-provider or extra-header changes synchronously retire the production Agent client, abort pending requests and clear its conversation. Old scopes refuse dispatch even when the endpoint is unchanged. Entered writes retain their journal markers for later outcome lookup; retirement never replays a mutation. Binding creation also rejects any retirement during namespace hashing or inspection, including A/B/A changes.

| Runtime | Authentication retirement |
| --- | --- |
| Web | Shared Agent client clears the CAgent conversation. |
| Electron | Main and mini-chat use the shared client. |
| Hosted mobile | Shared client behavior applies. |
| Capacitor | Configured native HTTP credentials use the shared client. |
| VS Code | Owned Agent routes remain unsupported; this adds no CAgent host. |

This event contains no credentials and grants no feature support. URL-auth token refresh alone does not retire the client. Changes outside the configured setters, such as cookie-only account changes or an asynchronous provider returning a different principal, need host identity support. Credential rotation still changes the journal namespace; this change does not provide cross-rotation recovery.

`AgentConversation` in `conversation.ts` consumes the client directly, without OpenCode wire models. A caller supplies an inspected backend snapshot and explicit opaque workspace/session IDs. Opening verifies returned ownership; history rejects another session's records and duplicate identities. Missing project paths, timestamps, provider/model and usage remain absent. No local directory mapping is inferred.

The controller preserves normalized page order, updates overlapping IDs in place and keeps older loaded records when a partial refresh cannot establish deletion. It does not sort by missing times, infer live execution from history, poll automatically or invent optimistic server messages. Failed loads retain prior data with a distinct failure state. New loads, sends, selection changes and endpoint retirement invalidate obsolete completions. Endpoint retirement synchronously clears visible conversation state, including A/B/A changes.

Before reads or writes it checks the operation and feature snapshot; host dispatch independently rechecks current authority. Send captures its workspace/session and request ID once. Entered writes with unknown outcomes are retained and block another send. `resolve()` consults the durable host attempt ledger without replay; null evidence leaves uncertainty unchanged, and a changed request cannot be overwritten by an earlier lookup. Accepted/complete send receipts do not establish assistant or tool completion. Dispose releases listeners and in-memory state.

`AgentRequestJournal` is an injected durable identity store. A production owner supplies its storage port and an opaque namespace before constructing the controller. `createAgentChatBinding()` hashes the endpoint key, bearer and extra headers in memory and supplies browser storage. It rechecks this scope after inspection; unavailable crypto/storage fails explicitly without a memory-only fallback. No raw URL or credential becomes a storage key. Cookie-only principal changes are not represented by this digest; account-level isolation is not established for that case. Without journal injection, continuity remains limited to the controller's lifetime.

With a journal, send records family, connection, workspace, session and request ID synchronously before dispatch; failed persistence prevents transport. It stores no prompt, credential or wire payload. Each request has an independent versioned strict-schema record, bounded to 16,384 UTF-16 code units, with IDs bounded to 1,024 and namespace to 128. Storage failure and corrupt records are explicit errors. Reads examine only the requested owner; corruption cannot block another session. Records have no automatic eviction. Multiple instances preserve distinct request records; this is not a cross-window send lock.

Reopening a controller restores unresolved records as unknown and blocks new sends. Matching authoritative accepted/complete/not-sent evidence clears only its request; another pending request remains unknown. Failed cleanup keeps uncertainty and the record. A host duplicate also keeps uncertainty until the prior outcome is queried. A pre-transport cancellation removes its known-unsent marker. Request identity continuity does not infer live activity or assistant completion. The current namespace remains stable only while endpoint and credential inputs remain stable; credential rotation changes it. Recovery across rotation and cookie-only principal separation need identity support before production activation. Recovery errors never delete uncertain records.

Web, Electron, hosted mobile and Capacitor mount this controller through the CAgent page. VS Code retains the owned-route refusal. Host support remains unavailable until presentation, observation strategy and all recorded feature consumers pass their gates. Synthetic tests do not establish real CAgent acceptance.

## CAgent conversation page

`CAgentApp` owns a binding and disposes it on unmount, including a binding that resolves after cleanup. It binds an existing opaque workspace/session; it does not create a conversation or infer IDs from local paths. Actions use the inspected operation and feature gates. Refresh explicitly reads history and status independently, retaining successful data if another read fails. Status comes only from `getSessionStatus`; failed status is displayed as unknown rather than current prior activity.

Before sending, the page reads status again and dispatches only when that result is idle for its bound conversation. One new request gets one UUID. Unknown outcomes preserve the draft and block another send; result lookup queries the original request without replay. Accepted/complete receipts are presented as acceptance, not assistant completion. Pagination and normalized text, reasoning, structured tool data and attachment labels are supported; no attachment download URL is invented. Decisions, cancellation, creation, catalogs and CAgent extensions remain later work, so production feature support stays closed.
