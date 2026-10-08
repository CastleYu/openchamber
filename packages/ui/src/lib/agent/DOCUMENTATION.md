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
implemented. No UI or sync consumer uses this client yet. Production host
feature support remains absent; this module enables no CAgent feature.

Focused checks use `client.test.ts` and the adjacent runtime-fetch/runtime-switch
tests with Bun. Tests inject transport ports without mocking modules. They cover
request fidelity, complete snapshots, A/B/A retirement, disposal and uncertain
writes. The native startup probe described in `CAGENT-EXECUTION.md` also exercised
this client against the actual loopback server. Both use synthetic adapters and
do not establish real CAgent compatibility.
