# Dual-kernel prepublication verification

## Source and release identity

- Original personal tip: `bfde007f9913cc906a96ef494de886bf608d1238`.
- Retained OC1 core: personal `4ac81115c17c203c89c5b52f93a930af32ea2163`, official OpenChamber `1.24.2` / `614d7f7`.
- Upstream comparison target: OpenChamber `2.0.1` / `63bd5070c8620432817e1e67de77791f801bcf3e`.
- Tested implementation: `58eb82862a7c365276bc31703e8c28b8c633ca20`.
- Whitespace-only follow-up: `afbaed25622b4d60d1010fd55342c897fbbc4cbe`.
- Reviewed integration: `e8082be404d273fc5041a615e3187d5e3542bd28`. Its tree equals the implementation follow-up tree. Both the original personal tip and implementation history are ancestors.
- Release identity: `1.24.2-DIJIANG.4.0`. This is the retained OC1 product core with dual-kernel adaptations and the adopted increments in the 154-row product ledger, not a full upstream 2.0.1 product merge.

## Final checks

Commands ran in the implementation worktree with Bun 1.4.2, before the whitespace-only follow-up. `git diff --ignore-space-at-eol` proved that follow-up changed no other content.

| Check | Result |
| --- | --- |
| Frozen dependency installation | Passed; no lockfile rewrite |
| `bun run type-check` | All workspaces passed, exit 0 |
| `bun run --cwd packages/web build` | Passed, exit 0; 6,408 modules and PWA service worker built |
| `node scripts/test-dual-kernel.mjs` | 14 isolated files, 86 tests passed |
| CI Web contract selection | 9 files, 119 tests passed |
| Publisher and isolated-runner Node tests | 10 tests passed |
| Broader changed server matrix | 52 files, 760 passed, one skipped |
| Broader UI/VS Code matrix | Initially 186 of 191 files passed; all five failures were repaired and passed in the separate 140-test correction run |
| VCS branch closure | 35 focused tests and UI type-check passed; cold bootstrap, branch clearing, directory and runtime isolation covered |
| Staged whitespace/conflict checks | Passed |
| Skill validation | Personal upstream sync and UI API boundary skills passed their schema checks |

The broader matrix was not rerun after every local correction. Focused correction runs, final workspace type-check, final CI selections and final production build are the evidence for the final implementation. Whole-package lint and dead-code reports contain an existing backlog; authored paths received focused review and checks.

## Real kernel and browser checks

Isolated OC1 **1.18.32** and OC2 **2.0.16** runs used a local controlled provider. Both covered catalog activation, prompt submission, two streamed text chunks, persisted history, interruption, idle state, metadata semantics and owned-process cleanup. No paid model request or user configuration was used.

Browser checks covered both transcripts and interrupted partial responses. OC1 retained existing turn statistics, scheduling and multi-run controls, and hid OC2-only controls. OC2 showed the new Stats view and Web search settings. The final OC2 browser rerun verified model restoration, `/fork` suggestions, creation and selection of the correctly titled fork, an empty composer and no console errors or warnings.

The maintainer explicitly deferred exact OC1 1.2.27 verification and authorized the current OC1 version for this phase. Default portable packaging retains OC1 1.18.31; external Server API connections remain supported. No exact 1.2.27, mobile-device, full VS Code host, external OAuth, live permission or external Web search acceptance is claimed.

## Publication and retained work

Local native packaging reached Web staging, bundled OC1 CLI verification and Electron main bundling, then failed with MSB8040 because the local Visual Studio installation lacks Spectre libraries. Windows CI must build the portable artifact. Verify the workflow source, release tag, build-info and uploaded SHA-256 digests, then perform an isolated startup/shutdown check on the downloaded executable.

The original root checkout's tracked patch was saved before integration. Its OpenCode compatibility declaration is incorporated in the new AGENTS guide. Its unrelated Chinese update-history edit must remain unstaged after promotion. Temporary test profiles, downloads and reports are excluded from source commits. The backup branch remains at the original personal tip; publication uses a normal fast-forward and never a force push.

The release metadata and workflow provide the final publication source and artifact evidence. This document records the prepublication verification and does not assert that a future CI run or release has already succeeded.
