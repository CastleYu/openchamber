# ACP handoff evidence

This archive is part of the 2026-10-21 source handoff. [Chinese index](INDEX.zh-CN.md).

- `acp-*-results.txt` and `acp-parity-delivery.txt` are historical implementation checkpoints. Early blocked or pending claims are superseded by [final acceptance](../../ACP-ACCEPTANCE.md).
- `acp-opencode-real.txt`, `acp-opencode-stop.txt`, `acp-discovery-real.txt`, `acp-qwen-configured-run.json` and `acp-qwen-final-probe.json` retain real-agent evidence. The Qwen final probe checks new assistant output, OS process exit and absence of delayed writes.
- `acp-grok-parity.txt` contains the completed Grok review, including its later CLI archive failure. The results file records source/protocol corrections.
- Workspace type/lint/dead-code and dual-kernel outputs retain earlier validation. Closure-specific outputs record the tests run again for this snapshot.
- Command notes preserve environment failures and working alternatives. Machine-specific paths in historical evidence identify the original run, not portable setup instructions.
- `paused-5x-remnants.patch` preserves 12 loose files from the paused route, including edit scripts, notes and unused legacy-provider code. It is archival material, not an ACP implementation or an instruction to run those scripts. The loose originals were removed after verifying all 12 against the committed patch and verifying the remote commit tree.

The Codex discussion is summarized in [the handoff](../../ACP-HANDOFF.md). Raw conversation dumps, credentials, global user configuration, dependency trees, generated bundles and release executables are excluded.

`local-context.zip` supplements the selected evidence with 171 remaining local diagnostic files, logs, scripts, package metadata and a screenshot. `local-context-manifest.json` lists each archived path and SHA-256. Known environment secret values and credential token patterns were scanned before packaging; no replacements were needed. The archive excludes `.env`, Git metadata, dependencies, generated bundles and executables. Historical scripts are evidence, not instructions to execute.

The maintainer subsequently requested complete removal of this worktree after checking the remote archive. `.env` is removed from the branch snapshot. All remaining worktree files, including dependencies and generated packages, are removed locally after remote verification. Other worktrees and external portable installations are retained. `closure-summary.txt` records the earlier cache-only cleanup and test results.
