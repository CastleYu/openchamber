# addSynthetic

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Append a host-provided synthetic message.

## Input fields

Required: workspaceID, sessionID, text, requestID

Optional: None

[Generated JSON schema and examples](schemas/addSynthetic.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- requestID identifies this write.
- The stored message uses the synthetic role and is not a user-authored message.

Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "text": "Fixture context",
  "requestID": "fixture-request"
}
```

## Valid result example

```json
{
  "id": "fixture-message",
  "sessionID": "fixture-session",
  "role": "synthetic",
  "parts": [
    {
      "id": "fixture-part",
      "type": "text",
      "text": "Fixture response"
    }
  ],
  "state": "complete",
  "finish": "stop"
}
```

## Rejected result example

```json
{
  "id": "fixture-message",
  "sessionID": "fixture-session",
  "role": "human",
  "parts": [
    {
      "id": "fixture-part",
      "type": "text",
      "text": "Fixture response"
    }
  ],
  "state": "complete",
  "finish": "stop"
}
```

## Related action IDs

synthetic

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
