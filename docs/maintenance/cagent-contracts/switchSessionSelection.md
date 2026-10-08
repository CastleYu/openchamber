# switchSessionSelection

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Set the model or agent selection for a session.

## Input fields

Required: workspaceID, sessionID, requestID

Optional: model, agent

[Generated JSON schema and examples](schemas/switchSessionSelection.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- model and agent are independently optional.
- The returned selection reports selected values, not proof a later generation used them.

Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "model": "fixture-model",
  "requestID": "fixture-request"
}
```

## Valid result example

```json
{
  "model": "fixture-model"
}
```

## Rejected result example

```json
{
  "model": 4
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
