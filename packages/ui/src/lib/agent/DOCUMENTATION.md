# Shared Agent client

## Finite extension client

`extensions(scope)` parses the protected host's complete action snapshot. It accepts
at most 64 unique actions with strict finite manifests and explicit availability.
A malformed or failed snapshot remains an error. A foreign backend or principal
retires the client, so its response cannot reach the current consumer.

`dispatchExtension(scope, manifest, input)` parses declared context and finite
values before transport. Reads carry no request ID or receipt. Mutations require
one request ID and a matching receipt; observed outcomes require complete. An
accepted-only receipt acknowledges acceptance, not completion. Missing, malformed,
foreign or lost write responses remain unknown and are never replayed. The
supplied manifest only defines parsing. The host independently checks its own
current registration, approval and principal, even for direct client calls.

The shared wire schemas live in `schemas.js`; `extensions.js` owns value parsing.
The browser imports no host loader or extension runtime implementation. Web,
Electron, hosted mobile and Capacitor use existing runtime HTTP/auth ports. VS Code
retains the explicit owned-route unsupported refusal.

`AgentExtensions` owns catalog loading, dispatch and outcome recovery. Its journal
stores only action/request IDs and the backend, principal and declared context.
It records mutation intent before transport; storage failure prevents dispatch.
Global pending writes apply to every conversation, workspace writes to that
workspace and session writes to that session. Relevant uncertainty blocks another
extension mutation while reads remain usable. Outcome lookup checks the original
action and never replays it. Matching accepted, complete or not-sent host evidence
clears only that record. Failed refresh retains prior results and disables new
dispatch until the catalog is read successfully. Retirement clears visible state.

`AgentExtensionsPanel` renders the finite text, number, boolean, choice and list
inputs and text, field or bounded table results. Optional fields require explicit
inclusion. Missing context and unavailable actions disable execution. Results are
rendered as text, never HTML. English and Simplified Chinese labels come from the
manifest; other locales use its English label. Generic controls use all 13 app
locales. The panel receives verified conversation context, including global actions
before binding. Chat activity and uncertainty block extension mutations.

The offline pipeline assembles core and finite extension packets. Production
actions require exact independent approval and a verified current manifest.
Synthetic client, controller and DOM tests do not establish CAgent API compatibility
or native/browser acceptance.

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
feature support registers only the separate page's acquisition, history and prompt
consumers. Their operation dependencies still require independent approval.

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

An asynchronous provider's first resolved credential establishes its comparison baseline. Subsequent changes, including credential removal and return, retire the client when observed during header resolution. Results from replaced providers or older reads with different credentials are refused. This is observation at a request boundary, not background detection or authoritative principal identification.

This event contains no credentials and grants no feature support. URL-auth token refresh alone does not retire the client. The authenticated host runtime attaches an opaque `principalID` to its identity: a trusted client ID or validated password-session cookie becomes `principal-<SHA256>`. The digest contains no raw credential. The host observes cookie changes on the next request, not in the background. There is no account model. Re-pairing creates a new client ID and principal, so it starts a new recovery namespace; the host does not automatically recover the previous device's journal.

`AgentConversation` in `conversation.ts` consumes the client directly, without OpenCode wire models. A caller supplies an inspected backend snapshot and explicit opaque workspace/session IDs. Opening verifies returned ownership; history rejects another session's records and duplicate identities. Missing project paths, timestamps, provider/model and usage remain absent. No local directory mapping is inferred.

The controller preserves normalized page order, updates overlapping IDs in place and keeps older loaded records when a partial refresh cannot establish deletion. It does not sort by missing times, infer live execution from history, poll automatically or invent optimistic server messages. Failed loads retain prior data with a distinct failure state. New loads, sends, selection changes and endpoint retirement invalidate obsolete completions. Endpoint retirement synchronously clears visible conversation state, including A/B/A changes.

Before reads or writes it checks the operation and feature snapshot; host dispatch independently rechecks current authority. Send captures its workspace/session and request ID once. Entered writes with unknown outcomes are retained and block another send. `resolve()` consults the durable host attempt ledger without replay; null evidence leaves uncertainty unchanged, and a changed request cannot be overwritten by an earlier lookup. Accepted/complete send receipts do not establish assistant or tool completion. Dispose releases listeners and in-memory state.

`AgentRequestJournal` is an injected durable identity store. A production owner supplies its storage port and an opaque namespace before constructing the controller. `createAgentChatBinding()` inspects the host identity, then hashes the endpoint runtime key and host principal in memory to form the namespace. It checks retirement and the current runtime key after the asynchronous digest; crypto or storage errors fail explicitly without a memory-only fallback. No raw URL or credential becomes a storage key. A verified client ID remains stable across that client's credential rotation, so its journal namespace remains stable. A new client ID or password session principal gets a separate namespace. Without journal injection, continuity remains limited to the controller's lifetime.

With a journal, send records family, connection, optional host principal, workspace, session and request ID synchronously before dispatch; failed persistence prevents transport. It stores no prompt, credential or wire payload. Each request has an independent versioned strict-schema record, bounded to 16,384 UTF-16 code units, with IDs bounded to 1,024 and namespace to 128. Storage failure and corrupt records are explicit errors. Reads examine only the requested owner; corruption cannot block another session. Records have no automatic eviction. Multiple instances preserve distinct request records; this is not a cross-window send lock. Existing unscoped or credential-derived records remain stored but are not adopted into the principal namespace. Remote CAgent credentials remain protected host connection configuration and do not prove that the remote server enforces per-principal authorization.

Reopening a controller restores unresolved records as unknown and blocks new sends. Matching authoritative accepted/complete/not-sent evidence clears only its request; another pending request remains unknown. Failed cleanup keeps uncertainty and the record. A host duplicate also keeps uncertainty until the prior outcome is queried. A pre-transport cancellation removes its known-unsent marker. Request identity continuity does not infer live activity or assistant completion. Recovery errors never delete uncertain records.

Web, Electron, hosted mobile and Capacitor mount this controller through the CAgent page. VS Code retains the owned-route refusal. Production registers only acquisition, history and prompt support, bound to the current host identity. Other core features remain unmigrated. Synthetic tests do not establish real CAgent acceptance.

## CAgent conversation page

`CAgentApp` owns a binding and disposes it on unmount, including a binding that resolves after cleanup. It binds an existing opaque workspace/session; it does not create a conversation or infer IDs from local paths. Actions use the inspected operation and feature gates. Refresh explicitly reads history and status independently, retaining successful data if another read fails. Status comes only from `getSessionStatus`; failed status is displayed as unknown rather than current prior activity.

Before sending, the page reads status again and dispatches only when that result is idle for its bound conversation. One new request gets one UUID. Unknown outcomes preserve the draft and block another send; result lookup queries the original request without replay. Accepted/complete receipts are presented as acceptance, not assistant completion. Pagination and normalized text, reasoning, structured tool data and attachment labels are supported; no attachment download URL is invented. The finite extension panel uses its own action journal. Decisions, cancellation, creation and core catalogs remain later work. Production host support lists only acquisition, history and prompt; the page additionally requires GET_SESSION to open an existing session, so a create-only adapter cannot open this page. Exact independent operation approval and a durable write ledger remain required. Revocation closes the affected operation on its next host check.
