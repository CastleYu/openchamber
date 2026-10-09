# Agent integration milestones

Status: executing, 2026-10-09. INT-00 and CA-00 passed. The minimum CAgent architecture/kit preview is published; full consumer migration retains its later gates. INT-00L passed; INT-01 is in progress. Current evidence and handoff: [execution checkpoint](CAGENT-EXECUTION.md).
Contract owners: [integration SPEC](OPENCODE-INTEGRATION-SPEC.md), [Legacy SPEC](OPENCODE-LEGACY-1.2.27-SPEC.md), [CAgent SPEC](CAGENT-INTEGRATION-SPEC.md) and [CAgent adapter workbook](CAGENT-ADAPTER-WORKBOOK.md).

## Version boundary

Plan this capability family as DIJIANG 5.x, following the current 4.0 baseline. The proposed subversions below are delivery checkpoints within the one agent integration milestone, consistent with the maintainer-defined feature scope in [BUILD.md](BUILD.md). They do not change `featureVersion`, package versions, tags or release policy during planning. The upstream package version remains independent.

An early Release exposes only completed scope and does not claim full Legacy 1.2.27 or real CAgent compatibility. On 2026-10-09 the maintainer set the order: finish CA-01/CA-02 architecture and documentation, verify existing features, build and publish the temporary Release, then begin remaining INT work. CA-03 stays environment-local and does not block this toolchain release. The 5.0–5.13 labels are planned labels to reconcile before release; stable task IDs retain traceability.

This document owns status and acceptance for this integration milestone. PLAN.md routes RUN-01/RUN-02 here rather than maintaining duplicate status tables. The older upstream-intake and dual-kernel ledgers keep their historical evidence.

## Delivery queue

`ready` means work can begin, rather than evidence already exists. The shared prerequisite for remaining INT work is the CA-02 toolchain temporary Release; each task retains its own dependencies. INT-10 still requires CA-03 evidence if claiming real CAgent compatibility.

| ID | Planned subversion | Scope | Depends on | Status |
| --- | --- | --- | --- | --- |
| INT-00 | Preflight, no version bump | Freeze current OC1/OC2 baseline and relevant validation | None | done |
| CA-00 | No version bump | Inventory consumed operations and freeze CAgent ownership boundaries | INT-00 | done |
| CA-01 | 5.0 | Typed host contracts, capability guards and OC1/OC2 regressions | CA-00 | in progress |
| CA-02 | 5.1 | Complete offline adapter kit with protected tests, generator, sparse and synthetic-extension samples, allowlist validation and runnable toolchain | CA-01 | planned |
| CA-03 | 5.2 | Local real-server CAgent adaptation, minimum chat and complete feature disposition | CA-02 | planned |
| INT-00L | Preflight, no version bump | Exact 1.2.27 identity, wire contracts and isolated runtime evidence | INT-00, CA-02 Release | done; [source and executable evidence](OPENCODE-LEGACY-EVIDENCE.md) |
| INT-01 | 5.3 | Profile-aware facade, descriptor, automatic/manual selection and capability dispatch | INT-00, CA-02 Release | in progress |
| INT-02 | 5.4 | Five explicit connection modes, setup/migration and process switching | INT-01, CA-02 Release | planned |
| INT-03 | 5.5 | First usable Legacy conversation: session, history, streaming, decisions and stop | INT-01, INT-00L, CA-02 Release | planned |
| INT-04 | 5.6 | Advanced Legacy operations and reconnect recovery | INT-03, CA-02 Release | planned |
| INT-05 | 5.7 | Legacy settings, credentials, plugins/MCP and unattended operations | INT-04, CA-02 Release | planned |
| INT-06 | 5.8 | Current OC1/OC2 disposal, config apply and external/managed-server reload | INT-02, CA-02 Release | planned |
| INT-07 | 5.9 | Native menu localization | INT-00, CA-02 Release | planned |
| INT-08 | 5.10 | Persistent branch context and explicit draft refresh | INT-00, CA-02 Release | planned |
| INT-09 | 5.11 | Shared effective-shortcut hints and action coverage | INT-00, CA-02 Release | planned |
| INT-06L | 5.12 | Exact Legacy disposal and config-apply integration | INT-06, INT-03, INT-05 | planned |
| INT-10 | 5.13 | Cross-host integration, CAgent contract regression/backend switching, exact 1.2.27 acceptance and release candidate | CA-03, INT-01, INT-02, INT-03, INT-04, INT-05, INT-06, INT-07, INT-08, INT-09, INT-06L | planned |

## Completion contracts

### INT-00: evidence and scope

Pin the implementation checkout SHA and compare it with this audit's baseline. Record any concurrent upstream intake as a separate proposed scope; do not move the target during a checkpoint. Reconcile inherited failed/unrun tests and identify which affect the selected work. A historical test report is not a clean baseline.

Expand the existing interface ledger into the current consumed operation list with Legacy groups L01-L15. Inspect current mode settings, persisted data and OC1/OC2 contracts before designing conversion. Map existing SDK/HTTP/SSE leaks to their owner and an explicit migrate-or-retain decision under SPEC 3.1.

Exit: every original 3.X requirement and new Legacy group maps to an owner, current evidence, milestone and acceptance check. Current-runtime validation gaps affecting the chosen work are resolved or explicitly block that work. Exact Legacy evidence is not an exit requirement for this checkpoint.

### CA-00: CAgent inventory and boundary freeze

After INT-00, inventory every consumed operation, including browser-closed callers, and classify each current feature as OpenChamber-owned, backend-dependent or mixed. Freeze the concrete module map, protocol leaks to move, shared UI/runtime/host ownership and protected file boundaries for the CAgent work. Record unresolved CAgent facts as unknown; no endpoint, schema, feature or support claim is assumed.

Exit: every consumed operation and caller maps to a contract owner, current evidence, migration decision and later acceptance gate. The generated inventory covers direct and autonomous callers and names protected shared files. No implementation starts from a guessed CAgent API.

Accepted source classification: [consumer boundaries](CAGENT-BOUNDARIES.md) and [disposition registry](evidence/2026-10-09-cagent-boundaries.json). Coverage checks found exactly 118 UI methods, 23 host operations and all 496 recorded references assigned, with no missing, extra or duplicate methods. This is migration scope acceptance; executable guards and real backend support remain later gates.

### CA-01: typed host contracts and guards

Implementation starts with the [minimum conversation path](CAGENT-INTEGRATION-SPEC.md#minimum-path-before-breadth) through an actual application consumer and a sparse sample backend. Complete its failure and unavailable-feature checks before expanding optional operation coverage. This internal pilot adds no release label and does not relax the full exit contract below.

Define domain contracts from actual consumers and migrate only the protocol assumptions required by them. Keep one runtime-neutral CAgent adapter in the trusted web backend or VS Code extension host; Electron reuses its in-process backend. Add authoritative backend identity, capability checks at dispatch, and explicit refusal of unsupported operations before side effects. Preserve OpenCode behavior and run OC1/OC2 regressions.

Exit: typed host operation contracts cover the CA-00 inventory; guards apply to UI and direct/autonomous callers; identity changes retire stale work without cross-backend replay. Focused OC1/OC2 regressions pass. No CAgent support is claimed without local runtime evidence.

The [consumer contract migration](CAGENT-CONSUMER-CONTRACT.md) is part of this exit gate. A synthetic backend without timestamps, provider/model facts or a local-directory mapping must exercise actual chat/sync consumers without fabricated fields. Optional bootstrap failures cannot erase successful conversation data. Every enabled feature names its migrated callers; unmigrated callers keep that feature unavailable.

### CA-02: executable offline adaptation kit

Deliver the complete runnable packet toolchain, not planning documents alone. Include protected reference tests and fixtures, generated operation stubs/constants, a deterministic generator, schemas, offline dependencies and commands, changed-file allowlist validation, feature-coverage checks, and task/report generation. Prove it with a deliberately sparse sample backend and a separate synthetic extension-feature sample; neither represents real CAgent behavior.

Exit: a clean offline checkout runs the documented commands successfully. The sparse adapter correctly rejects unsupported operations and fails validation when their dependent features are incorrectly enabled, and the synthetic extension passes only through registered typed handlers. Attempts to edit protected tests/contracts or enable a feature without linked evidence fail validation. Failed required checks return nonzero and concise machine-readable results.

Documentation intake also passes the [workbook decision cases](CAGENT-ADAPTER-WORKBOOK.md#documentation-to-adapter-decisions). Protected expectations cover structural mapping, semantic differences, absence, conflicting evidence and additional capabilities. An endpoint inventory alone cannot satisfy feature coverage. The [feature disposition report](CAGENT-ADAPTER-WORKBOOK.md#feature-disposition-and-extensions) validates every required column and rejects missing rows; sample evidence cannot activate real CAgent features.

The [weak-agent packet workflow](CAGENT-ADAPTER-WORKBOOK.md#weak-agent-packet-execution) also passes its fresh-context completion, conflict-stop and interrupted-resume rehearsals. Record scripted checks separately from any model trial; no model self-report advances acceptance.

CA-02 freezes the [local model workload budget](CAGENT-ADAPTER-WORKBOOK.md#local-model-workload-budget), demonstrates packet splitting when required input exceeds it, and records execution effort for its rehearsals. Production operation dispatch uses accepted code without model-dependent routing or conversion.

CA-02 also validates the [feature decision examples](CAGENT-ADAPTER-WORKBOOK.md#feature-decision-examples) and [documentation-change procedure](CAGENT-ADAPTER-WORKBOOK.md#documentation-changes-and-reacceptance). CA-03 records the real contract revision and maintenance handoff. A changed contract cannot retain affected capabilities solely because an earlier revision passed.

CA-02 additionally delivers the [model calibration samples](CAGENT-ADAPTER-WORKBOOK.md#local-model-calibration-and-task-assignment) and demonstrates all task-assignment outcomes, including a usable maintainer-only path. CA-03 runs those samples with the actual local model before implementing real API mappings and records its selected workload. Calibration never substitutes for operation or feature acceptance.

### CA-03: local CAgent adaptation and live acceptance

CA-01 through CA-03 also satisfy the [workflow acceptance contract](CAGENT-WORKFLOW-ACCEPTANCE.md#milestone-evidence). Record runtime model-quality dispositions independently of authoring-model calibration and API support. Unattended workflows may remain disabled after minimum interactive acceptance; they cannot bypass their own admission checks.

First prove the same minimum path against documented real CAgent operations. If it cannot preserve required chat semantics, record the gap and keep chat disabled. Accepting read-only operations alone does not complete this checkpoint. After the path works, account for the full feature inventory and extensions before acceptance.

Run the kit inside the target environment against its actual API documentation and isolated CAgent server. Implement the minimum usable chat path and produce a disposition for every existing consumed feature and every additional feature discovered in the API documentation. Keep unverified or unsupported features disabled with reasons; record `requires-host-development` where the fixed extension model cannot preserve semantics. The maintainer explicitly activates only the accepted adapter revision.

Exit: a real local server completes minimum chat with observable outcome and history/reopen where supported; live host journeys cover each host claimed available. The evidence report accounts for all existing and discovered features, including unsupported and unverified rows, and includes direct-call refusal for a disabled feature. The local maintainer reviews evidence and explicitly activates the revision. If environment access or documentation is unavailable, real CA-03 acceptance stays unverified; the maintainer-authorized toolchain Release still precedes other INT work. Simulation alone never passes this gate.

Record an adaptation trial with the environment's actual local agent using the workbook packets. Keep failed packets disabled, report their evidence gaps, and preserve the same acceptance checks when a maintainer completes them.

The local-model trial records workload size, protected check results, correction attempts, maintainer interventions and elapsed time under the workbook budget. Failed or unexamined operations remain disabled regardless of the overall trial success rate.

### INT-00L: exact Legacy evidence

Acquire exact 1.2.27 source/schema and an isolated executable/endpoint; record provenance and sanitized samples. Settle the identity probe, consumed wire contracts and dispose scope. Investigate idempotency-key support, retention and request-ID outcome lookup without assuming any exists. Separate missing evidence from confirmed unsupported behavior.

Exit: evidence is sufficient to implement the first Legacy conversation and identifies the remaining operation-specific gates. Any unresolved contract remains disabled until its evidence exists. If exact 1.2.27 execution is unavailable, Legacy live gates remain blocked. After the CA-02 temporary Release, INT-01/INT-02 current-runtime work, INT-06 and independent UI work need not wait for Legacy live evidence.

### INT-01: identity and adapter boundary

Own the shared descriptor/profile/constants, server/extension composition, UI dispatch and direct-call inventory. Add Auto and manual selection without changing the current OC1/OC2 meanings. Bind profile and capabilities before bootstrap or writes. Legacy operations without accepted implementations fail explicitly.

Exit: selection policy, user-declared unknown-version handling, contradictory version rejection, unsupported/auth/unreachable distinctions and same-URL profile switching pass contract tests. Real identity probes verify current OC1/OC2; exact Legacy Auto/manual live acceptance belongs to INT-03 after INT-00L. Web/VS Code descriptors and server jobs agree; old-profile late results cannot mutate new state. Existing OC1/OC2 core behavior remains usable. Review the SPEC 3.1 consumer contract and changed-module inventory to prove a new adapter does not require protocol-neutral chat/queue business changes.

### INT-02: modes and migration

Own the settings record, configuration UI, server lifecycle and VS Code manager. Implement all five modes according to the SPEC, with explicit unsupported modes per host, visible settings provenance and no implicit binary/endpoint fallback. Imported settings only prefill a candidate for confirmation; a missing choice recommends the bundle without launching it. A CLI write uses the same authenticated settings contract, with no hidden override or UI lock. Preserve one owned server and expose busy-work switching consequences.

Exit: valid and invalid cases for each available mode, PATH miss, invalid shim/command, occupied port, missing bundle, external auth failure, startup timeout, cancellation, repeated switch, restart persistence and old-setting migration are tested. A real Windows run proves hidden children, owned-tree shutdown and no external-process termination. The configuration UI remains reachable after kernel failure. Failed save/migration preserves the previous record.

### INT-03: first usable Legacy conversation

Own Legacy request/response/error codecs and UI/server session operations. Cover L01-L03 plus the minimum L06/L09/L10 event, permission/question and terminal-state path needed for a complete conversation. Include required catalog reads and preconfigured credential use from L07/L13. Use an explicitly configured existing managed/external path; new five-mode UI delivery is not a prerequisite. Keep other capabilities disabled until accepted.

Exit: real exact 1.2.27 Auto/manual selection, session creation, text/attachment submission, streamed tool output, permission/question reply, stop, completion and reopened history work end to end and agree with sanitized fixtures. The server backend and UI use the same profile. A newer OC1 and supported OC2 pass focused core regressions. Legacy remains experimental until advanced operation, config and host gates are complete.

### INT-04: advanced Legacy operations and recovery

Own L04/L05 command/shell, fork/compact/diff/revert and supported file/todo operations, plus remaining L06/L09/L10 recovery. Extend the working INT-03 stream and decisions path with scoped recovery when replay is unavailable. Preserve missing-versus-empty distinctions and message identity across history/stream updates.

Exit: real 1.2.27 command/shell, fork/compact/diff/revert and supported file/todo journeys match their operation ledger. Tool/permission/question flows, interruption, reconnect, server restart and pending-decision restoration complete without duplicate messages or lost approvals. Late/out-of-order/partial events and failed recovery have contract coverage. Two directories remain independent on partial failure.

### INT-05: Legacy settings and autonomous work

Own L07, L08, L11, L13 and the capability audit in L15. Route config/providers/auth/MCP/skills/generated plugins and every unattended caller through the profile. Verify old-version metadata persistence instead of assuming modern SDK fields are stored. Native-only newer features have explicit service-level capability outcomes.

Exit: exact-version supported settings read/write, credential handling, plugin loading and MCP lifecycle pass; reload-dependent application is accepted at INT-06L. With UI closed, queue, scheduled tasks, assist and goals perform intended dispatch/state changes. Cover normal single dispatch, lost acknowledgement, crash/restart and duplicate triggers under the Legacy dispatch outcome contract. Unknown outcomes preserve intent and do not automatically resubmit without verified deduplication or reliable outcome lookup. No OC2 migration, credential schema or modern-only plugin runs against Legacy storage. Every advanced consumed operation has an evidence-backed disposition; missing core behavior prevents acceptance.

### INT-06: current OC1/OC2 reload contract

Own original 3.3 for current OC1/OC2 and the shared scope contract needed by L12. Implement directory/global dispose only with verified wire and scope behavior. A directory reload advances only that directory's lifecycle, preserving unrelated requests, approvals and subscriptions; broader connection changes use the connection epoch. Preserve OC2 live apply and native managed restart where appropriate; expose separate process restart for launch/binary changes.

Exit: real reload on current OC1 and supported OC2 proves the requested configuration took effect, affected streams rebound and pending state cleared only on success. Reload directory A while B has active work and approvals: B remains usable without dropped state. External PID survives. Busy work, unsupported directory scope, lost response, timeout and failed readiness have explicit tested outcomes. No global promotion or process restart happens as an undisclosed fallback. Exact Legacy evidence/configuration work does not block this checkpoint.

### INT-06L: Legacy reload and configuration apply

Complete L12 on exact 1.2.27 using the accepted shared scope contract and Legacy configuration adapter. Do not infer directory semantics from a modern endpoint name.

Exit: real exact-version reload applies the requested settings, rebinds affected streams and clears pending changes only after verification. Repeat INT-06 isolation, external-PID and failure cases against Legacy. A global-only capability is exposed as an explicit global operation; directory reload is unsupported in that case, with no hidden promotion.

### INT-07: native localization

Own Electron native application/tray/context menu resources and locale propagation. Keep menu actions and accelerators with their current owners.

Exit: captured Windows Chinese/English menus follow language changes and execute the same actions; macOS role menus and Linux tray behavior have host-specific acceptance or remain explicitly open. Shared UI localization does not substitute for native verification.

### INT-08: branch context and refresh

Own title branch presentation, the draft refresh action and scoped Git-store refresh semantics. Both requirements use the current session/draft directory and remain independent of the selected OpenCode protocol.

Exit: desktop/mobile show the branch with the work panel open; Git/non-Git/empty-repo/detached/error cases are correct. Switching branches outside the app followed by explicit refresh updates the current checkout immediately, preserves valid user target selection and draft contents, and rejects stale target results. A failed refresh marks stale data but allows sending to a still-valid target without extra confirmation; only invalid/unresolved targets block sending, with temporary suspension during target change. Capture actual screenshots and exercise target-sensitive send after refresh.

### INT-09: shortcut hints

Own the common hint helper/component and the finite registered-action coverage list. Integrate branch refresh only if it has an actual binding.

Exit: each listed button shows its effective customized binding on hover/focus, follows platform formatting, updates after rebinding and omits nonexistent bindings. The hint matches the action actually dispatched. Touch labels and keyboard accessibility remain usable.

### INT-10: integration and release candidate

Own the final integrated review and L14 host matrix. Freeze the final SHA; run required root checks and affected builds/tests, then real user journeys across the promised hosts. Reconcile every unsupported/unverified operation and historical validation gap affecting this milestone. Test CAgent contract regressions and backend switching, plus Legacy/current OC1/OC2 switching, settings persistence and previous-record recovery.

Exit: all applicable SPEC and Legacy acceptance rows have final-SHA evidence. Exact stable 1.2.27 is exercised; a newer OC1 run does not replace it. Windows portable launch/conversation/reload/quit succeeds, with native host limitations named. Settings update history and release identity accurately describe the accepted scope when release preparation is requested. Publishing, tags and installation remain separate from this planning task.

## Evidence and handoff format

For each INT task record status, owner, base/final SHA, requirement IDs, changed modules, exact kernel versions, fixtures/tests, real runtime checks, unresolved host rows and the restore procedure. `done` requires the completion contract, not only a passing type-check. Keep source review, fixture tests and live results distinct.

Use short implementation sessions with non-overlapping file ownership. The lead owns descriptor and operation contracts, shared settings schema, integration decisions and final review. A later session starts from the prior accepted handoff; newly discovered scope is queued rather than folded into a moving checkpoint.

## Requirement traceability

| Requirement | Delivery |
| --- | --- |
| 3.1 Adapter completion | INT-00, INT-01, INT-03 through INT-05, INT-10 |
| 3.2 Explicit modes | INT-01, INT-02, INT-10 |
| 3.3 Dispose reload | INT-06, INT-06L, INT-10 |
| 3.4 Native Chinese menus | INT-07, INT-10 |
| 3.5 Persistent branch | INT-08, INT-10 |
| 3.6 Draft refresh | INT-08, INT-10 |
| 3.7 Shortcut hints | INT-09, INT-10 |
| New Legacy 1.2.27 profile, all consumed operations | INT-00L, INT-01 through INT-05, INT-06L, INT-10 |
| CAgent independent-server architecture and accepted adapter | CA-00 through CA-03, INT-10 |

### INT-01 implementation checkpoint

In progress at base `9e4b76b83`. First extend the existing descriptor/binding identity with an optional resolved profile, preserving descriptors from existing hosts. Web kernel refresh increments epoch for a profile change; Electron reuses that backend. VS Code consumes the same descriptor contract. Shared UI on web, desktop, VS Code, hosted mobile and Capacitor rejects old results when the profile changes even at the same URL/epoch. No selection control or Legacy operation is enabled by this first step. Remaining work is authoritative Auto/manual resolution, requested-selection persistence, read-only Legacy declaration checks, capability dispatch and host adoption/validation.


Verified on 2026-10-09: 7 shared UI binding tests and 39 server compatibility/runtime tests pass. Workspace type-check and lint pass, with five existing lint warnings. Authored runtime files pass oxlint. UI package build passes its configured TypeScript check. Dead-code reports the existing 2 unused files and 319 unused exports, with no profile finding. These checks cover profile identity only; selection, capability dispatch and real-host Legacy acceptance remain pending.

The shared compatibility owner now provides Auto/OC1/OC2/Legacy admission, separate requested selection and resolved profile, mismatch/auth/conflict/unreachable outcomes, and explicit version-absent Legacy declaration. The Legacy read-only set is health, session list/status, pending permissions/questions and command catalog. All five post-identity contracts must parse before admission. No session creation, dispose or config write occurs in this set. The admission helper does not activate production hosts or accept Legacy operations. Final validation passes 63 compatibility/runtime tests, workspace type-check/lint, authored oxlint and script syntax. Lint retains five existing warnings; dead-code retains 2 unused files and 319 unused exports, without new profile findings. See [real 1.2.27 admission evidence](evidence/2026-10-09-profile-admission.json). All three Legacy selections passed against the verified official executable, followed by the controlled conversation checks with nonempty diff. Production selection persistence, host adoption, capability dispatch and current OC1/OC2 live probes remain pending.
