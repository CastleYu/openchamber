# listPendingPermissions

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Read pending permission requests for a workspace.

## Input fields

Required: workspaceID

Optional: None

[Generated JSON schema and examples](schemas/listPendingPermissions.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- Each permission names its session and offers explicit choices.
- Each choice carries both an allow or deny outcome and a valid scope.

Read failure must remain a failure. Never replace it with empty successful data.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace"
}
```

## Valid result example

```json
[
  {
    "id": "fixture-permission",
    "sessionID": "fixture-session",
    "description": "Read a fixture file",
    "choices": [
      {
        "id": "allow-once",
        "label": "Allow once",
        "outcome": "allow",
        "scope": "once"
      }
    ]
  }
]
```

## Rejected result example

```json
[
  {
    "id": "fixture-permission",
    "sessionID": "fixture-session",
    "description": "Read a fixture file",
    "choices": []
  }
]
```

## Related action IDs

permission

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
