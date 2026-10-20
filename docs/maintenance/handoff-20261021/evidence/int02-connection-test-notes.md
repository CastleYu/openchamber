# R1 read-only connection testing

Scope: SPEC 3.2 independent test and cancellation. No persistence format change, dependency or process launch.

- Web: authenticated host route owns validation and finite endpoint probes.
- Electron: reuses its in-process Web host.
- VS Code: extension manager composes the same test owner; webview abort cancels that request on its original bridge.
- Hosted mobile: tests the chosen host's inputs and endpoint, never the phone filesystem.
- Capacitor mobile: same host contract through runtimeFetch.

The draft owns UI input. A test result belongs to one request, runtime identity and draft. Cancellation/unmount/runtime retirement discards it. Active settings, lifecycle, queues and SDK binding remain unchanged. Managed success means input validation only. External test reuses credentials only for exactly the active endpoint, follows no redirect, and reports profile admission rather than feature acceptance.

Unexpected command failures: Windows rg literal wildcard paths returned OS123; use a directory and -g instead. Guessed bridge-types/webviewPanel/webviewRuntime/connection-runtime.test/managed-connection.test paths did not exist; discover paths with rg --files before reading. No command execution was retried for these missing files.

Cleanup: this edit driver is temporary; remove after its changes are validated. Retain focused evidence outside disposable test homes.

Additional command failure: another literal en*.ts rg argument produced OS123. All subsequent locale searches must use the messages directory and -g.

Additional missing path: packages/ui/src/lib/opencode/connection.test.ts does not exist. Tests are co-owned with the connection Settings HTTP/DOM fixture.
UI first run: 4 pass/1 fail due to checking a busy button by its idle label. Assert locked input and enabled Cancel instead. Fixture also loads a configured draft through discovery for launch-mode verification. Additional missing search target main.test.tsx was resolved by listing webview test files.

Cleanup-spec verification: the first lookup used the helper worktree cdee and rg reported missing specification paths (OS error 3). The documents belong to dijiang-next; subsequent reads explicitly used that workdir. Both English and Chinese cleanup requirements are present and aligned. Use the authoritative worktree for further document lookups.

Follow-up: subagent delegation returned agent thread limit reached; main agent continued directly. Added actual in-flight HTTP cancellation/socket-close, 15-second stalled probe deadline and post-probe retired-owner tests.

Production smoke caught missing forwarding through feature-routes-runtime: authenticated test returned 501. Added connectionTest to both composition destructuring and route dependency forwarding. Stalled HTTP test initially expected 408, but existing 5-second probe deadlines complete unreachable before the 15-second host cap; assert actual unreachable and elapsed bound instead of replacing existing timeouts.

Unexpected failures: automatic review rejected anchor-to-end documentation replacement because it could remove unrelated later content. The executed replacement instead uniquely matched the full newly appended paragraph. A later guessed instance-utils.js lookup failed; no such path is used. Discover CLI owner metadata through test-home run files instead.

Final evidence: 129 Web and 26 UI/VSCode tests; actual Windows OC2 10 checks; root types/lint and affected builds passed. Oxlint 234 baseline diagnostics, zero authored; dead-code unchanged 2/319/231. Cleanup removed 10 obsolete items, 14610065 bytes. See int02-connection-test-evidence.json for fingerprints, process checks, retained reasons and remaining gates.
Committed checkpoint: 805881f73. The integration worktree is clean. The final one-off cleanup driver was also removed after its successful run.
Next R1 batch: reconcile INT-01/INT-02 exit requirements against current evidence rather than historical acceptance. Relevant baseline files: artifacts/int02-migration-final-evidence.json; docs/maintenance/CAGENT-BOUNDARIES.md is deliberately frozen at a62bbe and is not a current-source inventory. Exact Legacy live acceptance belongs to INT-03/R2; full neutral CAgent consumer migration remains R6. Start with a bounded current mode/migration evidence comparison and SPEC 3.1 escape dispositions. Do not repeat accepted unrelated flows without source drift or a coverage gap. New-control real IDE and packaged/mobile acceptance remain explicit gaps. The initial broader lookup used rg patterns that returned no matching inventory extractor; no extractor was run or invented.
