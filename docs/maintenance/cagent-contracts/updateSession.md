# updateSession

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Update supplied session fields.

## Input fields

Required: workspaceID, sessionID, requestID

Optional: title, metadata

[Generated JSON schema and examples](schemas/updateSession.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- title and metadata may be omitted independently.
- The returned session is the backend record after the update.

Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "title": "Updated fixture",
  "requestID": "fixture-request"
}
```

## Valid result example

```json
{
  "id": "fixture-session",
  "workspaceID": "fixture-workspace",
  "title": "Updated fixture"
}
```

## Rejected result example

```json
{
  "id": "fixture-session"
}
```

## Related action IDs

update

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
