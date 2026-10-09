# Message Queue

Production starts the queue only after trusted process startup selects OpenCode.
Selection retirement detaches subscriptions and stops dispatch. If an idle read
finishes after stop, it cannot start a send. The pending item remains in memory
and the persisted snapshot. An already entered mutation is not canceled or
replayed by this guard. Return to another backend through a fresh, explicitly
configured process startup; queue intent is not reassigned to CAgent.

With `kernelOperations` injected, the server checks live status and the newest
message through the selected OpenCode generation. Message pages state their
order: OC1 is ascending, OC2 descending. For OC2, an idle parent with a busy descendant keeps its queue armed until the descendant settles. A failed read leaves the queue armed
for retry. OC2 sends context as non-resuming synthetic messages, then sends the
prompt or command with the captured model and agent. The send request carries
the runtime epoch so a delayed dispatch cannot cross a kernel switch.

## Purpose

Owns the messages a user queued while a session was busy, and sends them the
moment the session goes idle. The queue lives in the web server so a closed
tab, a locked phone, or a dropped connection no longer strands it. Structural
template: `permission-auto-accept` — the server is authoritative, the shared UI
renders a projection, and VS Code (which has no server of its own) keeps its
UI-side queue and foreground auto-send hook.

## Files

- `runtime.js` — `createMessageQueueRuntime(...)` (state, persistence,
  dispatch loop, event handling) and `registerMessageQueueRoutes(app, runtime)`.
- `runtime.test.js` — delivery, idleness gates, retries, holds, persistence,
  concurrency with in-flight sends, slash commands, and project knowledge.

Wiring: created in `server/index.js` after the global event hub and the
session-knowledge runtime; routes registered in
`opencode/feature-routes-runtime.js` (before the generic OpenCode proxy) with
JSON bodies enabled in `opencode/core-routes.js`; stopped by
`opencode/shutdown-runtime.js`.

## Auto routing

`resolvePromptBody` (the routing runtime) runs on the assembled body right
before the prompt or command send, turning a queued `openchamber/auto` model
into a real one. The queue captures the sentinel like any other send config.

## Item

An item is what the UI would have sent itself, captured at queue time so the
send never re-resolves mutable UI state:

```
{
  id, createdAt,
  content,        // raw text for display and editing
  contextPreview?, // bounded display-only summary captured by the UI
  text,           // text to deliver (agent mention stripped, file mentions resolved); defaults to content
  agentMention?,  // delivered as an `agent` part
  attachments: [{ id, filename, mimeType, size, source, serverPath?, dataUrl }],
  context: [      // what the composer had attached, in send order
    { kind: 'context', text, metadata, instructions? },  // a draft chip or linked issue/PR; metadata is the UI's structured payload
    { kind: 'instruction', text },                       // derived from the text (skill instruction)
    { kind: 'synthetic', text },                         // handed to the composer by another surface
  ],
  sendConfig: { providerID, modelID, agent?, variant? }   // required
}
```

The server is a courier for `context`: it validates the shape (a kind it
knows, a `metadata` object on `context` entries) and delivers each entry as a
synthetic text part, an entry's `instructions` going out as its own part just
before it and its `metadata` riding the part verbatim so the timeline renders
the context block back. The payload inside `metadata` is the UI's contract
(`lib/messages/contextParts.ts`), parsed by the UI on the way back.

`parseQueuedItemInput` rejects anything the server could not deliver later
(no text, attachments, or context; missing model; malformed attachment or
context entry). Public snapshots and broadcasts strip the payloads —
attachment `dataUrl` (megabytes of base64) and `context` (a PR diff, say) —
so they do not ride every update; the only way to get them back is a `take`.

Snapshots retain `contextPreview`, capped at 100 characters plus an ellipsis.
It carries the attached comment or context label when `content` is empty and
never replaces editable text or delivered parts. Older items without a summary
derive one from the attached comment metadata or the first non-instruction
context text. This optional field needs no queue-file migration.

## Persistence

`<data-dir>/message-queue.json` (`OPENCHAMBER_DATA_DIR` or
`~/.config/openchamber`): `{ version, revision, sessions: { [sessionId]:
{ directory, items } } }`, written atomically (temp file + rename) through a
serialized write chain. A missing file is an empty queue. A malformed file is
a failure, not an empty queue: it is moved aside as
`message-queue.json.corrupt-<timestamp>` before the runtime starts empty, so
the next write cannot overwrite the user's data. A failed read leaves writes
disabled until a later load succeeds. `revision` is a global monotonic counter
bumped on every mutation; clients use it to reject stale snapshots.

In-memory only, deliberately: the in-flight item (`sendingId`), retry
backoff, abort timestamps, and holds. A restart has no in-flight sends; a
persisted "sending" flag would strand a message forever.

## Delivery loop

1. `start()` subscribes to the global upstream hub and loads the file; on
   load and on every hub `connect` it arms every session that has items.
2. `session.status` for a queued session: `idle` arms a short quiet timer
   (500 ms, coalescing the burst around a turn boundary), `busy`/`retry`
   clears it. A `message.updated` for a completed assistant reply arms as
   well, so a missed idle event cannot strand the queue. `session.deleted`
   drops the session's queue. An assistant `MessageAbortedError` records an
   abort.
3. `tick(sessionId)` bails when the queue is empty, an item is in flight, or
   the session is held. It re-arms after a 2 s post-abort hold (the UI's
   old behavior: a stop is not immediately followed by the next prompt) or
   while the head item is in retry backoff.
4. Idleness is re-verified against OpenCode before sending, because
   `prompt_async` into a running turn steers into it instead of starting the
   next one: `GET /session/status` must not list the session as busy/retry,
   and the trailing message must not be an unfinished assistant reply (the
   status map only lists busy sessions, so a missed busy event leaves no
   entry while a turn still streams). An unfinished reply created before this
   runtime started does not block: its run died with the previous server and
   will never complete, so a restored queue would wait on it forever. A reply
   with no `created` time still blocks. A failed fetch is unknown, never idle:
   the tick re-arms with backoff. Kernel-backed dispatch captures one
   generation/profile/endpoint/epoch before these reads and retains it through
   sending. Status, message-tail and descendant waits recheck that identity;
   a retired or no-longer-admitted owner is unknown, so its queue stays intact
   and the tick re-arms. Command discovery also rechecks before dispatch.
   These checks add no OpenCode network requests.
5. The head is marked in flight (broadcast), then sent:
   - text starting with `/` that names a command in OpenCode's `/command`
     list (skills included) and carries no captured context goes to
     `POST /session/:id/command` with the captured model, agent, variant, and
     file parts. That route accepts file parts only, so a command queued
     **with** context takes the prompt route instead, the same rule the
     composer applies: the command's template is expanded with its arguments
     (`$ARGUMENTS`, `$1..$N`, or appended), a skill keeps its `/name args` text
     and gets an explicit "the user invoked this skill" synthetic part after
     the context;
   - otherwise `POST /session/:id/prompt_async` with the parts in the same
     order a UI send uses: text, files, the captured context, the skill
     invocation when there is one, pending project knowledge
     (`sessionKnowledgeRuntime.resolvePendingForSession`, synthetic, recorded
     as delivered only after the prompt is accepted), then the agent mention.
   Success removes the item, persists, broadcasts, and marks the user
   message sent for notifications. Failure keeps the item, backs off
   2 s → 60 s (doubling per consecutive failure of that item), and re-arms.
6. The next item goes out after the next busy → idle cycle.

## Holds

Auto-review is driven from the UI and bounces the original session through
idle between iterations; the UI tells the server to hold that session's queue
(`PUT .../hold { held: true, ttlMs? }`) while a run is going and releases it
when the run ends. A hold expires on its own (default 5 min, cap 10 min)
because the UI that asserted it may be gone; the UI re-asserts it every two
minutes while the run continues. Releasing arms a dispatch.

## Routes (`/api/message-queue`)

Normal authenticated OpenChamber runtime routes; never on browser URL-token
allowlists.

| Route | Purpose |
|---|---|
| `GET /api/message-queue` | Full snapshot `{ revision, sessions[] }` |
| `POST .../sessions/:id/items` | Append `{ directory, item }`; returns `{ revision, session, itemId }` and arms a dispatch (the session may already be idle) |
| `DELETE .../sessions/:id/items/:itemId` | Remove; `409` while that item is in flight |
| `POST .../sessions/:id/items/:itemId/take` | Remove and return the full item (payloads included); `404`/`409` |
| `POST .../sessions/:id/take` | Remove and return every item not in flight, in order |
| `PUT .../sessions/:id/order` | `{ itemIds }` must be a complete permutation |
| `DELETE .../sessions/:id` | Clear; the in-flight item stays |
| `PUT .../sessions/:id/hold` | `{ held, ttlMs? }` |

Every mutation broadcasts `openchamber:message-queue.updated` with
`{ revision, session }` to all connected clients (SSE and WS), so several
devices on one server see one queue. SSE uses the shared control stream at
`/api/openchamber/events`; `/api/global/event` carries no OpenChamber events.
The UI subscribes independently of its OpenCode transport and re-reads the
snapshot whenever either stream reconnects. The session in that payload always names
its `directory`, including the broadcast that removes the last item: the UI
keys its projection by directory, and a broadcast without one left the
delivered message on screen (a session's directory is remembered until the
session is deleted or evicted).

Limits: 20 items per session, 50 sessions (new entries reject with 409 at capacity; existing intent is retained), 200k characters of content; attachment payloads are bounded
by the route family's 50 MB JSON limit.

## UI ownership

`packages/ui/src/stores/messageQueueStore.ts` is the projection: see its
section in `packages/ui/src/stores/DOCUMENTATION.md`. VS Code intentionally
does not use this module; with all OpenChamber webviews closed, queued
messages there are not delivered.


## Saved-target restart boundary

The host calls pauseDispatch after validating the saved connection and before retiring its endpoint. This pauses timers and new enqueue requests. Pending status reads finish without entering sends. Sends already entered are neither canceled nor replayed; their dispatch promises and subsequent queue writes must finish before the lifecycle can close the old child. The returned resume function is idempotent and cannot restart a stopped queue.

Drain has a 15-second deadline. Timeout restores dispatch and rejects restart before changing the live owner. A queue write failure also refuses retirement; a later successful write clears that failure. Cleanup/startup failure releases the pause, while existing readiness and identity guards keep an unavailable backend from dispatching. This is restart of the confirmed saved target, not permission to reassign queued intent to another target. Public active-record changes remain rejected until busy-session, queued-intent, pending-approval and peer-client confirmation are implemented.

Web owns the boundary; Electron reuses it in process. Hosted and Capacitor mobile observe their connected host. VS Code keeps its separate foreground queue and adopts confirmed switching through its extension manager. The drain itself keeps the queue format unchanged; configured-target ownership below extends it. This adds one in-flight promise per dispatch and one bounded drain at a requested restart, without new upstream requests or polling. Chinese archive: [queue and lifecycle drain](../../../../../docs/maintenance/zh-CN/QUEUE-CONNECTION-DRAIN.md).

## Original configured target

The host derives an opaque SHA-256 target from the confirmed connection record,
generation and profile. Managed targets also include the resolved binary and
working directory. Port and runtime epoch are excluded so a restart of the same
configured target preserves intent. This identifies configured intent; it cannot
prove that an external server at the same URL is the same remote instance.

The host stamps new items; client-supplied stamps are ignored. Persisted stamps
are private. Snapshots expose delivery as ready, target-changed or target-unknown.
Old disk records and migrated browser items remain unknown. Changed or unknown
items stay stored and cannot auto-dispatch or be taken for sending. Explicit
editing and removal remain available; editing returns the full captured payload.
Take routes accept purpose send (default) or edit. Send checks ownership and the
transition pause after asynchronous target lookup. Directory collisions reject
append instead of rerouting old items. Capacity rejects rather than evicting.

Session-deleted events remove only matching-owner items observed before that
event's asynchronous read. Target lookup failure holds intent and rejects new
enqueue with 503. Reconnect and the existing dispatch scheduler refresh target
state; no new poller is added. UI rows explain the hold, disable send and retain
edit/remove. All 13 locales are translated. VS Code's separate foreground queue captures
the same configured identity and checks it at the host forwarding boundary;
see its [store contract](../../../../ui/src/stores/DOCUMENTATION.md#configured-queue-target).
Peer coordination and full webview acceptance remain R1 gates.

Chinese archive: [configured queue target](../../../../../docs/maintenance/zh-CN/QUEUE-TARGET.md).
