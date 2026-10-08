# sendCommand

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Submit a named command with its argument string.

## Input fields

Required: workspaceID, sessionID, requestID, commandID, arguments

Optional: model, agent

[Generated JSON schema and examples](schemas/sendCommand.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- commandID selects the command and arguments may be empty.
- Acceptance is not command completion.

Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "requestID": "fixture-request",
  "commandID": "fixture-command",
  "arguments": ""
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
  "state": "complete"
}
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
