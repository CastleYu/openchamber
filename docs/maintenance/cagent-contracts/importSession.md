# importSession

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Import a session and its message records into the selected workspace.

## Input fields

Required: workspaceID, session, messages, requestID

Optional: None

[Generated JSON schema and examples](schemas/importSession.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- session.workspaceID must equal the input workspaceID; every message.sessionID must equal session.id.
- The operation imports supplied records; it does not claim the backend generated them.

Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "session": {
    "id": "fixture-session",
    "workspaceID": "fixture-workspace",
    "title": "Fixture session"
  },
  "messages": [
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
  ],
  "requestID": "fixture-request"
}
```

## Valid result example

```json
{
  "id": "fixture-session",
  "workspaceID": "fixture-workspace",
  "title": "Fixture session"
}
```

## Rejected result example

```json
{
  "id": "fixture-session"
}
```

## Related action IDs

import

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
