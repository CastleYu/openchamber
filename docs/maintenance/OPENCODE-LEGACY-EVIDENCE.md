# Legacy 1.2.27 evidence checkpoint

Updated 2026-10-09 at OpenChamber base `ca43c5a01`. INT-00L is in progress. This checkpoint records exact source/schema evidence; executable acceptance remains open. The temporary CAgent Release is already delivered. Continue from the [milestone queue](OPENCODE-INTEGRATION-MILESTONES.md).

## Pinned origin

- Official [v1.2.27 release](https://github.com/anomalyco/opencode/releases/tag/v1.2.27).
- The tag resolves directly to commit `4ee426ba549131c4903a71dfb6259200467aca81`; the release's mutable target label is `dev` and is not the source pin.
- [OpenAPI at that commit](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/sdk/openapi.json): SHA-256 `ef236d6647f0b462ac7fb03454ae1a75575d951ff75021d7af7b38c8c34a84dd`; 104 operations across 86 paths. Its `info.version` is `1.0.0`, so it cannot identify the runtime version.
- Official Windows x64 ZIP asset ID `374649821`, expected size 47,156,872 bytes and release digest `9e2e43568e6f952e8c7cb77b934fbff53f454f0213688f24f3c3769b69703e84`. Download is not executable acceptance. Check the complete archive digest, extracted executable digest, `--version`, and responding health identity before capturing fixtures.

## Verified source contracts

| Group | Exact source/schema finding | Implementation consequence / remaining evidence |
| --- | --- | --- |
| L01 identity | `GET /global/health` declares `healthy` and `version`; the server uses optional HTTP Basic auth. `/api/info` is absent from this OpenAPI. | Probe the selected endpoint with correct credentials; test actual fallback behavior and failures. Do not use OpenAPI info.version as identity. |
| L02 sessions | Create accepts parentID/title/permission/workspaceID. Update accepts title and time.archived. Neither contract accepts metadata; the route handler updates only title/archive time. | Current metadata-dependent features need an explicit owned supplementary record and tested round trip. Do not equate an HTTP success with metadata persistence. |
| L03 dispatch | `prompt_async` declares HTTP 204 acceptance; request accepts messageID/model/agent/parts and other declared fields. | Acceptance is not completion. Idempotency/lookup guarantees remain unproven; retain the unknown-outcome policy. |
| L04 shell | OpenAPI and route response annotation declare a bare AssistantMessage, while the handler returns the result of SessionPrompt.shell. | Capture the actual executable response before projecting it. The annotation alone does not prove the implementation's envelope. |
| L05 diff | FileDiff requires file, before, after, additions and deletions; status is optional. | Preserve full before/after content. Empty real response does not validate nonempty diff mapping. |
| L06 decisions | Permission and question list/reply routes exist. PermissionRequest declares id/sessionID/permission/patterns/metadata/always; QuestionRequest declares id/sessionID/questions. | Capture pending real requests and event/reply/reconnect behavior before accepting these operations. |
| L09 events | `/event` and `/global/event` declare SSE. | First connection, ordering, completion and recovery require executable evidence; no replay guarantee has been established. |
| L12 disposal | `POST /instance/dispose` calls Instance.dispose; `POST /global/dispose` calls Instance.disposeAll. Both declare boolean responses. | Exercise two isolated directories and prove scope/recovery. Do not promote directory disposal to global disposal. |

Source owners are [server.ts](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/server/server.ts) and the same commit's global/session/permission/question/config route files. Source evidence does not establish live auth, actual responses, model execution, plugin compatibility, host parity or storage isolation.

## Next acceptance step

Complete the official binary acquisition and verify its digest. Start only that executable on loopback in a new isolated working directory, with separate XDG data/config/cache/state and test home. Disable auto-update, default plugins, models fetch, project config, external skills and LSP downloads; inherit only required operating-system variables. Use a fresh test-only Basic password without logging or persisting it.

Capture sanitized identity, unauthorized response, path/project/catalog reads, session create/get/history/update, invalid input and missing-session errors, initial SSE, and two-directory/global disposal. Then obtain controlled prompt/tool/decision fixtures for the first Legacy conversation. Keep unresolved operation and host gates open. The experimental profile remains disabled until its operation implementations are accepted. Existing OC1/OC2 and the published CAgent preview are unchanged by this evidence-only checkpoint.
