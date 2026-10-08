# interruptSession

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Request interruption of session work.

## Input fields

Required: workspaceID, sessionID, requestID

Optional: None

[Generated JSON schema and examples](schemas/interruptSession.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- requestID identifies the interruption attempt.
- A complete receipt reports the control request completed, not that an already-finished task was undone.

Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "requestID": "fixture-request"
}
```

## Valid result example

```json
{
  "state": "complete",
  "requestID": "fixture-request"
}
```

## Rejected result example

```json
{
  "state": "complete"
}
```

## Related action IDs

stop

## Refusal examples

These are host refusals, not CAgent wire errors. The local API documentation must define the wire error mapping.

```json
{
  "error": "unverified"
}
```

```json
{
  "error": "unsupported"
}
```

```json
{
  "error": "backend-failed"
}
```
