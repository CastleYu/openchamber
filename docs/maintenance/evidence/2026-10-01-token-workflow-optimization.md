# Upstream intake workflow optimization

Date: 2026-10-01
Subject: the DIJIANG 4.1 upstream intake turn that ran from 2026-10-01 01:33 to 07:33 (UTC+8) and stopped at the Codex weekly usage limit.
Simplified Chinese: [2026-10-01-token-workflow-optimization.zh-CN.md](2026-10-01-token-workflow-optimization.zh-CN.md)

## Result

The workflow changes below are estimated to cut raw input tokens by 57% and price-weighted usage by 48% for a run of the same scope. With conservative assumptions the reductions are 50% and 41%. Most of the gain comes from two changes: a lower automatic compaction threshold and a short, single-task lifecycle for subagents.

## Measured run

Usage records were deduplicated by response ID across the root session, its subagents and the Guardian reviewer sessions.

| Source | Model | Calls | Raw input | Uncached input + output |
| --- | --- | ---: | ---: | ---: |
| spaces_intake | gpt-6-sol | 1,835 | 348.1M | 2.83M |
| intake_inventory | gpt-6-sol | 1,628 | 323.5M | 3.30M |
| sdk_intake | gpt-6-luna | 1,431 | 255.6M | 4.04M |
| Primary agent | gpt-6.1-sol | 618 | 116.6M | 2.13M |
| Guardian reviewer | codex-auto-review | 220 | 15.6M | 2.43M |
| Two short subagents | astra / 6.1-sol | 34 | 3.2M | 0.24M |
| Total | | 5,766 | 1,062.7M | 14.98M |

Cache reuse was 98.8%. The volume came from the number of calls and the context each call carried:

- Compaction ran at 310k–337k tokens and left 47k–60k, so a call carried about 189k tokens on average. Context grew by about 1,200 tokens per call.
- The primary agent gave each large subagent 10–12 new tasks. Each subagent also received 42–63 messages from the primary agent and 31–43 from other subagents.
- There were 408 empty polls of running processes and 568 `send_message` calls across the primary agent and the three large subagents.
- 41%–52% of subagent calls produced fewer than 200 output tokens. One subagent read `useConfigStore.ts` 60 times.
- About 218 commands asked for escalation. Each one started a Guardian session with a cold cache (84.6% reuse). Guardian made up 1.5% of raw input but 16% of incremental usage.
- After upstream advanced at 22:53 UTC, the run took in 37 new commits. Calls after that point carried 12%–14% of each agent's input.

## Where the behavior came from

| Layer | Contribution |
| --- | --- |
| Codex default | Proactive subagents are disabled unless AGENTS.md or a skill asks for them. |
| User `~/.codex/AGENTS.md` | The economy-subagent section explicitly authorized proactive delegation. |
| `personal-upstream-sync` skill | `dual-kernel.md` assigned standing roles: Sol for inventory, decomposition and review, Astra for architecture, Sol for complex implementation. |
| Primary agent orchestration | Reused the same agents with new tasks and sent frequent messages. No rule required this and none prevented it. |
| Codex mechanics | A 380k window delayed compaction, every tool call is a full model call, sandbox escalations start reviewer sessions, and four concurrency slots invite parallel standing agents. |
| Task instruction | "Add new upstream commits during the work" removed the natural stopping point. |

## Changes made

| File | Change |
| --- | --- |
| `.agents/skills/personal-upstream-sync/references/execution-economy.md` | New. Pinned scope, phase sessions with a handoff file, a delegation table with call budgets, agent lifecycle, waiting, tool-call batching, Windows sandbox notes and checkpoints. |
| `.agents/skills/personal-upstream-sync/references/dual-kernel.md` | Removed the standing Sol/Astra role assignments. The primary agent owns inventory, split, architecture and acceptance; delegation follows the execution economy. |
| `.agents/skills/personal-upstream-sync/SKILL.md` | Requires reading the execution economy first. New upstream commits during a run become a separate follow-up batch. |
| `~/.codex/AGENTS.md` | Kept the delegation authorization. Added the subagent lifecycle and cost rules, the two-agent concurrency cap, long waits instead of polling, grouped escalations, and pinned scope with phase sessions. |
| `~/.claude/CLAUDE.md` | The same rules, adapted to Claude Code. |
| `~/.codex/config.toml` | `model_auto_compact_token_limit = 160000`. The key is present in Codex CLI 0.154.0 and the configuration loads. |
| `~/.codex/memories/memory_summary.md` | Scoped the "delegate many low-level tasks" memory to the request that made it, and recorded this incident and its rule. |

Backups of the three user-level files are next to them with the suffix `.bak-token-economy-20261001`.

## Static estimate

Model: raw input ≈ calls × average context. With linear growth between compactions, the average context is about (residual + trigger) / 2. Each compaction reads one full window and makes the next call miss the cache for the residual. Removed calls are mostly polls and messages, so each is counted at half the average fresh input and output.

Measured inputs: residual 52k, growth 1,200 tokens per call, old trigger 320k, 1,682 fresh input tokens and 346 output tokens per call.

Assumptions for the levers:

- A. Compaction trigger at 160k.
- B. Call discipline: 80% fewer empty polls, 85% fewer messages, 15% of shell calls merged by batching.
- C. Grouped escalations: 80% fewer Guardian sessions.
- D. No duplicate verification by the primary agent (200 fewer calls) and summary test output (20% less fresh input per call).

Price weighting assumes cached input costs 0.1 of uncached input and output costs 8 times uncached input. This is the usual API price ratio. The account's actual Codex credit weights are not in the logs. Under this weighting, cached input was 79% of the baseline cost.

| Scenario | Calls | Raw input | Uncached + output | Weighted |
| --- | ---: | ---: | ---: | ---: |
| Baseline (model check) | 5,766 | 1,070.6M | 14.97M | 134.3M |
| A only | 5,766 | 613.4M (−42%) | 16.88M (+13%) | 90.3M (−32%) |
| A + B + C | 4,231 | 454.4M (−57%) | 12.78M (−15%) | 68.9M (−48%) |
| A + B + C + D | 4,031 | 431.4M (−59%) | 10.39M (−31%) | 64.2M (−52%) |
| A + B + C, conservative (B at 70%/70%/0%, C at 60%) | 4,951 | 530.4M (−50%) | 14.34M (−4%) | 78.8M (−41%) |
| Window reset only (≈245k trigger) + B + C | 4,231 | 631.2M (−41%) | 11.71M (−22%) | 85.7M (−36%) |

Limits:

- Lowering the trigger adds compactions, from 25 to about 47, and each one misses the cache once. Fresh-token usage rises unless B and D also apply.
- The estimate keeps the same product scope. Deferring the 37 late commits moves their cost to the next batch; it does not remove it.
- Moving the two Sol subagents to Luna does not change token counts. It lowers cost only if the account weights the models differently, and the logs cannot show that.
- Fixed per-call context is about 43k tokens. The installed-skill list makes up about 31k characters of it and the memory summary about 13k. This estimate does not reduce that.

## Not applied: maintainer action

These settings change approval or plugin behavior for every project, so they need the maintainer's own decision.

- Approval rules. Add narrow `prefix_rule` entries to `~/.codex/rules/default.rules` for commands this intake must escalate, such as `["git", "fetch"]`. Do not allow general `node` or `bun` prefixes; group those escalations per phase instead.
- Plugins. Disabling plugins that are never used in this repository, such as the Vercel, Slack, Linear and Gmail bundles, would shrink the skill list loaded on every call.

## Resuming the current intake

The interrupted work is uncommitted in `.worktrees/upstream-intake-20261001` (branch `codex/upstream-intake-20261001`, about 1,125 changed paths). Resume it as phases. Each phase starts a new session from the intake evidence and the failure notes.

1. Primary agent only, budget 150 calls. Check the worktree and run the existing focused checks once. Commit a task-scoped checkpoint on the intake branch. Generate the remaining commit digests with a script, then finish the review from about entry 205 and record ledger rows.
2. At most two new subagents, budget 120 calls each: message search on the server (Luna medium) and the Spaces follow-ups (Sol medium only for runtime identity and credentials). Each one owns its files and returns a result file.
3. One Luna low validation agent runs the fixed validation matrix. The primary agent then runs the strict Electron check against the latest build and the real OC1/OC2 kernel check.
4. Primary agent: bilingual Settings history, evidence, commit, and promotion to `codex/personal`. Publish only on request.
