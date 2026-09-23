# Managed MCP Reconnect

## Idle release

On Windows each managed local stdio connection runs through a native launcher
compiled from `windows-job.cs`. It creates the child suspended, assigns it to a
private Job Object with kill-on-close, then resumes it. Closing the transport
kills its descendants, including detached grandchildren. Job handles are not
inherited. Each connection records its launcher PID, creation time and job name.
Unrelated and externally hosted services are outside this ownership.

`launch.js` copies an already installed BGPM 1.2.8 dependency tree into a stable
versioned runtime directory. Recognized npx invocations use Node and `dist/cli.js`
directly. Other versions/options preserve their original command. No package
installation, registry request or user configuration rewrite takes place.

BGPM automatic release probes the owned listening ports and requires a successful
`server.full_state` response containing zero tasks, including history. Multiple
connections for the same directory are allowed; any non-empty response prevents
release. The
launcher discovers listener ownership through its Job Object and native TCP
tables. Unknown state, shared `--port` services, active tasks and retained task
history prevent automatic release. After SDK disconnect, the guard's `--release`
operation closes remaining owned jobs for that connection scope. It verifies the
guard PID, creation time and exact job identity before acting, so duplicate
connections cannot leave their descendants behind.

The managed plugin accepts project modes from the authenticated
`POST /api/system/project-resources` route. Each window sends a revisioned snapshot
and renews it every 30 seconds. Reports expire after 90 seconds; any unexpired
active window protects the directory. Modes are hashed by normalized directory
and written atomically inside the current managed runtime's private scope.
A shared file watcher wakes the plugin when a report changes. Idle mode requests
immediate release; active mode retains resources. Without a current client report,
the existing five-minute directory-inactivity fallback applies.

Before releasing anything it reads OpenCode's complete
live session status. Busy or retrying sessions prevent release, including tools
waiting for permission or an answer. A failed status request never means idle.
Activity invalidates pending checks, and disposal stops further work.

`mcp-reconnect/<runtime-id>/mcp-idle.log` records release, restore, failure and
retention reasons with hashed directory/server identities. Repeated identical
reasons log at most once a minute; the file rotates at 1 MiB. No task content,
commands, paths or credentials are logged. A failed resource-file read retains
connections. Runtime restart creates a fresh scope. Standalone web and desktop
use the managed runtime; external OpenCode returns unsupported until a managed
runtime is prepared. VS Code does not send these reports.

`idle-reclaim.js` owns this lifecycle. It serializes release and restore, records
only names it released, and restores them in the awaited `chat.message` and
`command.execute.before` hooks before the next prompt resolves its tools.
Configuration entries disabled or removed in the meantime stay disabled.
Partial restore failures retain the failed names and fail the hook so a prompt
does not silently proceed without those tools. Failed-server retries skip names
owned by idle release. Connection state inside a released MCP process is lost;
OpenCode sessions and messages are preserved.

This runs inside managed OpenCode, including messages sent by queues or other
clients. External OpenCode and VS Code processes are not managed by this plugin.
The UI must not disconnect shared MCP connections in response to `session.idle`.
Existing unrelated OpenCode processes are outside its ownership.

## Purpose

OpenCode connects each configured MCP server once, when a project directory is
first used. A server that does not come up then is marked `failed` and never
retried; a server whose live connection later drops is marked `failed` too and
stays that way until OpenCode restarts. This module injects a small plugin into
the OpenCode process OpenChamber launches that reconnects those servers, so a
server that was slow to start or crashed mid-session comes back on its own.

## Runtime flow

1. `materializePlugin()` writes a package directory under
   `<openchamber-data-dir>/mcp-reconnect/` with `package.json` and the plugin
   entrypoint. The managed OpenCode config runtime places that directory in
   the watched `plugins` array. When the user owns `OPENCODE_CONFIG`, the same
   directory is merged into `OPENCODE_CONFIG_CONTENT` as the documented
   fallback through `managed-plugin-config.js`; a bare `file://` JavaScript
   path is never injected because OpenCode 2.x accepts package directories.
2. It is always on for managed OpenCode and owns failed-connection retries and
   idle release within that process.
3. OpenCode loads the plugin once per project directory with an SDK client
   scoped to that directory, so each directory reconnects its own servers.
4. Metadata-only initialization schedules no MCP queries. A prompt, command or
   MCP tool-change event arms monitoring. On Windows, an existing connection's
   guard record also arms monitoring, so opening the foreground MCP page can
   still lead to idle release without sending a prompt. Inactive checks only
   inspect local state files; native PID/creation-time verification runs only
   when a connection directory exists. Each managed startup has a unique state
   scope, so another OpenCode instance cannot activate this one. It reconnects every
   server in the `failed` state, then re-reads status after a per-server delay
   that doubles from one second to a cap of thirty. A server seen in any other
   state resets its counter. While nothing is failed it checks every thirty
   seconds.
5. A dropped connection publishes `mcp.tools.changed`, which the plugin uses to
   check right away instead of waiting out the idle interval.
6. OpenCode calls the plugin's `dispose` hook when it tears the directory down,
   which stops the loop.

## Invariants

- Only `failed` is retried. `disabled` is the user's choice, and `needs_auth`
  or `needs_client_registration` need the user to act; retrying those would
  either re-enable a server the user turned off or loop on a login prompt.
- The retry loop logs nothing and tolerates status errors. OpenCode already logs each
  failed attempt, and a status call failing during an OpenCode restart is not
  news.
- One check runs at a time; a wake-up arriving during a check is honored once
  it finishes rather than starting a second loop.

## What the UI sees

OpenCode publishes no event when a reconnect succeeds. The chat picks the
server up on the next prompt because tools are resolved from live state, but
the MCP page reads status on bootstrap and refresh, so it can show `failed` for
a while after the server is back.

## Runtime parity

- Web and Desktop managed OpenCode: injected automatically through the watched
  managed config directory.
- External OpenCode (`OPENCODE_HOST` or skip-start) and VS Code's separate
  OpenCode lifecycle: not injected, because OpenChamber does not control that
  process environment.
