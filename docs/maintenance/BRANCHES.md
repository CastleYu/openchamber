# Branch maintenance

## Snapshot, 2026-09-07

- Original local `feature`: `3d03d486`. Retained as `feature` and `codex/backup-feature-20260907`.
- Fork: `origin`, `https://github.com/CastleYu/openchamber.git`.
- Community: `upstream`, `https://github.com/openchamber/openchamber.git`.
- Fetched community main: `cab07805456c97be462ce2289c2ba3a1c56d3eca`.
- Working maintenance branch: `codex/personal`, created from local feature and merged with community main without conflicts.
- Before merge: 59 personal-side commits and 5 community-side commits. Community changes include the in-repo libghostty terminal adapter and manual missing-worktree relocation.
- Local feature versus `origin/feature`: 166 ahead, 62 behind. Patch-aware inspection found matching subjects and equivalent rewritten commits. Keep the old fork branch intact; do not force-push local history over it.
- User changes in `OpenChamberVisualSettings.tsx`, `tr.settings.ts`, `tr.ts`, plus `Temp/`, were stashed before merge and reapplied successfully. The named stash remains as a recovery copy.

## Routine synchronization

Use `upstream/main` for community intake and `origin/codex/personal` for a future personal branch publication. Fetch before deciding whether a merge is needed. Do not push to community upstream. A fork's GitHub Sync fork operation belongs on its community mirror branch, never on the personal branch.

For upstream intake or its merge conflicts, use the project [personal-upstream-sync skill](../../.agents/skills/personal-upstream-sync/SKILL.md). It owns the fetch, isolated integration, conflict resolution, validation, restoration and authorized-push workflow. The checklist below owns this fork's personal behavior requirements.

Updating fork `main`, pushing `codex/personal`, or dispatching remote Actions is a separate publication step. Push only when requested. Maintenance changes are committed separately from the preserved user edits.

## Personal feature regression checklist

- Demand-scoped session loading; collapsed/inactive projects do not trigger broad discovery or prewarm.
- Background loading, worktree discovery and automatic Git checks preserve the current user choices.
- Tray activity uses live sync state and its bounded unmounted fallback.
- Logs page, daily JSONL, managed process diagnostics and MCP failures remain available.
- Windows managed process cleanup stays scoped to owned descendants.
- VS Code local-path opening continues through its privileged bridge.
- Locale key parity, including the preserved Turkish edits.
- Personal version, notification-only update guards and portable build pipeline.

History preservation is verified by ancestry. The checklist above requires runtime/test evidence and is not implied by a conflict-free merge.

## Recovery

For inspection, create a separate checkout at `codex/backup-feature-20260907`. Keep the current worktree and stash until the new build is accepted. To undo the integration on a published branch, review a merge revert with parent 1 rather than rewriting history. Restoring the old worktree state requires selecting the named pre-sync stash and checking its diff before applying it.
