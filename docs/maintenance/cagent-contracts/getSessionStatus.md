# getSessionStatus

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Read the current status of one session.

## Input fields

Required: workspaceID, sessionID

Optional: None

[Generated JSON schema and examples](schemas/getSessionStatus.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- The result is scoped by workspaceID and sessionID.
- The status is a snapshot, not a completion receipt.

Read failure must remain a failure. Never replace it with empty successful data.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session"
}
```

## Valid result example

```json
{
  "sessionID": "fixture-session",
  "state": "idle"
}
```

## Rejected result example

```json
{
  "sessionID": "fixture-session",
  "state": "done"
}
```

## Related action IDs

prompt, command, stop

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
