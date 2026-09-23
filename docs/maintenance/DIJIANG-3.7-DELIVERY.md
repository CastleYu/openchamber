# DIJIANG 3.7 delivery

## Scope and recovery

The maintainer requested repaired existing tests, a documented DIJIANG regression
suite and coverage review, completion of worthwhile uncommitted changes, and a
Windows portable release containing current community main plus DIJIANG 3.7.
Implementation, commits, push and release publication are authorized.

- Invoking and release branch: `codex/personal`.
- Personal base: `a81e9c6658f41962298644d07fa40f33566a674a`.
- Community main fetched on 2026-09-22: `83ec4fbde25a9d141785716bebe0371925f895b5`.
- Fork `origin/codex/personal` matched the personal base at fetch.
- Backup: `codex/backup-dijiang-3.7-20260922`.
- Original five tracked edits and four untracked maintenance documents are saved
  in stash `84e0c878f9532ccc829f27c671e65c64caf50634`. The initial index was empty.
- `.codex-temp/`, `.playwright-mcp/` and `Temp/` remain local and untouched.
  They contain generated evidence, profiles and caches, not release source.
- Publish only to `CastleYu/openchamber`, through `origin/codex/personal`.

## Execution plan

1. Merge the pinned upstream into the invoking branch and account for every
   conflicting personal contract. Restore the exact saved edits and documents.
2. Run the repository test entrypoints, classify failures by behavior and runner,
   and repair them without weakening assertions or skipping supported behavior.
3. Map personal feature contracts to executable tests. Add missing success,
   failure, cleanup and cross-runtime cases at their owning modules. Record
   automated coverage separately from native and external-service acceptance.
4. Complete the pending update-history grouping and bilingual history. Review
   the maintenance plans as plans, without treating future proposals as features.
5. Run workspace checks, required dead-code/anti-slop checks, the full test
   suite, portable packaging and isolated runtime acceptance. Resolve in-scope
   failures before publication.
6. Commit explicit reviewed paths using Chinese descriptions. Verify ancestry,
   push the personal branch, inspect build/publication and verify release assets.

## Acceptance status

In progress. No test pass, runtime acceptance or release is claimed yet.

## Runtime preservation decisions

- Web, desktop, hosted mobile and Capacitor share authenticated file reads.
  Accept upstream's explicit `allowOutsideWorkspace` policy and OS permission
  checks. Native file copies retain cancellation, length checks and window-owned
  cleanup. Legacy token renewal is replaced by the new server read contract.
- VS Code retains extension-host file access and its native bridge.
- Desktop registers the personal file protocol in the new early entrypoint;
  the main handler retains packaged recovery while the upstream splash owns
  protocol installation.
- Web and desktop managed OpenCode retain the DIJIANG MCP plugin. External
  OpenCode and the VS Code lifecycle do not receive it. Registry ownership starts
  at spawn, including startup failure, and keeps injectable teardown operations.

## Command environment notes

- The guessed `packages/web/vitest.config.js` did not exist. Discover the
  package's actual configuration before invoking Vitest.
- The upstream manifest now pins Bun 1.4.2; the installed default is 1.3.14.
  Resolve a task-local pinned runtime before regenerating dependencies.
- A combined patch failed on a missing documentation anchor and made no changes.
  Reapply the source changes separately and append command notes at an existing
  section. Optional `small-model/auth.js` and guessed CLI helper paths did not
  exist; locate auth through imports and use `rg --files` before reading.

## Verified fixes so far

- The Windows registry query missed a PowerShell statement separator. Real
  lifecycle tests caught retained records that mocked queries had not detected.
  Registration cleanup is awaited by both child exit and explicit close.
- CLI PID-file recovery can now verify a Windows process command line through
  a bounded hidden query, while unavailable identity still remains unknown.
- Four native Node test files were incorrectly collected by Vitest. The web
  test script now runs them with Node before Vitest. Vitest workers are bounded
  to four to avoid overwhelming real-process fixtures.
- Tests isolate Windows home directories, use platform-correct path fixtures,
  and exercise personal install denial separately from community installer
  behavior. Production defaults remain notification-only.
