# R1 browser recovery

Observed production Web root blank with no admitted OpenCode source. SyncProvider returns null. Recovery was gated only by exhausted initialization retries, so readiness and source admission could disagree. Reuse the existing recovery outside SyncProvider whenever no source exists.

Surfaces before editing:
- Web: show existing connection recovery before source admission.
- Electron: preserve native boot routing; after main boot routing, use the same source admission recovery.
- VS Code: existing recovery already outside SyncProvider; unchanged.
- Hosted mobile: after OpenChamber host connection succeeds, show existing OpenCode recovery when source absent.
- Capacitor: preserve native host connect/login screens; after host connection, same OpenCode recovery.

Unexpected command failure: attempted packages/ui/README.md read after discovery did not list it. File does not exist. Use discovered docs; no package README to read. Browser tab from prior turn was automatically closed; recreated a tab against the verified-live same host, without restarting host.

Required verification: real browser cold confirmation, successful admitted shell, failed replacement/previous recovery, hosted-mobile recovery; UI types/lint and rebuilt web assets. This checkpoint does not prove native Capacitor or Electron runtime behavior.

Additional command lessons from this checkpoint:
- Windows rg does not expand literal directory globs such as `.oxlintrc*` or `server/lib/ui*`. Discover names with `rg --files` first; use the actual `oxlint.config.ts`.
- A log for a later sequential check may not exist while the prior type check is running. Test existence before reading it.
- Baseline copies under ignored `artifacts` produced `No files found to lint`, including with `--no-ignore`. Created two unique copies beside the original source, ran baseline lint, and removed the exact two files in finally. HEAD/current each report 37 diagnostics with identical rule counts. No authored diagnostic locations.
- The first previous-connection review after failure was rejected as changed; a fresh review succeeded. Preserve this as observed stale-review refusal, not an unqualified first-click recovery pass.
- The first mobile patch placed recovery after the disconnected branch. Real hosted-mobile cold launch still showed host-unreachable copy. Moved recovery after host family admission and before OpenCode connection checks. Native with no host endpoint retains the existing connection screen.
2026-10-10 continuation: cleanup SPEC lookup from helper worktree cdee failed because maintenance docs belong to authoritative dijiang-next worktree. Use explicit authoritative workdir and discover paths before reads.
