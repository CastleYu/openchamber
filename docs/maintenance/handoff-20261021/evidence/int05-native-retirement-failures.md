# Native retirement command failures

- 2026-10-12: `apply_patch` failed because its combined hunk used a stale context around `connections.replace`; no files were changed. Re-read exact local ranges before subsequent patches.
- 2026-10-12: `bun run --cwd packages/vscode type-check` failed with `Script not found "type-check"`; retrying `bun run type-check` from the package directory produced the same output even though `packages/vscode/package.json` declares that script. One attempt also used an incorrect relative failure-log path; the corrected path was denied by the sandbox, so this record is being written through the authorized worktree elevation.
- 2026-10-12: A non-elevated `bun run type-check` again returned `Script not found "type-check"` despite the package manifest declaring it. The elevated package command did launch TypeScript; after correcting the one typed manager fixture, retry via the approved worktree execution path.
- 2026-10-12: The focused `bun test src/sseProxy.test.ts` passed (2/2). The attempt to append the preceding package-wide test failure summary again used an artifacts path relative to `packages/vscode`, so that append failed; use `..\..\artifacts` when running from the package directory.

Root discovery notes: lifecycle.d.ts does not exist; do not assume a declaration companion. Windows rg literal wildcard path shutdown* caused OS error 123; search the directory using -g instead.
- 2026-10-12: Focused `managed-opencode-process.test.ts` initially failed only the new inherited-stdio descendant case: awaiting `whenExited` beat the fixture descendant's marker write. All 13 existing/new cases otherwise passed, including spawn-failure fallback. Adjust fixture readiness to await an explicit descendant output before terminating the parent.
- 2026-10-12: Package `bun run test` completed with 58/61 files passing. Failures were existing adjacent suites: Legacy advanced-route expectation, Git process test timeout while `taskkill` was terminated, and Legacy MCP response assertion. Focused `src/sseProxy.test.ts` passed (2/2); focused managed process lifecycle suite passes (14/14) after correcting its fixture race.

Root regression correction: initial test exposed synchronous exit during registration before serverProcess initialization; declare its handle before registering callbacks. Test error contract uses statusCode rather than status. Corrected suite passed 109/109. Web anti-slop reports eight pre-existing typeof findings outside authored changes; ESLint and Web types pass.

Root check: build log was read before its asynchronous type/build command reached build stage; wait for completion before reading dependent logs. Failed-restart assertion uses the existing connection error status field; credential-operation failures separately use statusCode.

Root discovery correction: rg literal bridge* and config*routes*.js paths fail on Windows (OS 123); use directory searches with -g. bridge-context.ts does not exist; discover the imported type owner before reading. The isolated-test script takes directories, not concrete files; run concrete Bun suites directly.

Root process recheck: default Bun 5-second case deadline interrupted twelve simultaneous owned-child terminations, followed by EBUSY cleanup. Re-run with a 20-second test-runner budget to distinguish fixture deadline from runtime failure; do not widen production timeout.

Root/Astra discovery: owned-process.test.ts and node_modules/bun-types/test.d.ts guessed paths were absent. Astra also observed Windows wildcard path OS123 and missing retained server/routes/provider.ts; use confirmed directories with -g and retained SDK OpenAPI. Tests reconciled against existing INT04 fork acceptance and exact provider catalog schema; production gates unchanged.

Recheck refinement: default-budget diagnosis was incomplete. A subsequent explicit 20-second test still hit EBUSY during finally cleanup, masking any primary failure. Match existing managed-process test bounded fs.rm retries. Production taskkill timeout unchanged. Reading the final suite log before the preceding type check completed returned missing-path. A malformed helper apply_patch lacked Begin Patch and made no changes.

Astra confirmed early Promise.all rejection and unawaited fixture kills can mask taskkill failure with EBUSY. Test now awaits all twelve settlements, preserves termination errors, and waits for fixture PID exit before deletion. No production timeout changed. Additional discovery: guessed process-registry.js absent; actual re-export points to managed-process-registry.js.

Final diagnostic run exposes primary taskkill termination by its own timeout (killed=true, signal=SIGTERM) and EBUSY cleanup together. ESLint no-unsafe-finally caught the test's aggregated rethrow inside finally; move the aggregated throw after cleanup. No production owner changes in this round.

Host acceptance failure is recorded in helper checkout artifacts/int05-native-retirement-failures.md: runner timed out; test child PID 172948 termination denied. Actual integration host acceptance remains open. Last focused process suite passes; complete suite remains unaccepted. Corrected missing-path reads crossed helper versus actual checkout; always use explicit checkout paths.

Isolated managed-process test passed 14/14 with 20-second test budget. Complete suite first failed at the test-runner 5-second cutoff, leaving asynchronous fixture cleanup overlapping later tests. Give only the five descendant lifecycle cases their explicit 20-second budget; production spawn/termination timeouts remain unchanged.

## 2026-10-12 managed test-budget full regression
- Explicit 20-second budgets on the five descendant-cleanup tests removed their default 5-second cancellation; all five passed in the full run.
- Full VS Code isolated suite still failed 2/61 files. Git deadline termination hit taskkill timeout and EBUSY; later managed Windows cleanup reported Quota violation and Call cancelled.
- Evidence: artifacts/int05-managed-budget-full-suite.log. Focused managed run before this suite was 14/14.
- Production timeouts unchanged. Await Astra review before another verification or implementation change.


## 2026-10-12 serial verification control
- Independent Git 3 pass/1 skip and managed 14 pass; complete serial suite still 60/61. Twelve concurrent owned Git terminations hit taskkill deadlines and EBUSY. Do not rerun broad suites or change production deadlines without a new diagnosis.
- Temporary runner was removed. Real host runner still never entered in its one bounded attempt; see checkpoint for retained profiles and unresolved ownership.

## 2026-10-12 bounded WMI and host diagnosis
- Root initially searched retained host profile in the integration checkout; rg reported OS error 2. Authoritative checkpoint locates host profiles in helper checkout cdee. Use the checkpoint helper path.
- Default sandbox quota read returned CimException. Scoped elevated read succeeded; no WMI/service/system settings changed.
- WMI limits read: MemoryAllHosts 1GiB, MemoryPerHost 512MiB, HandlesPerHost 4096, ThreadsPerHost 256, ProcessLimitAllHosts 32. Current WmiPrvSE memory/handles below these limits do not establish past peak usage.
- Recent WMI 5858 events in the failure window show Win32_Process enumeration cancellation 0x80041032. These support termination-tool failure but do not identify the exhausted quota.
- Astra review command passed literal rg wildcards on Windows, causing OS123. Use rg directory -g patterns.
- Host logs show only normal main-process/storage initialization and JumpList warning, no extension-host logs or runner entry. No startup cause is proven. Do not call this a crash or manager behavior failure.
`n- Bun diagnostic probe in default sandbox could not read actual integration cwd/tsconfig (EPERM), despite exit0. Re-run same bounded probe with scoped escalation; do not treat exit0 alone as evidence.
`n- Same-turn setImmediate termination coalescing rejected after measured control: deadline pressure still issued 11 taskkill calls for 12 roots (plus one deactivation call). Passing once did not prove useful pressure reduction. Exact original owned-process.ts SHA256 restored. Evidence int05-taskkill-before.log and int05-taskkill-after.log.

- Diagnostic setup: root esbuild path was absent; use packages/vscode/node_modules/esbuild. Default sandbox Node subprocess spawn returned EPERM; actual process controls require scoped elevated execution.

- Bounded-batcher edit initially omitted a closing brace; esbuild rejected it before tests. Fixed the generated edit and reran the identical control.

- Review commands again used a literal Windows wildcard and read validation logs before creation. Use directory plus -g and wait for command completion. ESLint rejected a throw in finally in the new test; moved combined failure reporting after cleanup.

- Default sandbox Win32_Process inventory returned access denied. No process diagnosis required it for acceptance; no retry or system change made. Use scoped privileged read only if host diagnosis needs it.

- Host driver terminal-report race: an earlier behavior-running snapshot overwrote final status after Code exited. Final suite JSON proved all eight checks passed. Launcher now reloads status and uses terminal suite evidence; repeated warm control passed. Cold fixture startup caused upstream automatic default-plugin downloads, documented separately; no project dependency added.

### Refresh inspection command corrections
# Runtime refresh inspection

- A combined read named `packages/vscode/src/bridge-system-runtime.test.ts`, which does not exist. The source inspection otherwise succeeded; no source was changed.
- Correction: discover matching test paths with `rg --files packages/vscode/src -g '*bridge*test*'` before reading them. Do not infer test filenames from module names.
- A later combined read accidentally used the helper worktree for integration-only modules. Correction: keep integration source reads and helper-driver reads in separate commands with explicit respective working directories.
- A stale `generation.js` path from inspection was absent. Generation detection is owned by `compatibility.js`; use discovered files only.


### Plugin preparation validation corrections, 2026-10-12
- Vitest cannot execute plugin-routes.test.js because it imports bun:test. Read test imports before choosing a runner; rerun this file with Bun. Other two Vitest suites passed 57 tests.
- A read attempted the dead-code output before that sequential stage had started. Observe the live validation handle; inspect logs only after file creation or terminal completion.
- Oxlint reports seven existing lifecycle.test.js findings in untouched mocks/type guards; review by source range rather than suppressing or mass-fixing them.
- Astra readonly inspection encountered Windows rg path-glob error 123 and an absent guessed connection-resolver.js; use directory plus -g and discovered paths.

## Plugin preparation implementation corrections
- apply_patch: context mismatch while adjusting the scoped mutation script; no actual worktree files were changed.
- node --check: scoped .cjs mutation script used ESM imports; syntax check failed before any target edits. Switched the helper script to CommonJS.
- focused Vitest: Vite could not spawn the bundled esbuild service (EPERM) under the default sandbox; no test assertions ran. Retrying the same focused suite in the approved elevated execution context.
- focused Vitest: authored runtime tests referenced vi without importing it; 124 tests passed and 2 new parameter cases failed before assertions. Added vi to the test import before rerunning.

- Handoff inspection initially read the preparation log from the target before copying the helper-owned evidence; corrected by copying the verified log. Reading a not-yet-created checkpoint also failed harmlessly; create evidence before reading it.
- Final verification log redirection used one parent directory too many; test process did not launch. Retried with an absolute artifact path and checked the terminal test exit code.

## CLI endpoint binding inspection
- Windows rg received a path wildcard for connection-preparation and returned error 123. Corrected by discovering filenames with rg --files and using directory searches with -g. No source was changed by the failed search.
- Scoped edit stopped on an incorrect retry-guard anchor after three earlier replacements. Inspected the actual guard, corrected only that anchor and resumed idempotently.

Focused kernel-runtime Vitest runs for managed CLI binding

- Initial focused run before final cases: 40/40 passed.
- First run after final cases: 41/42 passed because the top-level remote-only test referenced endpoint/found scoped inside a describe block; corrected by using a local endpoint and inline descriptor.
- One combined fix-and-record shell invocation exited 1 without diagnostic output; the code fix succeeded in a separate scoped command.
- Final focused run result: 1 file and 42 tests passed.


- 2026-10-12 CLI binding: mixed-worktree log reads used the wrong cwd and returned missing-file errors. Validation logs belong to dijiang-next; native host driver/status/profile logs belong to cdee. Use explicit owning cwd. The first mismatch fixture omitted /api/info and did not establish rejection cause. The corrected IDE launch was blocked by vscode-updating after 31 seconds and produced no runner evidence; do not bypass the updater or count it as a pass.

- 2026-10-12 unattended review: default sandbox WMI process query was denied; the identical read-only query succeeded under scoped escalation. Helper worktree has no docs/maintenance; use integration cwd for repository docs. An initial ESM reproduction used a Windows drive path as an import URL and failed ERR_UNSUPPORTED_ESM_URL_SCHEME; file:/// import corrected it. A guessed config-routes.js did not exist; rg --files located config-entity-routes.js. Large recursive IDE log search was truncated; use specific logs and bounded line lengths.
