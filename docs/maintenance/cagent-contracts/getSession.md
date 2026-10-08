# getSession

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Read one session owned by the selected backend.

## Input fields

Required: workspaceID, sessionID

Optional: None

[Generated JSON schema and examples](schemas/getSession.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- workspaceID and sessionID identify the same backend-owned session.
- Missing optional title, parentID, and metadata stay absent.

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

acquireSession, history, message, children, prompt, command, stop, selection, synthetic, fork, remove, update

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
