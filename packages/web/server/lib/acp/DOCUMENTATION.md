# ACP stdio owner

`runtime.js` owns the selected child process, ACP v1 JSON-RPC requests, transcript,
session loading, cancellation and pending permissions. `routes.js` publishes
OpenChamber domain records and SSE facts under `/api/acp`; authentication and
connection selection are enforced by the server before these routes.

The shared UI uses `lib/opencode/acp.ts` through `opencodeClient` and `SyncSource`.
ACP events use the domain reducer. Reconnect sends a complete transcript snapshot
with a fresh unique ID for each fact through the shared authenticated SSE transport.

Prompt text and accepted file links use message-scoped part IDs shared with the
optimistic UI, so live facts replace those parts in place. Accepted attachments
remain in the saved transcript. The runtime saves a new turn before publishing
its message facts or sending the agent request. A failed save rolls back that
unsent turn, returns the session to idle, and leaves later saves available.

Agent wire shapes stay in this owner. Client filesystem and terminal capabilities
are not advertised. Tool content and JSON arguments become domain tool parts.
Permission options retain agent IDs, names and kinds; exact user selections and
cancellation resolve them independently of OpenCode auto-accept.

Saved transcripts belong to the command and arguments. A saved session uses
`session/load` only when negotiated; otherwise it stays read-only. Failed resume
preserves that session. See [ACP maintenance](../../../../../docs/maintenance/ACP.md)
for setup, supported surfaces and validation evidence.
