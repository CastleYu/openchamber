# getSelectionCatalog

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Read the explicit model and agent catalog.

## Input fields

Required: workspaceID

Optional: None

[Generated JSON schema and examples](schemas/getSelectionCatalog.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- Models and agents are separate lists.
- An empty list means the catalog reported no entries; no model is inferred as default.

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
  "models": [
    {
      "id": "fixture-model",
      "label": "Fixture model"
    }
  ],
  "agents": []
}
```

## Rejected result example

```json
{
  "models": [
    {
      "id": "fixture-model"
    }
  ],
  "agents": []
}
```

## Related action IDs

selection

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
