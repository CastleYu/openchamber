# ACP handoff

Review date: 2026-10-21. This is the canonical handoff. The [Chinese copy](ACP-HANDOFF.zh-CN.md) is an archive kept in sync with this file.

## Current state

The independent ACP route started from the last 4.X baseline, commit `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6` (`2.0.4-DIJIANG.4.0`). This handoff gathers the ACP work after `692c366d5e66e2cc95ebc6bcddae44787b80be44` into the snapshot containing this document on `codex/acp-handoff-20261021`. It is a source checkpoint, not a release.

Existing ACP releases are `ACP.2.1` and `ACP.3.1`. `ACP.3.1` corresponds to `692c366d5`, whose CI passed. This snapshot contains the subsequent Windows BAT/CMD startup and process cleanup, callbacks, elicitation, agent controls, project mappings, session actions, and real Windows scoped-discovery fix. The older local portable package does not contain the last fix.

## Decisions and history

The first 5.X plan aimed to preserve both OpenCode generations, including the legacy OpenCode 1.2.27 path, and add onboarding material for an unknown private CAgent as well as weaker models. That route accumulated too much design and took too long. The user paused 5.X and redirected the work to an independent ACP integration based on the last 4.X commit above. Do not restore or merge the paused 5.X work into this branch.

Connection choice must be explicit: select `cmd`, OpenCode server, or ACP. Do not infer the choice from environment variables and do not silently fall back to another mode or executable. Development was organized as Astra research, Sol implementation, then Grok 4.7 high review. Keep the scope bounded. Clear caches and temporary data after the owning processes exit; remove only task-owned temporary directories after confirming those processes have stopped.

## Acceptance evidence

Real Windows acceptance with OpenCode `1.19.0` and Qwen Code `0.25.1` passed all five planned checks. OpenCode covered concurrent sessions, file read/write approval and denial, cancellation, restart/resume, and history loading. The run found and fixed scoped session discovery for Windows paths with forward slashes, lowercase drive letters, and a trailing separator. Qwen's OpenCode Go requests initially failed because its provider requires `x-opencode-session`; configuring Qwen's supported dynamic session header fixed the requests without product code changes. The final checks completed with two concurrent sessions, approved and rejected writes, cancellation, and restart followed by a successful prompt.

The feature comparison has 38 entries. It is recorded in [ACP acceptance](ACP-ACCEPTANCE.md); do not duplicate its table here. That document also records the Grok `grok-4.7` high review: the model returned a complete review, but the CLI failed to archive its chat after a disk-space error. Treat the review content as captured evidence, not as a clean CLI exit.

The evidence supports the tested Windows backend paths. It does not establish acceptance for private CAgent environments that could not be accessed, exact OpenCode `1.2.27`, mobile devices, or remote ACP Server deployments. Fixture and browser checks are not substitutes for those environments. The local portable package predates the scoped-discovery fix.

## Next handoff

Handle publication as a separate task. The existing workflow only publishes from `codex/acp-integration`; the handoff does not widen that gate. Use [ACP](ACP.md), [ACP acceptance](ACP-ACCEPTANCE.md), and [ACP build](ACP-BUILD.md) for current behavior, evidence and release procedure. The root [branch README](../../README-ACP.md) is the entry point.

The [evidence index](evidence/acp-handoff/INDEX.md) preserves selected test output, review results and environment failure notes. Its inert `paused-5x-remnants.patch` preserves loose legacy files without activating them. Do not apply it to this branch as part of ACP continuation.

The original Codex conversation was not fully exported. This document captures the decisions and evidence needed to continue the work; it does not reproduce the full user environment or include secrets.
