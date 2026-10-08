# getMessage

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Read one message from a session.

## Input fields

Required: workspaceID, sessionID, messageID

Optional: None

[Generated JSON schema and examples](schemas/getMessage.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- All three identifiers scope the lookup.
- Optional message metadata may be absent.

Read failure must remain a failure. Never replace it with empty successful data.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "messageID": "fixture-message"
}
```

## Valid result example

```json
{
  "id": "fixture-message",
  "sessionID": "fixture-session",
  "role": "assistant",
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
  "role": "assistant",
  "parts": [],
  "state": "done"
}
```

## Related action IDs

message

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
