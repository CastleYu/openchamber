# Routing

OC1 retains the feature flag, global safety switch, and prompt-body model rewrite. OC2 selects a classification source explicitly. With no selection, Jev is off even if a TypeSafe key exists; Auto uses the fallback without sending conversation text to Jev. OC2 `safety` permission checks hold on missing or failed classification, while OC1 keeps its prior accept-on-failure behavior.

`classification.json` stores the selected provider. `classifier-endpoint.json` stores a custom endpoint and optional key with restricted file permissions. The routing runtime takes `enterpriseMode` and `readPinnedEndpoint` callbacks from server composition; that caller owns the policy connection. Direct `/api/routing/classifier` and `/api/routing/classifier/custom` requests reject OC1.

## Purpose

Jev model routing and the permission safety net. With the `openchamber/auto`
model selected, the server asks [Jev](https://docs.typesafe.ai) (TypeSafe's
System One decision model) which task category a message belongs to and sends
it with that category's model, thinking variant and agent. With the safety net
on, the same call decides whether an auto-accepted permission should stay on
screen for the user instead.

For OC1, `OPENCHAMBER_ROUTING_ENABLE` (`feature-flag.js`, read per call) gates the routes, request rewrite, Settings and Auto row. OC2 can show Routing without that flag, but Jev starts Off until a source is selected. VS Code has no OpenChamber server and never offers Auto.

## Files

- `feature-flag.js` — the env gate.
- `defaults.js` — the Auto sentinel, Jev endpoint, built-in categories, the
  question wording for routing and for the safety net, history excerpt limits.
- `store.js` — `routing.json` (only deviations from the built-ins) and
  `routing-auth.json` (the Jev key alone, mode 0600) in the OpenChamber data
  dir. `resolveEffectiveConfig` merges built-ins with stored overrides;
  `toStoredConfig` is its inverse. A missing file is the defaults, a malformed
  one throws.
- `jev.js` — request builders, answer parsing, the HTTP call with a timeout.
- `classifier.js` — source selection, endpoint construction and custom URL validation.
- `history.js` — the last three settled turns through session assist's
  `loadAssistContext` (text parts only, attached quotes included, no files or
  tool payloads), each user message cut to its head and each answer to head
  plus tail. The new request is never cut.
- `runtime.js` — `createRoutingRuntime`: `describe`, `resolvePromptBody`,
  `evaluatePermission`, config and token writes, event broadcasts.

The dual-kernel runtime also exposes `noteModelSelection`, `isAutoSession`,
`resolveAutoSelection`, and `routeSend` for OC2. The OC2 sentinel is held in
server memory by session and runtime identity. A routed send chooses a model
from Jev and switches the OC2 session model and agent before the prompt goes
upstream. OC1 still rewrites the prompt body. A runtime switch invalidates
the server mark and rejects a late selection write. Server restart loses the
OC2 mark, so callers must send the sentinel again when resuming Auto.
OC2 sends to the selected usable source only. OC1 retains its flag and key requirements.
When an OC2 Auto choice names a thinking variant absent from that model's
authoritative catalog entry, `routeSend` omits the variant and uses the model
default. A missing catalog or unknown model keeps the configured variant.
The catalog read uses `kernelOperations` and retains its runtime epoch check.
- `routes.js` — `/api/routing` (GET, PUT), `/api/routing/token` (PUT, DELETE)
  and `registerRoutingPromptRewrite`.

## Invariants

- The sentinel never reaches OpenCode. `resolvePromptBody` rewrites
  `body.model` in place for `POST /api/session/:id/{prompt_async,prompt,command}`
  ahead of the generic proxy (which replays a parsed body), inside the
  message queue's `sendItem`, and in the OpenChamber session service's own
  dispatch (`openchamber-sessions/routes.js`), which posts to OpenCode directly
  and can pick Auto up from Session Defaults. Without a fallback model it
  throws 400 rather than forwarding.
- On OC2, the proxy-front middleware consumes an Auto model switch, stores the
  session mark for the current runtime identity, and routes each following
  prompt or command before forwarding it. It also drops an Auto model from
  session creation so the first send can select a real model.
- A Jev error, timeout, unknown category or low confidence routes to the fallback model; the decision carries the reason. OC1 safety-net failure accepts as before. OC2 safety-net failure holds the permission and broadcasts `openchamber:routing.safety-skipped`.
- A category without a model uses the fallback model *and* variant; a variant
  only travels with the model it was chosen for. A category agent replaces the
  composer's agent; an empty one keeps it.
- OC1 Auto needs the flag, `enabled`, a saved key, a fallback model and two enabled categories. OC2 Auto needs `enabled`, a selected usable classifier, a fallback model and two enabled categories.
- Held permission decisions are cached for 15 minutes per request id so
  reconnect reconciliation in `permission-auto-accept` does not re-ask Jev;
  `permission.replied` forgets them.
- The OC1 rewrite parses JSON only while the flag is set. The OC2 rewrite parses only requests for Auto-marked sessions; ordinary proxy streams stay untouched.

## Events

Broadcast on the OpenChamber control stream: `openchamber:routing.updated`
(availability), `openchamber:routing.decision` (per send),
`openchamber:routing.permission-held`, `openchamber:routing.safety-skipped`.

## UI

`packages/ui/src/stores/useRoutingStore.ts` projects `/api/routing` and these
events; `hooks/useRoutingSync.ts` keeps it current and shows the skipped-check
toast. `lib/routing/autoModel.ts` owns the sentinel; `useConfigStore` accepts it
as a valid selection while `autoReady`. `ModelPickerList` renders it as the
pinned `leadingEntry`; `ModelControls` hides the agent and thinking controls
while Auto is selected. `PermissionCard` shows the hold reason. Settings →
Routing (`components/sections/routing/RoutingPage.tsx`) edits the config with
debounced saves and manages the key.

## Tests

`store.test.js` (defaults, deviation round-trip, deleted built-ins, malformed
file, token file mode), `runtime.test.js` (request text, excerpts, decisions,
rewrite and fallback paths, safety net hold/skip/off), `routes.http.test.js`
(rewrite ahead of a stand-in proxy, routes, flag off). The queue and
auto-accept tests cover their hooks.
