# ACP

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
Scripts need an explicit interpreter, such as `node` with the script path as an
argument. The backend launches that executable directly and owns its process
until connection switching or shutdown.

## ACP Server

Select ACP Server, then explicitly choose WebSocket or Streamable HTTP. Enter the
full endpoint URL, such as `wss://agent.example/acp` or `https://agent.example/acp`,
and an absolute remote working directory, such as `/srv/project` or
`C:\\projects\\agent`. The remote workspace must already exist and be configured
on the agent server. Local project files are not copied there. OpenChamber keeps
the local project directory for its own session bookkeeping and sends the
configured remote directory in ACP session requests.

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
Model selection belongs to the agent; the composer does not require an OpenCode
provider or model. Images require the agent's image capability. File links use
ACP resource links. Client filesystem and terminal services are not advertised.

Shared chat uses the OpenChamber backend on web, Electron, hosted mobile and
Capacitor. The standalone VS Code host does not offer ACP. OpenCode fork, revert,
share, provider configuration, MCP, skills and background shell operations require
an OpenCode connection. ACP authentication and modes have backend operations;
a dedicated mode/authentication picker is outside this delivery.

Sessions and transcripts are stored in `acp-sessions.json` in the OpenChamber data
directory. Reconnect sends a complete snapshot. The same saved agent connection can resume a
locally known session when it advertises `loadSession`; otherwise its transcript
stays read-only. Failed resume preserves the original session and shows the error.

## Evidence

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
