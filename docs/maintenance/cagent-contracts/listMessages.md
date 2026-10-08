# listMessages

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Read a page of messages from one session.

## Input fields

Required: workspaceID, sessionID

Optional: cursor, limit

[Generated JSON schema and examples](schemas/listMessages.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- Every message belongs to sessionID. Preserve page order and ordered parts; part IDs must be unique within each message. Missing times and model metadata remain absent.
- Pagination belongs to this session history. A page boundary is distinct from an empty complete history.

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
  ]
}
```

## Rejected result example

```json
{
  "items": [
    {
      "id": "fixture-message",
      "sessionID": "fixture-session",
      "role": "assistant",
      "parts": [
        {
          "id": "fixture-part",
          "type": "text",
          "text": "Fixture response"
        },
        {
          "id": "fixture-part",
          "type": "text",
          "text": "Fixture response"
        }
      ],
      "state": "complete",
      "finish": "stop"
    }
  ]
}
```

## Related action IDs

history

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
