# ACP runtime owner

`runtime.js` owns the selected child process, ACP v1 JSON-RPC requests, transcript,
session loading, cancellation and pending permissions. ACP Server uses the same
domain runtime with explicit WebSocket or experimental Streamable HTTP/2
transport. The backend owns the connection; shared UI never opens the remote
transport. `routes.js` publishes
OpenChamber domain records and SSE facts under `/api/acp`; authentication and
connection selection are enforced by the server before these routes.

`process.js` owns stdio launch and termination. Windows resolves PATH/PATHEXT
before choosing direct executable spawn or a hidden BAT/CMD wrapper with literal
arguments. Batch launchers forward with `%*` and reserve stdout for JSON-RPC.
Termination discovers the Windows process tree before killing its wrapper and
awaits the stdio close before directory cleanup or a new connection.

The shared UI uses `lib/opencode/acp.ts` through `opencodeClient` and `SyncSource`.
ACP events use the domain reducer. Reconnect sends a complete transcript snapshot
with a fresh unique ID for each fact through the shared authenticated SSE transport.

Directory-scoped snapshots compare local Windows grouping paths across slash,
drive-letter and trailing-separator forms, including saved sessions. This does
not rewrite session directories, saved `agentCwd` or remote mapping matches.
Local stdio discovery sends the native Windows directory form and compares
returned working directories with the same local rules. Remote discovery keeps
exact working-directory and project-mapping matches. Imported sessions retain
the agent's original working directory for subsequent load and resume requests.

Prompt text and accepted file links use message-scoped part IDs shared with the
optimistic UI, so live facts replace those parts in place. Accepted attachments
remain in the saved transcript. The runtime saves a new turn before publishing
its message facts or sending the agent request. A failed save rolls back that
unsent turn, returns the session to idle, and leaves later saves available.

`protocol.js` parses stable ACP v1 responses and groups method/update names. The
contract is pinned to upstream revision `24f3b07f44f043c617666c20208b093e919648ac`.
Local stdio advertises `fs.readTextFile`, `fs.writeTextFile` and `terminal`.
`callbacks.js` owns these requests, canonical path containment within each
session's immutable `agentCwd`, byte-bounded UTF-8 terminal output and process
cleanup. Remote transports neither advertise nor dispatch local callbacks.
Request validation returns JSON-RPC invalid-params errors without closing the
connection. Asynchronous replies remain bound to the originating connection
epoch and cannot reach a replacement agent. Tool content and JSON arguments
become domain tool parts.
Permission options retain agent IDs, names and kinds; exact user selections and
cancellation resolve them independently of OpenCode auto-accept.

Server selection requires a full ACP endpoint URL, explicit transport and an
absolute remote `cwd`. URL credentials are rejected; this increment has no
authentication/token configuration. The local project directory remains the
OpenChamber session grouping key. Optional `projectMappings` resolve exact local
project directories to remote working directories for new sessions and scoped
discovery. Unmapped projects use the explicit default `cwd`. Discovery ignores
out-of-scope remote roots and keeps existing local grouping and history.
Changing mappings does not change connection identity or an existing session's
saved `agentCwd`. Local files are not copied to the agent server. Connection failure
does not choose another transport, endpoint or executable.

The same JSON file stores connection partitions, including hidden session
markers. Reading the legacy `{identity,sessions}` format migrates it without
discarding message or metadata fields. Switching connections retains all
partitions and isolates colliding agent session IDs. Each record retains its
original `agentCwd`; UI grouping changes cannot retarget an existing session.

`discover(directory)` follows negotiated `session/list` cursors and merges only
after all pages succeed. Missing list entries never remove locally stored data.
Local title overrides, archive state and metadata survive discovery. A hidden
marker prevents removed sessions from reappearing, whether or not the agent
supports deletion. Session removal and metadata edits reject active work.

`open(id)` shares one restoration promise between message and controls callers.
It uses negotiated `session/resume` for complete local history and `session/load`
for missing history. Load projects user, assistant, thought and tool updates into
a temporary transcript, saves it, then publishes `transcript-refresh`. A failed
load or save preserves the previous transcript. Reopening a restored session
does not replay it again. Resume-only imported sessions retain
`metadata.acpHistoryIncomplete: true`; earlier messages are unavailable. Saved
sessions with neither capability remain read-only. Synchronous `sessions()` and
`messages()` getters remain the SSE snapshot source.

Stable select config options, legacy modes, commands and supplied context usage
belong to the session record. Updates apply while idle or generating and emit
`session-upsert` plus `session-refresh`. Config responses replace the full option
list, including dependent options. Boolean options require a future negotiated
client implementation and are ignored here. Commands are ordinary prompt text.
`GET /api/acp/commands` reads known commands without creating sessions. Accepted
image/audio/text attachments require their respective prompt capabilities;
visible file parts survive persistence. Tool diffs retain old/new text in
`state.metadata.diffs`.

Tool terminal references project cached bounded output into existing tool parts.
Running tools publish `state.metadata.output`; completed tools retain `output`.
Diff metadata remains intact. Live terminal ownership indexes contain only
referencing parts, and snapshots are dropped after cleanup. Cancel, prompt
completion, connection failure, switching and shutdown release owned terminals.
Cleanup is awaited before replacement startup and temporary-directory removal;
cleanup failure rejects shutdown instead of reporting a clean exit. A stopped
callback instance is closed permanently, so each connection creates a new one.
Windows process-tree cleanup cannot recover descendants after their command root
has exited. Retained pipes fail explicitly after five seconds. POSIX uses an
isolated process group; its signal path requires POSIX runtime acceptance.

Active and replayed plan updates become one stable `todowrite` tool part per
assistant turn. Later updates replace `input.todos`, retaining each supplied
content, priority and status for the existing Todo renderer.

`elicitation.js` owns form and URL interactions, including session and originating
request scopes. Replies and cancellation clear their pending inputs. Connection
failure publishes `connection-inputs` with an empty list and the error over SSE.
Authentication accepts advertised agent-controlled methods and binds the caller
to the selected epoch. It uses no request timeout while interactive authentication
is pending. CLI-terminal authentication methods remain agent-CLI operations.

Web, Electron, hosted mobile and Capacitor use this backend owner. Standalone VS
Code remains explicitly unsupported for ACP. See
[ACP maintenance](../../../../../docs/maintenance/ACP.md) for setup and runtime
acceptance evidence. Focused fixture tests cover protocol behavior; they do not
establish real-agent or device acceptance.
