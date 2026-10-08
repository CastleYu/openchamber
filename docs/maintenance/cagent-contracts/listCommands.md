# listCommands

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

List commands available in a workspace.

## Input fields

Required: workspaceID

Optional: None

[Generated JSON schema and examples](schemas/listCommands.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- Commands are explicit backend entries.
- Optional descriptions may be absent.

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
    "id": "fixture-command",
    "label": "Fixture command"
  }
]
```

## Rejected result example

```json
[
  {
    "id": "fixture-command"
  }
]
```

## Related action IDs

command

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
