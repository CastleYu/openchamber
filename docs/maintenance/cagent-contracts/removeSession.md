# removeSession

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Request removal of a session.

## Input fields

Required: workspaceID, sessionID, requestID

Optional: None

[Generated JSON schema and examples](schemas/removeSession.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- requestID identifies this mutation.
- An unknown receipt preserves uncertainty and must not be described as deletion success.

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
  "state": "deleted",
  "requestID": "fixture-request"
}
```

## Related action IDs

remove

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
