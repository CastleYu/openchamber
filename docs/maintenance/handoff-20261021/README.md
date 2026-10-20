# Integration handoff, 2026-10-21

Development is paused. The maintainer requested preservation, a separate branch,
cache cleanup, a commit and a push. This handoff does not resume the development
goal or authorize treating unfinished work as accepted.

## Read in this order

1. [Branch guide](../../../README.branch.md) for snapshot scope.
2. This document for decisions, risks and the stopping point.
3. [Milestones](../OPENCODE-INTEGRATION-MILESTONES.md) for detailed historical
   acceptance and remaining gates.
4. [Conversation archive](conversation-archive.md) when a decision needs its
   original wording. It preserves user requests and final answers in their
   original language. Historical assertions can be superseded by later entries.
5. [Evidence index](evidence-index.json) for archived checkpoint records.

The [Chinese archive](../zh-CN/HANDOFF-20261021.md) mirrors this handoff.

## Repository identity

The implementation checkout is
`C:\Users\74756\.codex\worktrees\dijiang-next\openchamber`.
The chat's `cdee` checkout is a different, older worktree. Do not accidentally
edit it as the active integration implementation.

The personal baseline is `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6`.
Before this snapshot, the branch was `codex/cagent-integration` at
`cb22855708b58db33dcef762068615b33ae1e6f2`.
The destination is `origin/codex/opencode-legacy-cagent-integration` in
`CastleYu/openchamber`. The new branch preserves pending changes without merging
them into the personal branch or another agent's work.

## Maintainer decisions from the conversation

- Extend the existing simultaneous OC1/OC2 architecture. Reorganize DEV-PLAN
  into version-specific specifications and bounded subversion milestones.
- Audit original 3.X tasks against upstream implementation. The existing
  integration audit and specifications retain that mapping.
- Add exact OpenCode 1.2.27 automatic/manual profile selection and operation
  adaptation. Current OC1 and OC2 remain supported independently.
- Prioritize CAgent architecture and documentation before the other integration
  work. Its Server API cannot be accessed here. A weak local agent must be able
  to implement mappings from environment-local documentation.
- Unknown/unsupported features stay unavailable. CAgent-specific additions use
  explicit extension contracts. Do not invent API routes or infer support from
  synthetic fixtures.
- Complete the architecture/offline kit, regress existing functionality, build
  and publish its limited preview, then proceed with the remaining INT work.
  The historical preview was delivered. Real CAgent acceptance remains local to
  its inaccessible environment.
- Keep English handoff documentation and synchronized Chinese archive copies.
  Later edits must update both.
- Review and reduce design/code growth. Prefer workflow-sized rounds over many
  tiny checkpoints. Clean disposable files during development.
- Consult Astra when an implementation problem warrants an architectural check.
  The latest scheduled-attempt discussion is a proposal, not implemented work.
- The maintainer approved installing the matching Visual Studio Spectre library
  after MSB8040 blocked the Windows portable build. This was a local compiler
  prerequisite, not a new application feature or runtime dependency.
- The maintainer approved changing the new private OAuth interface to
  `beginOAuth(...)` returning bound authorize/callback/cancel operations.
  This does not authorize changing established OC1/OC2 public contracts.
- The maintainer subsequently paused the goal and requested scope/divergence
  audits. The current instruction is to preserve and hand off the work.

## Accepted scope and unfinished work

| Area | Recorded state | Boundary |
| --- | --- | --- |
| INT-00, CA-00, INT-00L | Accepted preflight/inventory/exact-version evidence | Historical evidence, not fresh HEAD validation |
| CA-01 / CA-02 | Minimum architecture and offline-kit preview published | Full consumer migration and remaining kit gates stay at R6 |
| CA-03 | Unavailable environment-local work | No real CAgent API integration is claimed |
| R1 / INT-01, INT-02 | Accepted profile/connection work | See R1 acceptance review |
| R2 / INT-03 | Accepted core conversation work | Exact Legacy and current OC1/OC2 journeys have recorded evidence |
| INT-04 | Accepted advanced operations/recovery | See archived `int04-acceptance.json` |
| R3 / INT-05 | In progress at pause | Provider/OAuth, plugins and unattended acceptance remain incomplete |
| R4-R7 | Pending | Reload/config apply, remaining planned features and final host acceptance |

The latest code includes Legacy Provider UI and HTTP/VS Code bridges, native
credential ownership, queue attempt handling and scheduled watchdog retirement.
The watchdog prevents late local continuation after timeout. An already-started
remote operation can still execute.

Durable scheduled attempts, terminal reconciliation, confirmed resubmit and
peer-safe recovery proposed after the watchdog checkpoint are not implemented.
Do not start by assuming the proposal is already accepted code.

## Audit findings to resolve before expanding scope

1. `packages/ui/src/apps/BackendGate.tsx` replaces the original app with
   `CAgentApp.tsx`. That page requires explicit workspace/session IDs and owns
   separate history, composer and status behavior. It is a limited pilot.
   Growing it into a second full frontend would diverge from the shared product.
2. `packages/ui/src/lib/agent/client.ts` requires
   `/api/agent-backend/selection` before the normal OpenCode app mounts.
   Discovery failure blocks the entry. Compatibility with hosts lacking that
   route needs a deliberate decision, without guessing backend identity.
3. `legacy-credential-operations.js` requires Windows/native process context
   even for Server API auth operations. Review API capability separately from
   local configuration-file ownership; preserve identity and authorization checks.
4. `message-queue/runtime.js` stops dispatch for old items without a connection
   target. Taking an item for editing remains possible. This affects all modes,
   so migration/user behavior belongs in acceptance, not only Legacy tests.
5. The separate Legacy Provider page duplicates some common settings/auth UI
   responsibilities. Review presentation reuse after confirming protocol needs.
   File count alone does not justify removing necessary lifecycle protection.

The previous static audit counted 394 tracked package files changed from the
personal baseline, with about 11,199 implementation insertions and 19,705 test
insertions, plus untracked files. These are historical classification results,
not a claim that every line is unnecessary. This snapshot does not repair those
findings or perform a broad refactor.

## Verification evidence

Historical records include 81 R2 focused checks, 79 queue-terminal checks and
74 scheduled watchdog/regression checks. The exact 1.2.27 probe recorded eight
direct/queue cases and ten controlled model calls. The latest watchdog record
reports passing Web type checks and changed-file ESLint, with 22 existing runtime
Oxlint diagnostics. Read the checkpoint JSON for fingerprints and limitations.

The handoff itself checks document links, archived file integrity, staged content
and commit/push identity. It does not rerun application tests, install compilers,
build packages or validate real CAgent, real IDE OAuth, packaged hosts, public
Relay/WAN or physical mobile. Those gaps remain explicit.

## Preserved context and cleanup

`evidence/` preserves sanitized top-level `.json` and `.md` files from the ignored
local `artifacts/` directory. Older documents referring to `artifacts/NAME` can
be resolved here as `evidence/NAME` when that name appears in `evidence-index.json`.
The index records source and archived hashes, byte sizes and redaction counts.
Original local evidence, raw logs, runtime fixtures and release bundles remain
in the worktree. They are not all published as repository files.

The original Codex JSONL remains in the local Codex session directory. The
conversation archive excludes tools, internal reasoning, injected environment
instructions and credentials. The decision summary above is the compact entry
point; load the chronological archive only when necessary.

`cleanup.json` records the exact generated directories removed and measured
bytes. Cleanup is confined to this worktree, skips tracked files and reparse
points, and preserves dependencies, configuration, runtime data, release bundles,
source and evidence. Rebuild commands remain in root/package `package.json`.

## Restart boundary

Keep development paused until the maintainer chooses the next scope. The first
decision is whether to narrow the four audited boundaries or continue the
existing milestone design. Do not automatically expand a new adapter framework
to solve the audit. Preserve existing guards against cross-runtime mutations and
duplicate sends while reviewing simpler ownership.

When implementation resumes, freeze a bounded workflow, inspect its current
source and matching skills, run the necessary focused checks, then hand off
integration and release separately. No new Release is part of this snapshot.
