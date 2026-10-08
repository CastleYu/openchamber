# getDefaultModel

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Read the backend default model when one is defined.

## Input fields

Required: workspaceID

Optional: None

[Generated JSON schema and examples](schemas/getDefaultModel.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- modelID is null when the backend reports no default.
- This does not enumerate the model catalog.

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
  "modelID": null
}
```

## Rejected result example

```json
{
  "modelID": 3
}
```

## Related action IDs

defaultModel

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
