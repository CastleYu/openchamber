# Permission Auto-Accept

## Purpose

This module owns the authoritative permission auto-accept policy for web, desktop, and mobile runtimes. Policy is persisted in OpenChamber settings so permission handling survives UI disconnects and server restarts.

## Policy

`permissionAutoAccept.sessions` in OpenChamber settings retains explicit OC1 boolean policies. The separate `permission-modes.json` file owns OC2 `ask`, `safety`, and `auto` values. OC2 reads a mode first and can interpret an older boolean without rewriting the OC1 record. A failed mode write leaves both records intact. Server composition passes the OpenChamber `dataDir` to the runtime.

Policy inheritance uses the nearest explicit session value. A child `false` or `ask` overrides an accepting parent. Defaults are written only for newly created OC2 root sessions; children inherit their parent's explicit policy.

## Runtime

`createPermissionAutoAcceptRuntime` loads and serializes policy writes, subscribes to the global OpenCode event hub, caches session lineage, retries transient replies, and reconciles pending permissions after startup, reconnect, and policy enablement. Enabling Auto-Accept for a session immediately accepts matching pending requests and keeps handling future requests without requiring a connected UI.

Unknown lineage and failed policy loads fail closed. A failed pending-permission fetch is distinct from an empty successful response and never clears policy state.

The web runtime receives `kernelOperations` at startup. OC1 uses its existing
permission list and reply contract; OC2 uses the session-scoped permission
request list and reply with `decision`. Session lineage reads use the same
generation. The runtime captures endpoint and epoch before resolving lineage
or consulting the safety net, and rejects a reply if either changes. A
generation switch also clears cached session lineage, in-flight work, and reply outcomes.

## Safety net

`evaluatePermission` (the routing runtime, `../routing/DOCUMENTATION.md`) is consulted after the policy check. OC1 keeps its global-switch evaluator and accept-on-classifier-failure result. OC2 `auto` replies without classification. OC2 `safety` replies only after an explicit `accept` verdict; a missing provider, classifier failure, or `hold` leaves the request for the user. `isPermissionAutoAnswered` separates a replied request from a held one for notification ownership. A `permission.replied` event clears the outcome and routing decision.

## Routes

- `GET /api/permission-auto-accept`
- `PUT /api/permission-auto-accept/sessions/:sessionId`

These are normal authenticated OpenChamber runtime routes. They must not be added to browser URL-token allowlists.

## UI ownership

`packages/ui/src/stores/permissionStore.ts` is a projection of server policy and does not persist an independent policy. The server is the sole responder and the UI renders pending requests until the authoritative `permission.replied` event arrives.

VS Code retains its foreground-only responder because it does not run the web server runtime. Its extension host persists and broadcasts the authoritative policy across webviews, while the active UI handles live events plus startup, reconnect, and enablement reconciliation. With all OpenChamber webviews closed or suspended, permissions are not auto-accepted; this is an intentional VS Code limitation.

## Tests

`runtime.test.js` covers restart persistence, nearest explicit subagent inheritance, missing-lineage lookup, retry/deduplication, and reconnect reconciliation.
