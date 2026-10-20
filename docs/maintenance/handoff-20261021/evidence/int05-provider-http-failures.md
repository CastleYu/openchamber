# Int05 provider HTTP work failure notes

- Discovery command `rg --files | rg '(^|/)opencode/DOCUMENTATION\.md$|packages/web/README\.md$|runtime-parity|implementation-map'` exited 1 because the regex did not match the Windows path output. Follow-up used repository-relative paths and confirmed the web README; no business failure.
- Initial CodeGraph query found no `.codegraph/` index in the assigned target checkout. Per repository guidance, continued with direct file search; no indexing was run.
- First focused Vitest run failed only the premature disconnect case because the test destroyed its socket before the handler reached `beginOAuth` (observed signal was unset). Changed the test to wait until the controlled API receives the signal before disconnecting; rerun required.
- Automated review rejected the first lint command because `bunx oxlint` may download a package, contrary to the offline constraint. Retry with `bun x --no-install oxlint`; no rejected command ran.
- The next focused test run found its save-response assertion expected an API return field that the requested fixed success contract intentionally omits. Updated the assertion to the exact `{ persisted: true, requiresRestart: true }` response. Oxlint also flagged runtime `typeof` narrowing in the adapter; replaced those boundary checks with Zod parsing or direct trusted dependency use.
- Primary review corrected three contracts from the owning modules: auth contexts contain extra trusted fields and must be parsed with stripping; disconnect outcomes include `partial` and credential values `retained|removed|unknown|absent`; error messages must be fixed generic text. Applied those changes; validation rerun required.

- Primary review: auth test fixture opened a new ephemeral port per request, changing the port-scoped session cookie. Fixed by retaining one loopback server per fixture. A read of the helper-only edit script from the target checkout also failed; use the helper absolute path.

- Primary concurrency test initially held a source read of a writable definition while deleting its file. The existing byte preflight correctly rejected that stale read. Corrected the fixture to hold an authoritative already-applied empty read before a new independent commit, exercising stale evidence cleanup directly.

- Reading the dead-code log before its sequential check had started returned file-not-found. Wait for the retained command handle to finish before reading final artifacts. Oversized combined reads were truncated; use bounded ranges and compact summaries. Windows rg wildcard paths are invalid; pass the directory and -g pattern separately.
- Restricted Get-CimInstance Win32_Process returned access denied during a type-check observation. No escalation or retry was needed: the retained validation handle finished normally and provided all exit codes.
