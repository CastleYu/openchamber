# sendPrompt

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Submit prompt text to a session.

## Input fields

Required: workspaceID, sessionID, requestID, text

Optional: model, agent

[Generated JSON schema and examples](schemas/sendPrompt.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- model and agent are optional explicit selection overrides.
- An accepted receipt means accepted for processing, not that generation completed; unknown preserves an indeterminate outcome.

Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "requestID": "fixture-request",
  "text": "Fixture prompt",
  "model": "fixture-model"
}
```

## Valid result example

```json
{
  "state": "accepted",
  "requestID": "fixture-request"
}
```

## Rejected result example

```json
{
  "state": "accepted"
}
```

## Related action IDs

prompt

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
