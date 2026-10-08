# listChildren

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

List child sessions for one parent session.

## Input fields

Required: workspaceID, sessionID

Optional: cursor, limit

[Generated JSON schema and examples](schemas/listChildren.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- The sessionID selects the parent; returned children belong to this workspace and must not be the parent itself.
- Pagination applies to children and does not imply all children were returned.

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
  "items": [
    {
      "id": "fixture-child",
      "workspaceID": "fixture-workspace",
      "title": "Fixture session",
      "parentID": "fixture-session"
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

children

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
