# listSessions

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

List sessions in one workspace.

## Input fields

Required: workspaceID

Optional: cursor, limit

[Generated JSON schema and examples](schemas/listSessions.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- cursor and limit are optional pagination inputs.
- next is omitted when there is no next page.

Read failure must remain a failure. Never replace it with empty successful data.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace"
}
```

## Valid result example

```json
{
  "items": [
    {
      "id": "fixture-session",
      "workspaceID": "fixture-workspace",
      "title": "Fixture session"
    }
  ]
}
```

## Rejected result example

```json
{
  "items": [
    {
      "id": "fixture-session"
    }
  ]
}
```

## Related action IDs

sessionList

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
