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

The previous checkpoint used the fixed package Vitest runner, version 4.1.5: four files and 68 tests passed, including dispatcher behavior, type-contract assertions and existing kernel runtime/operation regressions. Direct TypeScript compilation of `contracts.test.ts` also passed with strict checking and compile-only negative calls for invalid inputs/IDs. Web package type-check and lint passed. The vendored anti-slop check passed on all five authored JS/TS declaration/test files.

The boundary checkpoint adds strict request/result schemas for all 22 operations and typed protocol constants shared by the Web and VS Code hosts. The dispatcher consumes parsed copies and rejects results after acceptance revocation. Once a mutation enters its handler, failure or malformed output reports an unknown outcome without replay. Six focused package Vitest files now pass 172 tests, including existing kernel runtime/operation regressions. Direct strict TypeScript compilation and new-module anti-slop checks pass.

Production Web composition now registers `/api/agent-backend/runtime` and `/api/agent-backend/dispatch` after the API authentication gate and before OpenCode proxy registration. Its binding deliberately remains inactive. HTTP tests cover actual Express body parsing, identity, authentication ordering, fixed refusal responses, malformed backend output and namespace isolation with synthetic bindings. All 11 HTTP mutation operations remain closed until durable pre-effect attempt storage is integrated. Webview and extension-host proxy guards return 501 for owned agent routes before forwarding. The extension-host refusal suite passes five tests. No real CAgent API is called.

The root type-check passed five workspaces and caught missing declarations for the JS constants consumed by VS Code. After adding exact `constants.d.ts` declarations, the corrected VS Code type-check passed, covering all six workspaces. Workspace lint passed with five existing UI warnings. Both VS Code proxy suites passed ten tests in total, including ordinary abort, session overlay and read coalescing regressions. The extension and webview build succeeded with chunk-size warnings. Server entrypoint and route syntax checks passed. Whole-file anti-slop still reports existing VS Code findings; the new Agent module passes without suppressions. No full production-server launch or packaged/native acceptance was performed.

CA-01 is still in progress. Production activation, UI and autonomous consumers are not migrated. Declarations still need richer message/decision semantics before those consumers migrate. Activation storage, durable attempt/outcome handling, feature dependencies and real adapter handlers remain required. All five hosts still have CAgent unavailable, as stated in the owning module. Next implement durable attempts, then protected activation and consumer migration before building the offline kit. Do not turn on a candidate adapter merely because schema tests pass.

Final dead-code inspection ran after the new type consumer/imports: 2 unused files, 319 unused exports, 231 unused exported types and 1 duplicate export remain in the repository report. There is no remaining agent-module row in that report. Test references still do not constitute production integration, so the CA-01 completion gate stays open. No unrelated cleanup was performed.

Command corrections are recorded in task notes. Sandboxed esbuild failed with EPERM before tests; the scoped package runner passed after escalation. Sandboxed Bun could not find existing package scripts even with explicit cwd; the identical scoped escalation passed. Running Vitest from root selected version 5.0.3, so its result was superseded by the fixed package 4.1.5 run. No package manifest or lockfile was changed.

Restore by checking out the frozen baseline while preserving this task's documents and user data. No credentials, runtime configuration or queued intent were changed during INT-00. This checkpoint does not authorize automatic replay after a later backend switch.

## CA-01 durable attempt checkpoint

The host dispatcher now requires attempt storage for all 11 mutations and a request ID in each mutation input. The native-file ledger reserves and syncs an unknown record before handler entry. Its exclusive key spans backend family, connection ID and request ID, preserving duplicate refusal across epoch/revision changes and dispatcher restart. Authority is rechecked after reservation and final persistence. Pre-handler revocation records `not-sent`; entered failures, mismatched/unknown receipts and persistence failure report unknown outcome without retry. Accepted receipts remain distinct from completed operations. The ledger contains no prompts, credentials or response payloads and never supplies live activity.

Seven fixed Web Vitest files pass 207 tests, including 14 native-filesystem ledger tests, dispatcher reservation/outcome cases, strict schemas, HTTP isolation and existing OpenCode kernel regressions. Final tests emit no file-handle leak warning. Strict direct contract compilation, root workspace type-check, separate VS Code type-check, workspace lint and new-module anti-slop checks pass. Lint retains five existing UI warnings. Dead-code reports 2 unused files, 320 unused exports, 231 unused exported types and 1 duplicate; the new `AgentAttemptError` export remains awaiting HTTP boundary consumption. No suppression or unrelated cleanup was added.

This is an internal persistence checkpoint, not CA-01 acceptance. HTTP mutations still return `write-unavailable`; production composition has not yet supplied the ledger or enabled a binding. Next integrate authenticated attempt lookup and durable HTTP dispatch, then protected activation and actual UI/autonomous consumers. Power-loss durability, Windows ACL enforcement, full production launch, real CAgent compatibility, remote publication and Release remain unverified or undelivered. The bilingual workbook now also requires deterministic documentation intake and protected disposition cases before kit acceptance.

## CA-01 durable HTTP checkpoint

Production composition now supplies the host-owned attempt store under the existing data directory. It is lazy and does not create records at startup. POST `/api/agent-backend/dispatch` uses the same capability, acceptance, identity and persistence checks as direct callers. POST `/api/agent-backend/attempt` strictly parses the expected identity and request ID in its body, checks current authorization/readiness/identity before and after storage access, and returns recorded history or explicit missing null. Corrupt storage is a fixed 503 refusal; duplicate dispatch and entered unknown outcomes are fixed 409 refusals. Adapter exception text never leaves these routes.

The binding remains inactive in production, so identity, dispatch and lookup all return `unavailable`; there is no real CAgent call or activation path yet. Web, Electron, hosted mobile and Capacitor share this server behavior. VS Code still returns 501 for the entire owned namespace before OpenCode forwarding. Host-owned history lookup is separate from the frozen adapter operation inventory and cannot establish completion or live activity.

Seven fixed Web Vitest files pass 219 tests. Real Express requests cover accepted durable dispatch, duplicate refusal after recreating the dispatcher/store, lost acknowledgement with unknown history, missing and corrupt records, body validation, authorization and stale identity. Five Bun-run VS Code proxy tests pass. Root workspace and separate VS Code type-check, direct strict contract compilation, workspace lint, new-module anti-slop and server entrypoint syntax checks pass. Lint retains five existing UI warnings. Dead-code returns to 2 unused files, 319 unused exports, 231 unused exported types and 1 duplicate, with no Agent module row. The first VS Code run used Node against `bun:test` and failed before execution; the Bun result supersedes it. No full production-server/native launch or actual CAgent acceptance was performed.

Live weekly quota remains 74% at this checkpoint. CA-01 stays in progress. Next implement protected activation and capability dependency guards, migrate the actual UI/autonomous consumers, and prove current OC1/OC2 behavior before delivering CA-02. Remote publication and Release remain outstanding.

## CA-01 host authority checkpoint

The durable HTTP checkpoint was committed as `2f87424fd` on `codex/cagent-integration`. This next step introduces `createAgentAuthority`: protected host registrations and independent selection/approval ports produce immutable dispatcher bindings. Approval matches backend family, connection, adapter ID/revision, capability revision, tested server revision and host-supplied artifact digest. It validates independent per-operation evidence, filters ineligible rows without discarding unrelated accepted operations and rechecks ports at each call. Candidate support alone grants nothing. Invalid selections, host-port failure, stale approvals, revocation and lost authorization cannot enter a handler or return an accepted stale read.

The authenticated runtime route now returns identity and a complete 22-operation availability snapshot using the same eligibility rules as dispatch, including write-storage requirements. It invokes no handlers and exposes only fixed refusal codes. Actual dispatch still rechecks current authority; the snapshot cannot grant permission. This is operation availability, not a completed feature dependency registry.

Eight fixed Web Vitest files pass 246 tests, including synthetic authority/dispatcher integration, exact approval matching, frozen copies, revocation, refusal before approval-storage access and runtime HTTP snapshots, plus existing kernel regressions. Direct strict contract compilation, new-module anti-slop, server/module syntax, root workspace and separate VS Code type-check, workspace lint and diff checks pass. Lint retains five existing UI warnings. Dead-code reports 2 unused files, 319 unused exports, 231 unused exported types and 1 duplicate, with no Agent module row. English/Chinese structure and 23 local links pass the paired documentation check. No package manifest, lockfile or release version changed.

Production remains inactive with an empty registry and null selection/approval ports. No real CAgent adapter is imported or called. Digest comparison does not compute adapter hashes or verify evidence artifacts; protected kit verification and approval storage remain outstanding. Actual UI/autonomous consumers, richer message/decision contracts and feature guards still block CA-01 acceptance. Web/Electron/hosted-mobile/Capacitor still return unavailable; VS Code's namespace remains unavailable. No native launch, live CAgent acceptance, remote publication or Release is claimed. Continue with these remaining CA-01 contracts before CA-02 delivery.

The final live account query reports 73% weekly quota remaining. This is a validated internal checkpoint, not milestone completion; the goal and its independent remote branch/temporary Release deliverables remain active. No reset credit was used.

## CA-01 message and permission checkpoint

The neutral message contract now preserves ordered text, reasoning, tool and owned attachment references, with explicit tool results/errors and session identity. It replaces flattened text. Unknown/interrupted state is explicit. Model identity, chronology and verified usage are optional; missing values must remain missing and gate dependent behavior. Token counts reject negative, fractional and nonfinite values. Permissions carry labeled choice IDs with allow/deny meaning and once/session/persistent scope. The adapter cannot widen a documented scope by translating its label alone.

Dispatch rejects message reads belonging to another session or message ID. A synthetic insertion returning the wrong session is an entered unknown outcome, retained in the durable ledger without replay. Imports reject mixed workspace/session ownership before handler entry. These are neutral contract checks; existing UI, decision requests and goal runtime still require migration. Question/form, specialized message workflows and authenticated attachment resolution are not implemented by these schemas.

Nine fixed Web Vitest files pass 270 tests, including new content/type and authenticated message HTTP tests, durable unknown outcomes and existing kernel regressions. Direct strict contract compilation, module anti-slop, module syntax, root workspace type-check and diff checks pass. Workspace lint passes with five existing UI warnings and no errors. Dead-code reports 2 unused files, 319 unused exports, 231 unused exported types and 1 duplicate, with no Agent module row. Both document pairs have matching structures and 23 resolving local links. The first direct Bun invocation initialized zero tests due to unavailable Zod named imports, including unchanged kernel suites; the corrected Node/package Vitest run is the authoritative result. The environment correction is recorded in task command notes.

CA-01 remains in progress. Continue with protected approval/artifact verification and actual feature/consumer migration before CA-02 kit acceptance. No real CAgent API, packaged runtime, remote publication or temporary Release has been accepted here. English owning documentation and the full Chinese review copy remain synchronized.

Final live weekly quota remains 73%. The milestone and publication goal are still active; this checkpoint does not satisfy their completion gates.

## CA-01 artifact verification checkpoint

`artifacts.js` now validates a dedicated snapshot against a protected versioned manifest, hashes each file in bounded chunks and checks the canonical aggregate digest. It rejects unsafe or aliased paths, unlisted or missing entries, links, mismatched bytes and observed read-time changes. The expected manifest is a detached copy before asynchronous reads. Verification does not import code, activate capabilities or establish evidence semantics. Protected immutable snapshot loading and independent approval storage remain outstanding.

Final focused validation passes 292 tests in ten Web Vitest files, including native filesystem and directory-junction checks without skips, plus existing kernel regressions. Direct strict contract compilation, module anti-slop, source syntax, Web package type-check/lint and diff checks pass. No real CAgent API, full server launch, packaged app or release is covered. The preceding workbook changes also bound weak-model packet scope, context, output and correction attempts; English and Chinese copies remain synchronized.

Live weekly quota is 73% remaining. CA-01 remains in progress. Next connect protected acceptance/loading to host authority, complete the missing consumed contracts and migrate feature dependency guards and actual UI/autonomous callers. CA-02 kit, CA-03 real local acceptance, independent remote publication and temporary Release are still required. Lower-priority INT implementation remains behind CA-03.

## CA-01 approval reader checkpoint

The host now composes a read-only persisted approval port. Its strict version-1 records bind a reviewed adapter/server/capability revision and artifact digest to a family/connection tuple. Each check reads one file with a 64 KiB bound, without cached authorization. Missing approval grants nothing; malformed data, links and observed read changes are refused. Replacement and deletion take effect on subsequent checks, including refusal after a handler revokes its own approval. Unauthorized or unready selections do not access storage. The reader has no writer or public activation route.

Eleven fixed Web Vitest files pass 315 tests, with no skips. Direct strict contract compilation, module anti-slop, server/reader syntax and Web package type-check/lint pass. Dead-code reports 2 unused files, 319 unused exports, 231 unused exported types and 1 duplicate, with no Agent module row. Native file tests cover restart, replacement, deletion, invalid UTF-8/JSON, bounds, links and authority integration. These tests do not establish Windows ACL isolation, real CAgent semantics, full server/native launch or publication. Production still has an empty registry and null selection, so it performs no approval access and CAgent remains unavailable.

CA-01 remains in progress. The protected runner must write reviewed approvals, protect its files and load only the verified immutable adapter. Feature dependency guards, actual UI/autonomous consumers and remaining consumed contracts still precede CA-02 acceptance. The live weekly quota is 72% remaining. Remote publication and temporary Release remain outstanding; lower-priority INT work remains after CA-03.

## CA-01 action dependency checkpoint

`features.js` freezes 17 action rules across the current 22-operation inventory. All-of rules include prerequisite reads; session acquisition accepts verified creation or binding an existing session. A host-owned implementation port must match the current full identity before an action becomes available. Missing/invalid host support is explicitly unmigrated, separate from unverified/unsupported backend operations. The guard rereads authority and refuses stale identities. It does not invoke handlers or turn a snapshot into a dispatch lease. GET `/api/agent-backend/features` is composed after authentication and before proxy fallback, with strict complete-response validation and fixed refusal codes.

This is partial CA-01 implementation, not a completed product feature registry. Actual UI/shortcuts/browser-closed callers do not yet use the feature check. Full chat, queue/goals, sync, assets, specialized decisions and extensions still need their consumed contracts, semantic gates and migration. Production has neither an active adapter nor a host implementation port, so CAgent stays unavailable. These actions cannot prove real server support or unattended completion.

Twelve fixed Web Vitest files pass 334 tests with no skips, including existing kernel regressions. Web type-check/lint, direct strict contract compilation, module anti-slop and server syntax checks pass. Dead-code retains 2 unused files, 319 unused exports, 231 unused exported types and 1 duplicate, with no Agent module row. Feature tests cover operation/feature authority, alternative acquisition, missing storage, current host implementation, HTTP authentication and fixed errors without executing adapter handlers. These checks do not establish full production/native launch or real CAgent compatibility.

The live weekly quota remains 72%. The next CA-01 work is protected snapshot loading, missing consumed contracts and actual feature/caller migration. CA-02 kit, CA-03 local live acceptance, independent remote branch publication and temporary Release remain outstanding. Lower-priority INT work stays behind CA-03.

## CA-01 adapter source loading checkpoint

The host-only loader now imports the verified in-memory `adapter.mjs` bytes. It never reopens the source path after verification. A strict factory receives a frozen JSON request port and must carry the current runtime identity on every request. Protected profile metadata and the computed artifact digest belong to the host. Capability declarations alone grant no approval. The shared registration schema retains the authority boundary, and native module tests demonstrate separate factory contexts despite Node's module cache.

Thirteen fixed Web Vitest files pass 342 tests without skips. The lead corrected a test that previously stopped after the first invalid request and replaced an unused spy with the actual transport-call assertion. Tests cover all listed malformed request cases, import refusal before module evaluation, captured-byte stability, strict candidate exports and dispatch before/after independent approval. Web type-check/lint, direct strict contract compilation, module anti-slop, loader syntax and diff checks pass. Dead-code retains 2 unused files, 319 unused exports, 231 unused exported types and 1 duplicate, without an Agent module row.

This is reviewed native code loading, not process isolation or production activation. The host still needs current connection/epoch transport enforcement, selection composition, protected approval writing and actual consumer migration. Binary/streaming ports and remaining consumed contracts are unfinished. No actual CAgent API, full production/native launch, remote publication or Release is claimed. CA-01 remains in progress; CA-02 and CA-03 remain pending. Live weekly quota remains 72%, and lower-priority INT work remains after CA-03.
