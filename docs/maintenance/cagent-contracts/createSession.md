# createSession

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Create a session in a selected workspace.

## Input fields

Required: workspaceID, requestID

Optional: title

[Generated JSON schema and examples](schemas/createSession.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- requestID identifies the write attempt.
- The returned session is the created record, not proof of later prompt completion.

Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "requestID": "fixture-request"
}
```

## Valid result example

```json
{
  "id": "fixture-session",
  "workspaceID": "fixture-workspace",
  "title": "Fixture session"
}
```

## Rejected result example

```json
{
  "id": "fixture-session"
}
```

## Related action IDs

acquireSession

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
