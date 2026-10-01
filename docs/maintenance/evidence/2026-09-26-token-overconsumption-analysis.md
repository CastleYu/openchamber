# Token overconsumption analysis

Date: 2026-09-26  
Task: OpenChamber OC1 and OC2 dual-runtime compatibility delivery  
Measurement cutoff: 2026-09-26T07:55:24.371Z, when the goal was marked complete

## Finding

The task consumed more tokens than expected because a small number of long-running agents made thousands of model calls while carrying large, growing contexts. The cache worked well. It served 98.39% of all input tokens. The problem was the number of calls and the amount of new context added on every call.

The audit found 7,237 unique model usage records across 98 related rollout files. It includes the root agent, 48 collaboration subagents, and 48 automated Guardian review sessions. No duplicate response IDs were found.

The raw processed total was 1,171,249,263 tokens. Most of that was cached input. A more useful measure for diagnosing new work is uncached input plus output, which was 21,411,567 tokens. Excluding Guardian reviews, it was 17,720,033 tokens.

The goal meter reported 15,831,548 tokens. That counter does not equal raw model tokens or uncached input plus output. Its weighting formula is not present in the rollout logs, so this report does not treat it as a billing total.

## Measurement definitions

| Measure | Definition | Use in this report |
|---|---|---|
| Input | All input tokens reported by the model call | Measures total context read |
| Cached input | Input tokens served from prompt cache | Measures context reuse |
| Uncached input | Input minus cached input | Approximates new input introduced by each call |
| Output | Model output tokens | Includes reasoning output; reasoning is not added twice |
| Raw total | Input plus output | Measures all model processing before cache pricing |
| Incremental volume | Uncached input plus output | Diagnostic measure for newly processed work, not a billing formula |
| Cache rate | Cached input divided by input | Token-weighted cache reuse, not the percentage of requests that hit cache |

## Overall usage

| Source | Input | Cached input | Uncached input | Output | Raw total | Cache rate |
|---|---:|---:|---:|---:|---:|---:|
| Root agent | 251,135,199 | 247,259,264 | 3,875,935 | 582,404 | 251,717,603 | 98.46% |
| Collaboration subagents | 886,950,065 | 875,714,304 | 11,235,761 | 2,025,933 | 888,975,998 | 98.73% |
| Guardian review | 30,520,575 | 26,864,128 | 3,656,447 | 35,087 | 30,555,662 | 88.02% |
| Total | 1,168,605,839 | 1,149,837,696 | 18,768,143 | 2,643,424 | 1,171,249,263 | 98.39% |

The cache reused 1.15 billion input tokens, but cache hits are not zero-cost in every pricing or quota system. The account-level cost cannot be derived without the product's cache weighting and model rates.

## Usage by model

| Model | Input | Cached input | Uncached input | Output | Raw total | Cache rate |
|---|---:|---:|---:|---:|---:|---:|
| GPT-6 Sol | 748,471,934 | 740,433,920 | 8,038,014 | 1,494,782 | 749,966,716 | 98.93% |
| GPT-6 Astra | 257,450,158 | 253,360,768 | 4,089,390 | 594,721 | 258,044,879 | 98.41% |
| GPT-6 Luna | 132,163,172 | 129,178,880 | 2,984,292 | 518,834 | 132,682,006 | 97.74% |
| Codex auto-review | 30,520,575 | 26,864,128 | 3,656,447 | 35,087 | 30,555,662 | 88.02% |

Sol and Astra handled 86.1% of raw processing. Luna handled 11.3%. The requested economy-agent policy reduced the cost of several bounded tasks, but the largest implementation work remained in Sol and the root agent stayed on Astra for most of the implementation and release phase.

## Root agent analysis

The root agent made 1,377 model calls. It issued 1,351 tool actions and received 513 subagent messages. Almost every model response ended with one tool action, so each small action caused another model call with an average input context of about 182,379 tokens.

| Root metric | Value |
|---|---:|
| Model calls | 1,377 |
| Tool actions | 1,351 |
| Incoming subagent messages | 513 |
| Uncached input | 3,875,935 |
| Output | 582,404 |
| Incremental volume | 4,458,339 |
| Average input per call | about 182,379 |
| Average uncached input per call | about 2,815 |
| Average output per call | about 423 |

### Root tool activity

| Action | Count | Share of tool actions |
|---|---:|---:|
| Execute commands and read results | 916 | 67.8% |
| Send messages to subagents | 214 | 15.8% |
| Add follow-up work | 67 | 5.0% |
| Spawn subagents | 55 | 4.1% |
| Wait for subagents | 47 | 3.5% |
| Browser or UI automation | 33 | 2.4% |
| List agent status | 16 | 1.2% |
| Other | 3 | 0.2% |

The 916 command calls are the clearest root-level inefficiency. Many independent reads, status checks, tests, and Git inspections could have run in batches. Splitting them into individual calls forced the model to process the large root context again.

The agent coordination was also too granular. The root created 55 agents, sent 214 messages, added 67 follow-up tasks, and received 513 messages. A bounded task should normally need one complete assignment, one blocker report if necessary, and one final result. This run averaged far more coordination per agent.

### Largest root turns

| Phase | Model calls | Main activity | Incremental volume | Raw total |
|---|---:|---|---:|---:|
| Final integration, acceptance, CI, and release | 429 | 265 commands, 59 messages, 27 waits, 25 follow-ups, 33 UI calls | 1,025,136 | 74,344,816 |
| Initial implementation dispatch and integration | 357 | 216 commands, 73 messages, 27 spawns, 19 follow-ups | 957,777 | 67,334,225 |
| Mid-run integration closure | 197 | 149 commands, 33 messages, 6 spawns | 630,656 | 40,080,128 |
| Combined | 983 |  | 2,613,569 | 181,759,169 |

These three turns produced 71.4% of the root agent's model calls and 72.2% of its raw total.

Two individual root responses also incurred cold input loads of 232,199 and 176,266 tokens. Together they added about 415,000 incremental tokens. One of them was a simple user-facing rewrite. Long-lived context and a model or cache boundary made a small request expensive.

### Root mistakes

1. The root kept research, architecture, implementation, validation, native acceptance, release, and shutdown diagnosis in one long context.
2. It used Astra for mechanical command execution, CI polling, agent coordination, and log inspection after the architecture work was complete.
3. It inspected many results one at a time instead of batching independent reads and checks.
4. It responded to frequent progress messages and continued to direct subagents in small steps.
5. It allowed Goal continuations to start more work without a token budget, call limit, or phase stop condition.

## Collaboration subagent analysis

The 48 collaboration subagents produced 888,975,998 raw tokens and 13,261,694 incremental tokens. The total is concentrated in a few long-lived agents.

### Agents whose scope expanded

#### `autonomous_kernel_closure`

This agent made 1,164 model calls. It began with server kernel operations, then received several additional work streams:

- dual-runtime permission, message, synthetic message, and metadata operations;
- OC2 Stats and its endpoint and epoch cache behavior;
- Web Search configuration routes;
- OC2 provider, model, agent, and plugin catalog diagnosis;
- the `integration.list` activation barrier;
- real OC2 conversation, persistence, streaming, and interruption checks;
- product-gap and interface-ledger review;
- `/fork`, goal-file inheritance, and rollback behavior;
- configuration mocks, SQLite cleanup, cache-count tests, DOMPurify, Happy DOM, and jsdom test closure;
- OC2 file search, PWA cursor pagination, and skill discovery.

The name suggests one closure task. The session became a second general-purpose implementation agent.

#### `ui_facade_completion`

This agent made 1,031 model calls. It implemented the OC1 and OC2 UI facade, then continued into several UI products:

- session operations, sending, pagination, configuration, catalogs, permissions, forms, MCP, and provider authentication;
- generation-tagged configuration, provider state, model IDs, and agent data;
- separate OC1 and OC2 provider workflows;
- Agent and MCP settings, OAuth, `codemode`, `protocol`, and per-item timeouts;
- model selector behavior;
- execute and Web Search rendering;
- plugin status, errors, updates, and VS Code plugin source paths.

It crossed facade, state, settings, renderer, plugin, and VS Code ownership boundaries.

#### `sync_domain_integration`

This agent made 601 model calls. Its work was more coherent but still combined two large tasks:

- OC2 event projection and source, endpoint, and epoch guards across shared runtimes;
- migration of remaining legacy session actions;
- permission and form state;
- OC1 question preservation;
- sidebar and worktree behavior;
- sync documentation and about 100 focused session-action tests.

The sync runtime and the permission and form UI should have been separate assignments.

#### `session_fixture_closure`

This Luna agent made 329 model calls. It started as a test-fixture task and was later reused for unrelated validation work:

- two batches of SDK-to-domain fixture migrations;
- isolated OC1 and OC2 server startup;
- catalog, stream, persisted message, metadata, and interruption acceptance;
- catalog schema and plugin activation retesting while another agent changed production code;
- upstream theme extraction and validation;
- preview component DOM tests;
- sidebar upload tests and a `Blob.name` test fix.

Using Luna reduced model cost, but reusing the same context for four types of work defeated the bounded-task design.

### All agents

Incremental volume is uncached input plus output.

| Agent | Model | Calls | Raw total | Incremental volume | Cache rate |
|---|---|---:|---:|---:|---:|
| Root | Sol, Astra | 1,377 | 251,717,603 | 4,458,339 | 98.46% |
| `autonomous_kernel_closure` | Sol | 1,164 | 222,695,577 | 2,470,681 | 99.07% |
| `ui_facade_completion` | Sol | 1,031 | 192,658,082 | 1,883,170 | 99.20% |
| `sync_domain_integration` | Sol | 601 | 109,623,068 | 901,916 | 99.33% |
| `session_fixture_closure` | Luna | 329 | 54,206,246 | 1,192,742 | 98.15% |
| `session_storage` | Sol | 307 | 53,221,106 | 582,642 | 99.09% |
| `release_preflight` | Luna | 260 | 36,849,040 | 677,264 | 98.49% |
| `message_renderer_dual` | Sol | 178 | 34,146,386 | 333,394 | 99.20% |
| Guardian | Auto-review | 378 | 30,555,662 | 3,691,534 | 88.02% |
| `ui_contracts` | Sol | 194 | 30,535,457 | 300,577 | 99.24% |
| `restore_oc1` | Sol | 138 | 24,019,177 | 324,841 | 98.92% |
| `autonomous_workflows` | Sol | 138 | 21,455,520 | 251,936 | 99.06% |
| `integrated_validation` | Luna | 78 | 9,263,154 | 235,058 | 98.00% |
| `interface_inventory` | Sol | 68 | 8,696,274 | 307,538 | 96.92% |
| `descendant_activity` | Sol | 70 | 8,191,451 | 153,179 | 98.37% |
| `opencode_breaking` | Sol | 52 | 8,187,294 | 369,822 | 95.74% |
| `portable_smoke_prepare` | Luna | 73 | 7,605,230 | 188,654 | 97.88% |
| `opencode_ux` | Luna | 52 | 6,924,086 | 226,870 | 97.03% |
| `proxy_realtime` | Sol | 63 | 6,417,245 | 120,669 | 98.48% |
| `product_mapping` | Sol | 60 | 4,306,034 | 76,274 | 98.62% |
| `shutdown_diagnosis` | Sol | 43 | 4,136,149 | 124,117 | 97.38% |
| `final_docs_evidence` | Luna | 35 | 4,036,995 | 159,875 | 96.49% |
| `fork_command_menu` | Luna | 37 | 3,763,859 | 141,203 | 96.71% |
| `portable_smoke_repair` | Sol | 53 | 3,613,742 | 91,438 | 97.96% |
| `review_ui_contracts` | Astra | 36 | 3,605,116 | 114,428 | 97.07% |
| `vcs_branch_closure` | Sol | 36 | 3,282,703 | 103,823 | 97.14% |
| `review_product_integration` | Astra | 29 | 3,121,149 | 148,477 | 95.47% |
| `baseline_validation` | Luna | 29 | 1,890,611 | 102,707 | 95.02% |
| `review_transport_storage` | Astra | 19 | 1,642,540 | 69,548 | 96.04% |
| `config_conversion` | Luna | 23 | 1,606,695 | 80,679 | 95.46% |
| `sidebar_upload_validation` | Sol | 22 | 1,447,736 | 85,176 | 94.40% |
| `final_delta_review` | Astra | 17 | 1,406,751 | 86,431 | 94.10% |
| `task_review` | Sol | 16 | 1,302,426 | 83,226 | 94.27% |
| `product_delta` | Luna | 17 | 1,301,882 | 68,218 | 95.30% |
| `final_promotion_review` | Astra | 17 | 1,284,297 | 87,753 | 93.39% |
| `review_sync_forms` | Astra | 15 | 1,202,931 | 58,867 | 95.37% |
| `task_decomposition` | Sol | 16 | 1,171,865 | 165,785 | 86.61% |
| `ui_acceptance_run` | Luna | 23 | 1,169,362 | 27,346 | 98.02% |
| `review_kernel_composition` | Astra | 15 | 1,130,377 | 51,465 | 95.73% |
| `baseline_environment` | Sol | 23 | 1,109,447 | 157,383 | 86.05% |
| `domain_fixture_validation` | Luna | 13 | 900,256 | 52,640 | 94.79% |
| `kernel_architecture` | Astra | 12 | 846,078 | 87,934 | 90.16% |
| `review_server_operations` | Astra | 12 | 795,160 | 35,224 | 95.94% |
| `server_acceptance` | Luna | 15 | 755,876 | 26,532 | 97.16% |
| `promotion_manifest` | Luna | 11 | 718,709 | 95,605 | 88.27% |
| `shared_model_design` | Astra | 10 | 705,774 | 66,030 | 91.11% |
| `v1_inventory` | Luna | 10 | 696,453 | 100,741 | 85.97% |
| `route_cost` | Luna | 9 | 591,111 | 83,207 | 86.36% |
| `promo_extract` | Luna | 7 | 402,441 | 43,785 | 90.61% |
| `review_detection` | Astra | 6 | 337,080 | 64,824 | 81.15% |

## Guardian overhead

Guardian did not implement product code. It reviewed escalated Git writes, network and dependency actions, native application launches, process and registry operations, and release actions.

The 48 Guardian sessions consumed 3,656,447 uncached input tokens while producing 35,087 output tokens. The ratio is about 104 input tokens for every output token. Each review often received a large task and permission context, and its cache rate was lower than the implementation agents.

The correct response is not to bypass review. The root should reduce the number of separately escalated operations, use stable approved command prefixes where appropriate, and group related actions into narrow commands that one review can evaluate.

## Root causes

### 1. Too many model boundaries

The run created 7,237 model responses. Each response added about 2,594 uncached input tokens and 365 output tokens on average. Small tool actions became expensive because they repeatedly crossed a model boundary.

### 2. Long-lived subagents received unrelated follow-up work

The largest subagents did not stop after their original assignment. The root reused them for successive implementation, debugging, validation, and documentation work. Their stable cached prefix grew, and every new command carried the full accumulated context.

### 3. The root micromanaged execution

The root inspected results, forwarded progress, assigned corrections, and polled status in small increments. It did work that should have remained inside bounded subagent tasks or a single validation runner.

### 4. The task kept every phase in one goal

Research, design, implementation, testing, native acceptance, release, and post-release shutdown diagnosis shared one task. The root context never returned to a small baseline.

### 5. No usage limits existed

The goal had no token budget. Subagents had no model-call limit, follow-up limit, or maximum retry count. Goal continuation therefore favored completion without a cost boundary.

### 6. Expensive models handled mechanical work

Astra remained active for most root coordination. Sol handled 64.0% of raw processing across the task. Many command, test, fixture, and status operations could have used Luna after the architecture was settled.

### 7. Validation expanded after the release was already viable

Some late validation was useful, but the stopping rule was unclear. The native shutdown investigation was visible and frustrating, but it was not the main source of excess. The three portable and shutdown agents added 404,209 incremental tokens, about 1.9% of the total. Earlier qualitative analysis overstated its importance.

## Controls for the next upstream update

### Split the lifecycle

Use separate tasks for:

1. upstream and interface inventory;
2. architecture and task approval;
3. implementation;
4. integration and runtime validation;
5. promotion and release.

Each task should start with a compact handoff document instead of the full prior conversation.

### Bound every subagent

Each assignment should define one owning area, allowed files, one acceptance command set, and a stopping point. Close the agent after its final response. Start a new agent for a different feature even if the old agent is idle.

Recommended limits:

| Item | Limit |
|---|---:|
| Ordinary bounded subagent | 40 model calls |
| Complex implementation subagent | 150 model calls |
| Follow-up assignments | 1 per subagent |
| Validation retries for one failure | 2 |
| Root model calls per phase | 200 to 300 |
| Root command calls per phase | 100 to 150 |

Crossing a limit should produce a blocker and evidence report. The root then decides whether to start a fresh task.

### Reduce coordination traffic

Subagents should report only a blocker, a material change in direction, or the final result. The root should avoid progress acknowledgements that do not change the next action. Use one bounded wait for a group of agents rather than repeated status checks.

### Batch tool work

Independent file reads, Git checks, and test-result inspections should run in one tool call. A validation agent should run the agreed command set and return one structured report. The root should rerun only commands needed to verify disputed evidence.

### Assign models by phase

| Work | Model |
|---|---|
| Architecture and one final cross-cutting audit | Astra |
| Complex implementation and debugging | Sol |
| Fixture migration, tests, documentation, packaging, CI observation | Luna |

Switch models at phase boundaries. Repeated switching inside a large context can cause cold cache loads.

### Set an explicit budget

A future task of similar scope should start with a goal budget and phase allocations. A practical first target is 8 million goal-meter tokens, with a review at 50%, 75%, and 90%. The review should remove repeated validation and coordination before reducing required product scope.

## Expected savings

This projection uses observed incremental tokens per call. It is directional, not a pricing estimate.

- Reducing the root from 1,377 calls to 300 at the same average incremental rate would save about 3.5 million tokens.
- Limiting the three largest implementation agents to 150 calls each would save about 4.4 million tokens if their work were split into fresh bounded tasks.
- Halving Guardian cold-context overhead through fewer separate escalations would save about 1.8 million incremental tokens.

These changes would reduce the observed 21.4 million incremental volume to roughly 11.6 million before other batching and model-selection savings. More aggressive phase separation is needed to return to the original goal-meter expectation near 8 million.

## Evidence and limits

The audit reads `token_usage_record` entries from session rollout JSONL files whose session ID matches the task. It deduplicates by response ID and stops at the goal-completion timestamp.

The supporting scripts are local diagnostic artifacts:

- `.codex-temp/token-audit.mjs`
- `.codex-temp/root-token-audit.mjs`
- `.codex-temp/agent-task-audit.mjs`

The logs expose token counts and cache fields. They do not expose the account's monetary price, subscription quota weighting, or the goal meter formula. This report therefore separates exact token evidence from cost interpretation.
