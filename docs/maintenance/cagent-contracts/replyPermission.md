# replyPermission

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Reply to one pending permission choice.

## Input fields

Required: workspaceID, sessionID, permissionID, choice, requestID

Optional: None

[Generated JSON schema and examples](schemas/replyPermission.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- Check permissionID and choice against the current pending request in this session. Preserve the documented outcome and scope; never widen once/session approval to persistent approval.
- A complete receipt records the reply operation, not success of the action that requested permission.

Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace",
  "sessionID": "fixture-session",
  "permissionID": "fixture-permission",
  "choice": "allow-once",
  "requestID": "fixture-request"
}
```

## Valid result example

```json
{
  "state": "complete",
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

permission

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
