# ACP

For the latest real OpenCode/Qwen Code results and the feature-by-feature UI/backend comparison, see [ACP acceptance](ACP-ACCEPTANCE.md).

This branch starts at `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6`,
`2.0.4-DIJIANG.4.0`, the last 4.X baseline before the 5.X branch diverged.
Development and [portable builds](ACP-BUILD.md) use `codex/acp-integration`.
The explicit choices below implement DEV-PLAN section 3.2 for the OpenChamber
backend. The standalone VS Code extension retains its own OpenCode launcher.

Choose an agent connection at startup or in OpenCode settings: external OpenCode
server, explicit command, PATH, bundled OpenCode, ACP stdio command, or ACP Server. Previous
values prefill the form; confirm a choice to connect. A failed choice stays visible
with its error. Environment variables do not choose the mode, and failure does
not select another endpoint or executable.

Choices are saved in `agent-connection.json`. ACP saves its working directory.
Apply the selection to retry after failure. Switching stops the managed child;
external OpenCode remains running under its owner.

For ACP, supply the executable, arguments and an absolute working directory.
For example, select the installed `opencode.exe` with arguments `--pure`, `acp`.
On Windows, you can select a `.bat` or `.cmd` file directly, including a full path
with spaces or a command shim available on PATH. Enter the path without surrounding
quotes and supply each argument separately. Other scripts need an explicit
interpreter, such as `node` with the script path as an argument. The backend owns
the selected process until connection switching or shutdown, including the
Windows batch wrapper and its agent descendants.

Batch launchers should use `@echo off`, forward arguments with `%*`, and keep
stdout exclusively for ACP JSON-RPC lines. Send diagnostics to stderr. Select
the BAT/CMD file itself; OpenChamber handles the required Windows command quoting.

For a launcher at `C:\Tools\agent.bat` that accepts `--acp`, choose ACP stdio,
enter `C:\Tools\agent.bat` in Command and `["--acp"]` in Arguments. If the
script already supplies `--acp`, use `[]` for Arguments.

## ACP Server

Select ACP Server, then explicitly choose WebSocket or Streamable HTTP. Enter the
full endpoint URL, such as `wss://agent.example/acp` or `https://agent.example/acp`,
and an absolute remote working directory, such as `/srv/project` or
`C:\\projects\\agent`. The remote workspace must already exist and be configured
on the agent server. Local project files are not copied there. OpenChamber keeps
the local project directory for its own session bookkeeping and sends the
configured remote directory in ACP session requests.

Project directory mappings optionally pair an exact local project directory with
an absolute directory on the agent server. New sessions and scoped history
discovery use that mapping; unmatched projects use the explicit default remote
directory. Editing mappings leaves existing sessions at their original directory.

The endpoint must implement ACP, rather than the OpenCode REST API. The
[official Python SDK web transports](https://agentclientprotocol.github.io/python-sdk/web-transport/)
are experimental. WebSocket carries JSON-RPC frames; Streamable HTTP requires
HTTP/2 and uses POST, SSE GET streams and DELETE. Configure the transport to
match the server; connection failures never switch transports automatically.
This release has no server authentication/token fields. URLs containing
credentials are rejected.

The OpenChamber backend owns the remote connection. Web, Electron, hosted mobile
and Capacitor reuse the existing chat, permissions and cancellation flow.
Browsers do not connect directly to the ACP endpoint. The standalone VS Code
extension does not support ACP Server. The stdio command choice remains available.

## ACP sessions

The stdio transport uses [ACP v1](https://agentclientprotocol.com/protocol/v1/transports).
The backend negotiates initialization, creates sessions with absolute directories,
sends prompts, streams text, thoughts and tool updates, displays exact permission
options, and cancels prompts. OpenCode permission auto-accept does not apply.
The composer shows the agent's advertised configuration options, including model
and reasoning choices, and falls back to advertised legacy modes. Dependent
options are replaced after a change. Advertised slash commands are sent unchanged
as ordinary ACP prompts. Context usage and cost are shown only when supplied by
the agent. Images, audio and embedded text require their corresponding prompt
capabilities. File links use ACP resource links.

Shared chat uses the OpenChamber backend on web, Electron, hosted mobile and
Capacitor. The standalone VS Code host does not offer ACP. OpenCode fork, revert,
share, provider configuration, MCP, skills and background shell operations require
an OpenCode connection. Host-owned file browsing, Git, worktrees and user terminals
continue to use OpenChamber services.

Sessions and transcripts are stored in `acp-sessions.json` in the OpenChamber data
directory, partitioned by agent connection. Existing single-connection files are
migrated on save. Reconnect sends a complete snapshot. Advertised `session/list`
imports agent history; `session/load` replays it and `session/resume` continues
saved sessions without replay. Failed loading preserves the original transcript.
Agents offering neither restoration method leave saved sessions read-only.

Renaming and archiving use local metadata. Removing a conversation calls agent
deletion when advertised; otherwise it hides the conversation in OpenChamber.
An explicit local title survives agent title updates. Each session retains the
directory used when it was created or imported. Stdio supports separate project
directories through the same agent process.

## User input and local tools

Agent questions use the existing conversation input area. Forms support typed
fields, choices and defaults; replies are validated on the backend. URL requests
show the agent and destination before opening the system browser. Accepting a URL
request records consent; the agent reports completion separately. Pending input
is restored from the connection snapshot after a browser refresh.

Agent-managed authentication methods appear in connection settings. Methods that
require an interactive terminal direct the user to the agent CLI. HTTP endpoint
credentials remain separate from this ACP authentication flow.

Local stdio agents can request text reads/writes inside the session directory and
execute owned commands through ACP terminal callbacks. Canonical path checks
reject filesystem links outside that directory. Remote ACP connections do not
receive access to the OpenChamber host's filesystem or command execution.
On hosted/mobile clients these local tools run on the backend host.

Terminal output streams in the existing tool card and remains in saved history.
Text output and file diffs appear together when an ACP tool returns both.
Agent plans use the existing todo presentation, including history replay. Repeated
plan updates replace the same turn's plan instead of adding duplicate cards.

Terminal cancellation waits for process cleanup. On Windows, a command that exits
before its descendants can leave orphaned processes holding output pipes; cleanup
reports an error after five seconds in that case. POSIX process-group cleanup
still needs platform acceptance.

## Current parity validation

The implementation follows [issue #1](https://github.com/CastleYu/openchamber/issues/1)
and stable ACP v1 at revision `24f3b07f44f043c617666c20208b093e919648ac`.
Runtime fixtures cover paginated history, staged replay, resume, configuration
changes during generation, metadata persistence, connection isolation and failed
list/load/save operations. UI tests cover ACP routes, session switching, commands,
tool diff presentation and partial archive failures. These tests exercise local
protocol fixtures; the user's private agent has not been available for acceptance.

Workspace type-check and lint passed. All 66 ACP backend tests, 44 ACP UI tests,
40 adapter/tool-output regressions and 17 build/publication contract tests passed.
The final OC1/OC2 regression suite passed 88 tests. Browser verification with the
local fixture confirmed typed form submission, terminal output alongside diffs,
plan updates, a second running turn and cancellation with process exit. Windows
directory comparisons accept slash variants without changing the saved agent cwd.
Dead-code analysis found no new ACP findings after removing five unused
exports. The initial Grok attempt failed on HTTP 401 and stalled MCP startup.
The subsequent completed Grok 4.7 high review and real OpenCode/Qwen acceptance
are recorded in [ACP acceptance](ACP-ACCEPTANCE.md). The older review below
applies only to the earlier baseline.

## Earlier baseline evidence

- Windows batch fixture tests cover BAT/CMD paths with spaces and shell characters,
  PATH shims, npm `.bin` shims, literal arguments, initialization and session
  creation, missing commands, malformed stdout and process tree cleanup. Native
  executable launches use the same direct-spawn path as before.

- Baseline before ACP: workspace type-check, OC1/OC2 compatibility tests and web
  build passed. The installed runtime was OpenCode 1.19.0. Exact 1.2.27 validation
  remains deferred under the repository's compatibility policy.
- Real OpenCode 1.19.0 with `--pure acp`: ACP v1 initialization and `session/new`
  passed; it advertised `loadSession`. No model prompt was sent in that handshake.
- `packages/web/server/lib/acp/runtime.test.js` uses real stdio child processes
  and local HTTP streaming. It covers text/thought deltas, tool content arrays and
  JSON arguments, exact permissions, cancellation, process failure, invalid
  commands, malformed output, resume behavior, rejected attachments and unique
  reconnect snapshot IDs.
- A local authenticated HTTP integration smoke covered selection, session creation,
  prompt streaming, permission replies, transcript reads and rejection of
  OpenCode-only routes while ACP is selected.
- Browser acceptance with the local stdio fixture covered explicit selection,
  mouse submission, exact permission replies, streamed results and reconnect.
  Live user messages appear once after optimistic and server updates reconcile.
- Grok 4.7 high reviewed application and release changes. Its transcript-save
  failure finding was fixed and reproduced in a filesystem regression test.
  The final runtime suite passed 12 tests and session actions passed 109 tests.

Fixture evidence does not establish a model-backed conversation or acceptance on
every device. See [build instructions](ACP-BUILD.md) for the separate ACP channel.
