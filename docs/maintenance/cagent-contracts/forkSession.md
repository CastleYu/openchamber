# forkSession

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Fork a session, optionally at a specific message.

## Input fields

Required: workspaceID, sessionID, requestID

Optional: messageID

[Generated JSON schema and examples](schemas/forkSession.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- Document whether the selected message is included, and the default cut when messageID is omitted. A maintainer must approve that behavior for the consuming feature before activation.
- The returned record identifies a new child in the selected workspace; the source session stays intact.

Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "messageID": "fixture-message",
  "requestID": "fixture-request"
}
```

## Valid result example

```json
{
  "id": "fixture-child",
  "workspaceID": "fixture-workspace",
  "title": "Fixture session",
  "parentID": "fixture-session"
}
```

## Rejected result example

```json
{
  "id": "fixture-child"
}
```

## Related action IDs

fork

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
