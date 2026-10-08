# CAgent execution checkpoint

Updated 2026-10-09. English implementation handoff. The [Chinese review copy](zh-CN/CAGENT-EXECUTION.md) stays synchronized until a recorded handoff revision.

## Frozen baseline and independent branch

Base source revision: `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6`. Worktree: `dijiang-next`. Branch: `codex/cagent-integration`. No upstream advance is included. This task does not push or advance `codex/personal` or the parallel DIJIANG 4.1 worktree.

Locked dependencies installed successfully without manifest or lockfile changes. Actual local toolchain is Bun 1.3.14 and Node 24.9.0. The manifest requests Bun 1.4.2; release verification must reconcile that difference before claiming the prescribed build toolchain.

## INT-00 acceptance

The baseline gate is complete for the selected CAgent contract work. It establishes source and contract-test evidence, not live OpenCode or CAgent compatibility.

| Check | Current result | Evidence |
| --- | --- | --- |
| UI generation, facade, events and sync baseline | 87 tests passed across 14 isolated files | `scripts/test-dual-kernel.mjs`; [log](evidence/2026-10-08-int00-ui-tests.log) |
| Host runtime, operations and managed-generation boundary | 47 tests passed across 3 files | Package Vitest runner; [log](evidence/2026-10-08-int00-host-tests.log) |
| Workspace type-check | All six workspaces passed | `bun run type-check`; [log](evidence/2026-10-08-int00-typecheck.log) |
| Consumed operation evidence | 118 public UI methods, 23 host operations, 496 named references, 32 SDK access references and 87 SDK imports | [Source inventory](evidence/2026-10-08-cagent-consumers.json) |
| Original requirements and Legacy coverage | 3.1–3.7 map to the existing milestone traceability; L01–L15 map to the Legacy coverage ledger | [Milestones](OPENCODE-INTEGRATION-MILESTONES.md#requirement-traceability), [Legacy ledger](OPENCODE-LEGACY-1.2.27-SPEC.md) |

The lead checked all 38 initial evidence snippets against their recorded source lines, then expanded the method/reference inventory using the installed TypeScript parser. AST references include declarations and potentially unused methods. Counts are not a feature count or an exhaustive dynamic-call claim. CA-00 must classify actual consumers, direct HTTP paths and SDK leaks before its gate passes.

The first host check used Node's test runner on Vitest files and failed during runner initialization. The corrected package Vitest run passed. This was a command defect, not an observed application failure; the failure and correction are recorded in the task command notes.

Historical broad UI/Web failures remain historical evidence. The current focused baseline resolves the descriptor/session/event contracts needed for this work; it does not establish that all old failures are fixed. No broad test-suite, live server, packaged runtime, native menu or exact 1.2.27 acceptance was performed here. CA-01 requires regressions after its actual changes; release requires the applicable full checks and real launch validation.

## CA-00 acceptance and next checkpoint

CA-00 passed source classification. The [consumer boundaries](CAGENT-BOUNDARIES.md) freeze module ownership, feature dependency semantics, direct HTTP/SDK leak decisions and protected adapter boundaries. The [machine registry](evidence/2026-10-09-cagent-boundaries.json) assigns all 118 UI methods and 23 host operations exactly once. Coverage checks found no missing, extra or duplicate methods; all 496 recorded references resolve to a disposition. Each caller inherits its referenced method's owner and migration decision. Dynamic or new callers still require authoritative dispatch guards. No capability is enabled by this classification.

Docs-only checks passed: four changed English/Chinese document pairs have matching table-row counts; 58 relative links resolve; `git diff --check` is clean. The lead reviewed the new translation and corrected a conditional-dependency ambiguity. No executable tests were rerun because CA-00 changed only documents and source classification evidence.

Then execute CA-01 host contracts/guards and CA-02 offline kit. CA-03 still requires API documents and live acceptance inside the target environment. Publish a temporary release only with its actual accepted scope; synthetic backends cannot establish real CAgent support. Other INT implementation remains behind CA-03.

Before each checkpoint transition, read live weekly quota. Stop when remaining quota is below 10% or the next checkpoint cannot reasonably fit. INT-00 started with 76% remaining and exited with 75% remaining. CA-00 also has 75% remaining from the live account API on 2026-10-09. CA-01 can proceed within that budget.

CA-01 starts with the neutral host contracts and guarded dispatcher in `packages/web/server/lib/agent/`, then binds actual consumers. Remove raw protocol dependencies from autonomous readers: `session-goal/runtime.js` reconstructs messages through `item.raw`, and `kernel-operations.d.ts` exports SDK-shaped payloads. UI SDK escapes include provider OAuth, `useMcpStore`, session move, sync and Git generation. Keep local filesystem operations on their current host; `searchFiles` uses OpenCode file discovery and must be gated separately. Also split `createDirectory(asProject)` from plain mkdir because it calls `/opencode/directory`. These are accepted migration decisions. CA-01 is in progress, not complete; no remote publish or Release has been delivered.

## CA-01 implementation checkpoint

The [new owning module](../../packages/web/server/lib/agent/DOCUMENTATION.md) contains centralized operation/refusal constants, runtime-neutral declarations for 22 host read/effect operations plus identity capture, and a tested dispatcher. Candidate support is separate from host-owned acceptance. Unsupported/unverified/unaccepted/unready/unauthorized operations are refused before entering a handler. Family, connection, epoch, adapter revision and capability revision scope a call. Stale reads are rejected; an already-started mutation returns an unknown-outcome error after switching, without retry or replay.

Final focused package Vitest run used the fixed package runner, version 4.1.5: four files and 68 tests passed, including dispatcher behavior, type-contract assertions and existing kernel runtime/operation regressions. Direct TypeScript compilation of `contracts.test.ts` also passed with strict checking and compile-only negative calls for invalid inputs/IDs. Web package type-check and lint passed. The vendored anti-slop check passed on all five authored JS/TS declaration/test files.

The dispatcher is not yet connected to production composition, routes, UI or autonomous callers. Declarations still need richer message/decision semantics before those consumers migrate. Activation storage, boundary schemas, durable attempt/outcome handling, feature dependencies and real adapter handlers remain required. Tests exercise synthetic host bindings, not real CAgent support. All five hosts still have CAgent unavailable, as stated in the owning module.

Final dead-code inspection ran after the new type consumer/imports: 2 unused files, 319 unused exports, 231 unused exported types and 1 duplicate export remain in the repository report. There is no remaining agent-module row in that report. Test references still do not constitute production integration, so the CA-01 completion gate stays open. No unrelated cleanup was performed.

Command corrections are recorded in task notes. Sandboxed esbuild failed with EPERM before tests; the scoped package runner passed after escalation. Sandboxed Bun could not find existing package scripts even with explicit cwd; the identical scoped escalation passed. Running Vitest from root selected version 5.0.3, so its result was superseded by the fixed package 4.1.5 run. No package manifest or lockfile was changed.

Restore by checking out the frozen baseline while preserving this task's documents and user data. No credentials, runtime configuration or queued intent were changed during INT-00. This checkpoint does not authorize automatic replay after a later backend switch.
