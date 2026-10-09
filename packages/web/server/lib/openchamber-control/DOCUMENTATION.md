# OpenChamber Control Service

The server injects `kernelOperations` for session listing, status and message
reads. A failed status lookup leaves that session `unknown`. Message output
follows the page's declared order and sorts by creation time before applying
`last` or `limit`.

`notify.send` delegates to the injected `notifyUser` service. `file.open`
delegates to `createFileOpenRequester`: it resolves a path from the session
directory, checks that a file exists, broadcasts
`openchamber:file-open-request`, and reports 503 when no client can show it.
These new agent actions require OC2 under the initial adoption policy. OC1 keeps
its existing notification delivery and file viewer. The control service enforces
this gate for direct HTTP callers as well as generated tool schemas.
OC2 browser actions may name a `tabId` returned by `browser.snapshot`; the
service validates and forwards it to the selected browser provider. OC1 retains
its untargeted browser actions and rejects explicit tab targeting.

## Purpose

This module owns the typed control contract shared by the OpenChamber CLI and
the managed OpenCode `openchamber` tool. Both adapters delegate to
`createOpenChamberControlService()`; neither adapter may call or spawn the
other.

## Boundaries

- `service.js` validates and executes the fixed project, model, session, and
  scheduled-task action allowlist. `actions.js` marks CLI-only actions with
  `agentExposed: false` (currently `schedule.status`); the agent tool consumes
  the filtered `OPENCHAMBER_AGENT_TOOL_*` exports. `schedule.toggle` requires
  the `disabled` boolean and replaces separate enable/disable actions;
  `schedule.list` also returns scheduler status as `scheduler`.
- `routes.js` is the authenticated CLI HTTP adapter. It forwards one action,
  preserves service status and partial-result details, and propagates request
  cancellation.
- `../agent-tool/runtime.js` is the managed-tool adapter. It wraps service
  results in the versioned native-tool envelope and uses a separate ephemeral
  loopback credential.
- `../openchamber-sessions/routes.js` and `../scheduled-tasks/service.js` own
  their domain operations and are composed into this service.

## Invariants

- Session status and messages come from official directory-scoped OpenCode
  APIs. Message output includes only ordered `text` parts.
- Session reads accept either `projectId` or `directory`. A project ID resolves
  through the session service's registered project lookup; an unknown project
  fails instead of falling back to the caller's directory. Both scope fields
  together are invalid for reads and writes.
- Wait never treats an initial idle response as completion after dispatch. It
  requires observed activity or a newly completed assistant message.
- Timeout and cancellation are failures, never authoritative idle results.
- Validation that protects side effects runs before session creation or
  dispatch. An explicitly requested model, agent, or variant is checked against
  the directory's own OpenCode agent and provider lists before any session,
  worktree, or goal is created, because `prompt_async` accepts an unusable
  selection and then fails only on the event stream. A failed or empty lookup
  never turns a valid selection into a rejection.
- `promptDispatched` reports an observed dispatch, never an accepted request.
  After `prompt_async` the service confirms a new user message reached the
  session; when it does not, the result reports `promptDispatched: false` with
  `promptError` instead of claiming success.
- Send and fork dispatches without an explicit model/agent/variant reuse the
  target session's last user-message selection before falling back to the
  configured defaults; only session creation resolves defaults directly.
- Default agents resolve from the owning project before global settings and
  OpenCode defaults. Directory-based requests identify the project before
  creating a worktree; existing linked worktrees resolve through Git's primary
  worktree root. Send/fork fallback uses that same owner. Configured model IDs
  and effort preferences survive missing catalog entries rather than silently
  dispatching with a different model.
- Usage errors name the missing or conflicting input so CLI and agent-tool
  callers can correct an invalid request without an upfront usage manual.
- Explicit `projectId` or `directory` scope takes precedence over the managed
  tool's current-session directory fallback; the fallback never creates a
  conflicting second scope.
- One failed directory status lookup produces `unknown` for only that
  directory and does not erase other session results.
- Destructive session/worktree deletion and project-path registration are not
  part of the action contract.
- `browser.capture` writes its image on the server, into
  `.openchamber/screenshots/` under the scoped project directory, and returns
  the project-relative path rather than the image bytes. The client that took
  the picture may be on a different machine than the repository, and a path is
  what an answer, a commit, or a review can use; base64 in a tool result cannot
  be any of those. The agent's label is reduced to a filename fragment, never
  used as a path. The result also states how to present the image, because chat
  renders the image paths written in a finished answer below that message —
  saving the file is not what shows it to anyone.

Production server composition injects kernelOperations. Session reads capture its identity before readiness and compare generation, profile, endpoint and epoch afterwards. A change returns 409 before session dispatch. With that dependency, getClient returns no direct SDK client. The SDK fallback remains for callers without it. Web and Electron share this owner; hosted/Capacitor mobile inherit their host. VS Code local bridges are separate. Session actions retain that identity through project/target-directory resolution, message pages, status collection and idle polling. A changed owner stops before another read or dispatch; it cannot become a directory fallback or an unknown status. Ordinary same-owner lookup failures retain their existing fallback/unknown policy. After create/send/fork returns a result, a later failure reports partial=true, partialAction as the control action ID, sessionId and directory through the existing HTTP contract. It never replays or deletes the session. Other autonomous consumers and VS Code writers still need review before production profile selection is enabled.
