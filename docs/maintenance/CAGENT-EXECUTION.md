# CAgent execution checkpoint

Updated 2026-10-08. English implementation handoff. The [Chinese review copy](zh-CN/CAGENT-EXECUTION.md) stays synchronized until a recorded handoff revision.

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

## Next checkpoint

CA-00 is in progress. The lead owns the feature dependency registry, module ownership, SDK/HTTP leak decisions and protected adapter boundaries. The source inventory identifies browser-closed callers in queue, schedules, assist, goals, routing, notifications, control, context, knowledge and session-work modules. It remains an input to classification, not a declaration that those features support CAgent.

Then execute CA-01 host contracts/guards and CA-02 offline kit. CA-03 still requires API documents and live acceptance inside the target environment. Publish a temporary release only with its actual accepted scope; synthetic backends cannot establish real CAgent support. Other INT implementation remains behind CA-03.

Before each checkpoint transition, read live weekly quota. Stop when remaining quota is below 10% or the next checkpoint cannot reasonably fit. INT-00 started with 76% remaining and exited with 75% remaining, from the live account usage API on 2026-10-08. Continue CA-00 within that budget.

The next source review must remove raw protocol dependencies from autonomous readers: `session-goal/runtime.js` reconstructs messages through `item.raw`, and `kernel-operations.d.ts` exports SDK-shaped payloads. UI SDK escapes include provider OAuth, `useMcpStore`, session move, sync and Git generation. Keep local filesystem operations on their current host; `searchFiles` uses OpenCode file discovery and must be gated separately. These are migration decisions to finish in CA-00, not completed changes.

Restore by checking out the frozen baseline while preserving this task's documents and user data. No credentials, runtime configuration or queued intent were changed during INT-00. This checkpoint does not authorize automatic replay after a later backend switch.
