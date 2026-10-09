# Legacy 1.2.27 evidence checkpoint

Updated 2026-10-09 at OpenChamber base `ca43c5a01`. INT-00L passed as a contract preflight; full Legacy application acceptance remains in INT-03 and later gates. This checkpoint records exact source/schema evidence and 27 checks against the official executable. The controlled conversation and active-directory scope evidence is recorded below. The temporary CAgent Release is already delivered. Continue from the [milestone queue](OPENCODE-INTEGRATION-MILESTONES.md).

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
| L04 shell | OpenAPI and route annotation declare a bare AssistantMessage. SessionPrompt.shell returns `{info, parts}`; the official executable returns that envelope for a completed echo command. | Project the observed envelope. Do not use the response annotation as the implementation contract. |
| L05 diff | FileDiff requires file, before, after, additions and deletions; status is optional. | Preserve full before/after content. Empty real response does not validate nonempty diff mapping. |
| L06 decisions | Permission and question list/reply routes exist. PermissionRequest declares id/sessionID/permission/patterns/metadata/always; QuestionRequest declares id/sessionID/questions. | Capture pending real requests and event/reply/reconnect behavior before accepting these operations. |
| L09 events | `/event` and `/global/event` declare SSE. | First connection, ordering, completion and recovery require executable evidence; no replay guarantee has been established. |
| L12 disposal | `POST /instance/dispose` calls Instance.dispose; `POST /global/dispose` calls Instance.disposeAll. Both declare boolean responses. | Exercise two isolated directories and prove scope/recovery. Do not promote directory disposal to global disposal. |

Source owners are [server.ts](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/server/server.ts) and the same commit's global/session/permission/question/config route files. Source evidence does not establish live auth, actual responses, model execution, plugin compatibility, host parity or storage isolation.

## Executable checkpoint

The complete ZIP matched the published digest. Extracted executable SHA-256 is `dc9c7a2f97101329459fc46500913cc0c9d6514c39a6820fc720423ad04823b4`; both `--version` and authenticated health identify 1.2.27. It ran on loopback with separate XDG data/config/cache/state and test home. Auto-update, default plugins, models fetch, project config, external skills and LSP downloads were disabled. Only required operating-system variables were inherited; the fresh Basic password was neither logged nor persisted.

Local artifacts are `artifacts/legacy-1.2.27/run-SIvnhx/identity.json` and `fixtures.json`. The 27 checks cover health rejection/acceptance, path/project/catalog reads, session create/get/update/history, a stored `noReply` user message without a model call, a completed echo shell, invalid prompt input, missing session, initial SSE connection, directory disposal and global disposal. Create/update success discarded the supplied metadata. Directory B remained readable after disposing A; this does not prove its existing streams or active approvals survive.

The final controlled-provider run captured 45 HTTP requests, 252 events and 11 local model requests. The [sanitized wire evidence](evidence/2026-10-09-legacy-contracts.json) preserves request/response shapes and selected event ordinals. It proves streamed text completion and stored history, prompt_async 204 acceptance followed by completed history, pending bash permission and question replies, a completed file edit, nonempty diff, MessageAbortedError after stop, and directory disposal/rebootstrap. While disposing A, B retained a pending approval and its existing stream delivered the approval reply and completed work. This tests API contracts through the official executable with a controlled local provider; it does not measure a real model or accept the OpenChamber Legacy UI.

Reproduce on Windows with Node, Git and the verified executable at `<fixture-root>/bin/opencode.exe`:

`node scripts/legacy-contract-probe.mjs <fixture-root>`

The harness verifies the executable digest, creates its own Git projects and data directories, and cleans up only its child server and local provider sockets. Read result.json together with fixtures.json; nonemptyDiff must be true. Syntax and authored-file oxlint pass. The required dead-code report completes without flagging this script; it retains repository-wide unused-file/export findings.

Two earlier instant tool-output runs edited the file before the first recorded step-start snapshot and returned an empty diff. Waiting for the observed step-start before emitting the controlled tool produced the recorded full diff. This timing limit remains an upstream acceptance case for INT-04/INT-10, rather than a guarantee that all tool streams produce diffs.

The pinned schema exposes messageID and message/history reads, but no separate idempotency-key, retention or request-outcome lookup guarantee was established. Treat interrupted mutation outcomes as unknown and do not automatically resend. Replay/reconnect, attachments, advanced operations, config/plugins/MCP, profile selection and host parity retain their later gates. The dedicated Legacy profile stays disabled until its implementations pass.


## Probe correction scope

Web uses the shared detector; Electron reuses the in-process Web backend; VS Code imports the same detector in its extension host; hosted mobile and Capacitor use the selected host descriptor. Each stops after an authenticated stable 1.2.27 health response. No UI, bridge payload or persisted profile changes in this correction. Other versions retain their health/info comparison, now sequential. A slow health probe can therefore delay the info probe by its existing five-second timeout. This does not enable the dedicated Legacy profile.

Focused compatibility/kernel-runtime tests pass 38 cases, including three stable-version representations and a prerelease contradiction. Web and VS Code type-checks pass; authored-file oxlint reports no diagnostics. Packaged host behavior was not rerun for this correction. The published CAgent preview remains pinned to its original release source.
