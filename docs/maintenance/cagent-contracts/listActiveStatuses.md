# listActiveStatuses

Fixture IDs are synthetic. This page defines no CAgent API route or support claim.

## Goal

Read active status snapshots for a workspace.

## Input fields

Required: workspaceID

Optional: None

[Generated JSON schema and examples](schemas/listActiveStatuses.json)

JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.

## Required semantics

- Each row names its own session.
- An empty array means no statuses were returned, not a failed read.

Read failure must remain a failure. Never replace it with empty successful data.

## Valid input example

```json
{
  "workspaceID": "fixture-workspace"
}
```

## Valid result example

```json
[
  {
    "sessionID": "fixture-session",
    "state": "idle"
  }
]
```

## Rejected result example

```json
[
  {
    "sessionID": "fixture-session"
  }
]
```

## Related action IDs

activity

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
