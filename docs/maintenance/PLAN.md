# Personal maintenance plan

Last updated: 2026-09-08. Task statuses below are the source of truth for execution. Design choices can change through the decision log. This document describes future work unless a task has accepted evidence.

## Read first

1. Read root `AGENTS.md`, matching project skills, and the owning module documentation before changing code.
2. Choose one `ready` task whose dependencies are `done`. Claim it in the table with the agent/task identity, start time, and current commit. Work in an isolated checkout when another agent is active.
3. Read its scope and acceptance criteria below. Split work expected to exceed one execution session before starting. Preserve task IDs when reprioritizing.
4. Record changed files, commands, exit results, runtime evidence, and unresolved issues in `docs/maintenance/evidence/<ID>.md`. Redact credentials and user content.
5. Change the status to `review`, never directly to `done`. A separate high-capability reviewer checks the actual diff and evidence, then marks `done` or `changes_requested` with concrete findings.
6. Stop at `blocked` with the failed prerequisite and the smallest next action. Timers and empty polling results are not permission to broaden scope, install dependencies, publish, or change unrelated files.

Scheduled agents should run this procedure only when the user schedules them. No recurring automation is created by this plan. A stale claim requires checking the owning task/process before reassignment. Parallel agents must not edit the same task table or files concurrently; use one coordinator for claims and merges.

Statuses: `backlog` → `ready` → `running` → `review` → `done`. Alternatives: `blocked`, `changes_requested`, `cancelled`. Reopened work keeps its ID and previous evidence. Dependencies are task IDs, not row positions. Only `ready` is runnable without further design decisions.

## Queue

| ID | Priority | Task | Status | Depends on | Executor | Reviewer / evidence |
| --- | --- | --- | --- | --- | --- | --- |
| BR-01 | P0 | Preserve personal history and merge community main | review | none | current task | [Branch record](BRANCHES.md) |
| REL-01 | P0 | Independent personal version and notification-only updates | review | BR-01 | current task | [Validation](VALIDATION.md) |
| REL-02 | P0 | Local portable pipeline and Actions artifacts | review | REL-01 | current task | [Validation](VALIDATION.md) |
| PERF-01 | P1 | Reproducible peak/idle baseline and budget proposal | ready | none | unclaimed | High-capability review of workload and budget |
| PERF-02 | P1 | Bound the dominant peak workload | backlog | PERF-01 | unclaimed | Independent correctness and measurement review |
| PERF-03 | P1 | Idle activity state machine and wake-up contract | backlog | PERF-01 | unclaimed | Architecture review before code |
| PERF-04 | P1 | Implement one measured sleep/wake transition | backlog | PERF-03 | unclaimed | Performance and recovery review |
| HOST-01 | P1 | Inventory platform coupling and propose contracts | ready | none | unclaimed | [Adapter migration guide](ADAPTERS.md) |
| HOST-02 | P1 | Extract GitHub repository/PR read adapter | backlog | HOST-01 | unclaimed | Runtime parity and migration review |
| HOST-03 | P2 | Extract platform mutations and auth | backlog | HOST-02 | unclaimed | Privilege, identity and failure review |
| HOST-04 | P2 | Prove replacement using a second host adapter | backlog | HOST-03 | unclaimed | Requires chosen platform and test endpoint |
| RUN-01 | P1 | Design SERVER / managed command lifecycle | ready | none | unclaimed | High-capability design review |
| RUN-02 | P1 | Persist mode, enforce lifecycle, expose switch | backlog | RUN-01 | unclaimed | Native process and UX review |
| LOG-01 | P1 | Audit existing logs against bounded diagnostics needs | ready | none | unclaimed | Redaction and retention review |
| LOG-02 | P2 | Implement reviewed log gaps | backlog | LOG-01 | unclaimed | Fault and resource-budget review |
| VIEW-01 | P2 | Define dual-screen and workspace-tab behavior | ready | none | unclaimed | User interaction design review |
| VIEW-02 | P2 | Implement persistent workspace tabs | backlog | VIEW-01, PERF-03 | unclaimed | UX and state ownership review |
| VIEW-03 | P2 | Implement second-screen handoff and restore | backlog | VIEW-02 | unclaimed | Two-monitor native acceptance |
| QA-01 | P1 | Consolidated release review | backlog | REL-01, REL-02 | unclaimed | Independent high-capability reviewer |
| QA-02 | P1 | Repair inherited validation blockers | ready | none | unclaimed | Prewarm test fixture and Logs page lint |

## Task contracts

### BR-01, personal feature preservation

Retain the local personal commit stack and three uncommitted edits plus `Temp/`. Track community main independently from the fork's old feature history. Record baseline SHAs, backup refs, divergence and merge results. A clean merge proves history integration only; personal behavior needs the regression checklist in [BRANCHES.md](BRANCHES.md).

### REL-01, independent version and updates

Community version remains in workspace manifests. `packages/web/personal-build.json` owns the single-integer DIJIANG revision and update policy. Desktop display/artifact version combines both, for example `1.22.2-DIJIANG.1`; CI records run and attempt numbers only in build metadata. Update availability compares the community version only. Checks remain available; download, install, auto-install-on-quit, direct HTTP installation and CLI replacement are blocked before side effects. An ordinary restart still works.

Acceptance: same/newer/invalid/failed release checks; no installer spawn through direct entrypoints; localized notification-only UI; current personal version visible; no community update manifest published from the fork. Actual packaged launch is required in addition to unit tests.

### REL-02, portable builds

Windows x64 is the first supported personal artifact. One root script runs existing staging, OpenCode verification, native rebuild and packaging with publishing disabled. Actions invokes that same script and uploads versioned artifacts plus build metadata. CI records its build identity without changing the app version. Personal releases increment the DIJIANG integer deliberately.

Acceptance: clean dependency install with the lockfile, local executable produced, packaged assets/native modules load, bundled OpenCode verified, version matches metadata, launch and close succeed, failed build emits no successful artifact. Actions execution requires pushing the reviewed branch; do not claim remote success from YAML inspection. Portable means no installer; existing AppData/config locations still apply.

### PERF-01, baseline and budgets

Read `scripts/perf/DOCUMENTATION.md`. Inventory current demand-scoped session loading, collapsed project rules, tray subscriptions and startup prewarm before measuring. Use production builds and the existing `profile:idle`, `profile:session`, `profile:switch` tools. Extend them only for a missing measured scenario.

Record hardware, OS, build SHA, project/session/message counts and payload size. Include cold start, warm switch, long streaming output, many projects, reconnect burst, idle foreground, minimized/background, and two windows. Record three comparable captures per scenario with median, p95 and maximum long-task duration, CPU busy time, heap/RSS high-water, network requests and timer wakeups. Attribute Electron, renderer, server and managed OpenCode separately.

Output is an evidence report and proposed budgets, not optimizations. Starting budget candidates, subject to review after baseline: bound simultaneous background requests and pending work explicitly, avoid tasks exceeding 200 ms during normal interaction, reduce attributable idle CPU/wakeups by at least 50% on the reported scenario, and prevent sustained memory growth after repeated activation cycles. These are targets, not achieved measurements or hard limits on an external server.

### PERF-02, peak control

Choose the measured dominant multiplier, such as global history loading, stream batching, concurrency, large output rendering or retained cache size. Define limits for in-flight work, queued items and retained data, including backpressure/cancellation behavior. Never drop final messages, permissions or authoritative state to meet a budget. One bounded implementation per child task.

Acceptance: representative peak falls within the reviewed budget; no overlapping duplicate pulls; unrelated entities remain correct on partial failure; cold and warm evidence; operation-count or burst regression tests. Reject a change with no measured benefit.

### PERF-03 and PERF-04, sleep and wake

Define `active`, `idle`, `background` and `suspended` separately. A hidden window does not mean its server or agent can stop. Keep task execution, approval delivery, essential heartbeats and authoritative live state available. Suspend nonessential discovery, animation and refresh work only when it has no active consumer. Specify which work is shared across windows.

Wake on user focus/input, relevant live events, explicit refresh and endpoint changes. Resume once, cancel stale requests, reconcile missed state, and prevent a full-refresh storm. Cover OS sleep/resume, network loss, server restart and multiple windows. Acceptance includes repeated sleep/wake cycles, no lost approvals or completion notifications, bounded memory and timers, and measured wake latency. Implement after the state-transition table is reviewed.

### HOST-01 through HOST-04, platform replacement

Follow [ADAPTERS.md](ADAPTERS.md). Inventory GitHub, local Git, Linear, release metadata, skills catalog downloads, credentials, relay/tunnels and model providers separately. Keep protocol transport, host integration and application operations distinct. The OpenCode SDK remains the official OpenCode boundary.

HOST-01 finishes with actual caller/file inventory and a capability table, including every runtime. HOST-02 migrates repository identity and PR/status reads end to end with the GitHub adapter. HOST-03 handles mutations and auth only after read-path parity. HOST-04 needs a selected internal host product, URL/auth requirements and accessible test environment; absent those, document the blocked prerequisite and use a deterministic contract fixture only as offline evidence.

### RUN-01 and RUN-02, controlled OpenCode startup

`SERVER` means connect to an explicitly configured existing OpenCode endpoint. Never spawn, upgrade, stop or reap the external process. Failure remains an external connection error. `managed command` means OpenChamber starts the selected executable, owns its PID/process tree and stops only what it owns. On Windows, resolve `.cmd` shims safely; keep background helpers hidden. Do not equate command mode with a visible console unless selected by the user.

Start from `OPENCODE_HOST`, `OPENCODE_PORT`, `OPENCODE_SKIP_START` and the existing lifecycle module. Define precedence among saved mode, environment and launch arguments, migration of existing installs, executable arguments/cwd, endpoint/auth validation and mode display. A failed SERVER connection must never fall back to command mode. Busy-session switching needs a deliberate transition policy and explicit user action. Acceptance includes both modes, invalid endpoint/binary, restart, stale PID, shutdown, and switching with active work. The in-process OpenChamber server stays in-process.

### LOG-01 and LOG-02, diagnostics

Inventory existing daily JSONL runtime logs, managed OpenCode events, stderr tails, MCP failure reporting and the Logs settings page. Identify gaps rather than replacing them. Propose one event schema with timestamp, severity, subsystem, operation/correlation ID and runtime identity; secrets and user prompts are excluded by default.

Define file size/count/age retention, maximum event size, queue length and write-failure behavior. Bound high-rate logs and expose dropped-event counters. Provide filters, safe export and an explicit diagnostic bundle preview. Acceptance covers rotation, full disk, unavailable directory, malformed records, concurrent sources and redaction. Logging must not become the dominant peak workload or keep an idle app busy.

### VIEW-01 through VIEW-03, dual screen and tabs

Initial proposal: workspace tabs select independent project/session contexts; a second native window can show another context on another monitor. Inspect existing native multi-window and Mini Chat support before building new shell concepts. Decide linked versus independent selection, keyboard navigation, tab close behavior, unsaved drafts, active task visibility and shared versus window-local settings.

Store durable tab identity separately from mounted contents. Inactive tabs obey reviewed sleep rules while server tasks continue. Two windows must not spawn duplicate managed servers, duplicate writes or multiply background polling. Acceptance: move between monitors with different scaling, unplug a monitor, restore off-screen windows, close/reopen tabs, keep draft/focus/scroll, receive approvals in the correct context, and capture actual UI screenshots. VIEW-01 ends with a reviewed interaction specification before source changes.

### QA-01, independent review

Review the integrated diff at a recorded commit, not only task summaries. Verify update enforcement, branch ancestry, personal feature regressions, packaged behavior, CI publishing boundaries and documented limits. Group findings by concrete risk with file/line and reproduction. Assign each fix a task ID and rerun affected checks. Only the reviewer may mark accepted tasks `done`.

## Decision log

QA-02 is limited to the incomplete storage fixture in `packages/ui/src/stores/useConfigStore.prewarm.test.ts` and the unused `currentFilePath` in `packages/ui/src/components/sections/logs/LogsPage.tsx`. Establish the real storage contract rather than adding another broad module mock. Acceptance is a passing prewarm test and UI lint with no behavior change or rule suppression. See [VALIDATION.md](VALIDATION.md) for the observed failures.

| Date | Decision | Reason / revisit trigger |
| --- | --- | --- |
| 2026-09-07 | Merge upstream into `codex/personal`, preserve old refs | Existing local/fork feature histories contain equivalent rewritten patches; avoid a duplicate merge or force push |
| 2026-09-07 | Implement packaging/version/update policy now; plan other features | User explicitly selected this scope |
| 2026-09-07 | Personal semantic version starts at 0.1.0 | Independent from upstream; revise deliberately for personal releases |
| 2026-09-07 | CI artifacts only, no app replacement | User wants notifications and source-controlled personal maintenance |
| 2026-09-07 | Windows x64 first; AppData remains in use | Current workstation and existing Electron runtime; full removable-drive data portability is a separate requirement |

## Evidence template

Each task evidence file records: task ID, base/final commit, owner, status, changed files, acceptance checklist, exact commands with outcomes, production/runtime artifacts, untested boundaries, rollback instructions, reviewer identity and findings. A code change that passes static checks remains `review` until its required runtime boundary is checked. Keep chronological attempts, including failed hypotheses, under the same ID.
