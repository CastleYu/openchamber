# Intake execution economy

Read this before starting upstream intake work, and again before delegating. It owns how the intake is staged, delegated, waited on and budgeted. The parent skill and [dual-kernel intake](dual-kernel.md) still own what must be decided and verified.

The cost of an agent run is roughly the number of model calls times the context each call carries. Every tool call, wait and message is a call that rereads the whole context. The 2026-10-01 intake spent 1.06 billion input tokens on 5,766 calls with an average context of about 189,000 tokens. Three long-lived subagents made 85% of those calls. See the [workflow optimization record](../../../../docs/maintenance/evidence/2026-10-01-token-workflow-optimization.md) for the measurements behind these rules.

## Pin the scope

Pin the upstream target once, in W0. If upstream advances during the run, record the new commits in the evidence file and keep working on the pinned target. When the maintainer asked to follow upstream, fetch once more after the pinned batch is validated and committed, then process the new delta as a separate batch in a new session. Do not re-audit already dispositioned commits because the target moved.

## Run phases as separate sessions

Each phase below starts a new session from the handoff file, not from earlier chat history. The handoff file is the dated intake evidence under `docs/maintenance/evidence/` plus the adoption ledger. It lists the pinned SHAs, the worktree path, finished dispositions, open items and the next command to run.

| Phase | Work | Owner |
| --- | --- | --- |
| 1. Pin and classify | Fetch, back up, pin. Generate the commit list, per-file three-way state and test map with scripts. Classify commits into ledger rows. | Primary agent. Delegate classification only when more than about 80 commits remain unclassified. |
| 2. Implement | Apply clean files with the deterministic apply script. Resolve conflicts module by module. | Primary agent for cross-boundary decisions. One fresh subagent per independent module batch. |
| 3. Integrate and validate | Run the validation matrix once. Rerun only failures and disputed evidence. Run real-kernel and native checks last. | One validation subagent runs the fixed command list. The primary agent judges the results. |
| 4. Record and promote | Update the ledger, bilingual Settings history and evidence. Commit, promote and publish only when authorized. | Primary agent. History translation can be delegated as one batch. |

Generate deterministic facts with scripts before any model reads them: the commit list, file states (no delta, clean apply, conflict), and the tests that cover each file. Keep these scripts in the task temp directory and reuse them across phases. A model should read a conflict's three sides and judge it; it should not read files whose state a script already settled.

## Delegate only bounded work

The primary agent does inventory, classification under the threshold, architecture review and final review itself. Scripts and the ledger keep that work small. Do not create standing inventory, task-decomposition or review agents.

| Work | Delegate when | Model | Call budget |
| --- | --- | --- | ---: |
| Commit classification batch | More than about 80 unclassified commits. Give 40 commits per agent and require JSON ledger rows. | Luna low | 40 |
| Clean apply and focused tests for one module | The module has at least 15 independent files. | Luna low | 60 |
| Conflict resolution in one owning module | The conflicts sit inside one owner and do not change a shared contract. | Luna medium. Use Sol medium only for protocol, sync, credential or security boundaries. | 120 |
| Validation matrix run | Once per integration. | Luna low | 30 |
| Architecture review | Only when a changed contract crosses the dual-kernel boundary for the first time. | Astra medium, one shot | 40 |

Run at most two subagents at once besides the primary agent. Give them non-overlapping file owners.

Every brief names the owned files, the ledger rows or input file, the skills that own those files, the exact commands to run, the acceptance check, the call budget, and the return format. The return is at most 30 lines plus the path of a detailed result file. The subagent loads only the skills named in the brief.

## Agent lifecycle and messages

- One task per agent. The agent ends with its final answer. New scope gets a new agent with `fork_turns` set to `none`; never use `followup_task` to give a finished agent more work.
- An agent that reaches its call budget stops, writes a checkpoint file and returns the blocker. The primary agent decides whether a new, short task is worth it.
- Subagents message only for a blocker or the final result. Subagents never message each other. A cross-owner need goes to the primary agent as a blocker.
- The primary agent does not send progress pings or restate instructions. It waits for agents with one `wait_agent` call with a timeout of several minutes, not repeated status checks.
- The primary agent reviews diffs and result files. It reruns a subagent's check only when the evidence is missing, contradictory or touches a release gate.

## Tool calls

- Wait for builds and tests with one long yield of at least 120 seconds. Do not poll a running process with empty input.
- Run tests with a summary reporter. Send long output to a file and read only the failures and counts.
- Put independent reads, searches and Git checks in one command. Read a range with `rg -n -C` or a line window instead of whole files.
- Write facts you will need again into the batch notes. Do not reread the same file to recover something already learned.
- Discover before reading. Use `rg --files <owner directory>` or `git ls-tree` before opening a path you have not seen.
- Set the working directory explicitly. Source and tests run in the task worktree; task tools under `.codex-temp/` run from the invoking root.

## Windows sandbox notes

These failures repeated across agents on 2026-10-01. Avoid them up front.

- `rg` does not expand wildcard path arguments on Windows. Pass a directory and filter with `-g`.
- Node `child_process` cannot start Git inside the sandbox (`EPERM`). Do Git reads in the shell, such as `git show` or `git cat-file` into files, and let Node scripts read those files.
- `git fetch` writes `.git/FETCH_HEAD`, which the sandbox blocks. Put every fetch for the run into one command and escalate that command once.
- `bun install` needs the pinned Bun 1.4.2 binary and a writable temp directory. Use one scoped escalation for the install.
- An isolated Electron run needs its AppData, XDG and userData directories created before launch, `OPENCHAMBER_PORT` set to the isolated API port for the Vite proxy, and a visible composer as the readiness check.
- Group the commands that need escalation at the start of a phase into a single escalated command. Each escalation starts a separate reviewer session with a cold cache.

## Budget and checkpoints

Set a budget at the start of the run and record it in the handoff file. As a starting point for an intake of about 250 upstream commits: the primary agent uses at most 300 calls per session, and all subagents together use at most 1,200 calls per intake. At 50%, 75% and 90% of the budget, write the usage and remaining scope into the handoff file. Cut duplicate verification and coordination first; do not cut required product scope.
