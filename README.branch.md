# DIJIANG integration development handoff

Branch: `codex/opencode-legacy-cagent-integration`

This branch preserves unfinished OpenCode and CAgent integration work as of
2026-10-21. Development is paused after the maintainer requested an audit of
scope growth and divergence from the original application. This is a development
snapshot, not a release candidate or a claim of complete Legacy/CAgent support.

Start with the [handoff](docs/maintenance/handoff-20261021/README.md).
The [Chinese branch guide](README.branch.zh-CN.md) and
[Chinese handoff archive](docs/maintenance/zh-CN/HANDOFF-20261021.md)
record the same decisions. English documents are the next-agent handoff.

## What this branch contains

- Existing OC1/OC2 compatibility plus the CAgent host contracts, capability
  controls and offline adapter kit.
- Exact OpenCode 1.2.27 profile work through accepted INT-04, and unfinished
  INT-05 Provider, credential, queue and scheduled-task changes.
- Tests and probes already authored for those changes.
- Original specifications, milestone history, sanitized checkpoint evidence and
  a chronological archive of the Codex conversation.

The starting personal baseline was
`a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6`. The last committed development source
before this snapshot was `cb22855708b58db33dcef762068615b33ae1e6f2`, on
`codex/cagent-integration`. The snapshot also includes that checkout's pending
source, tests and documentation. Other worktrees and branches are separate work.

## Before continuing

Read the handoff's audit findings before extending the design. In particular,
CAgent currently selects a separate minimal chat application, ordinary OpenCode
startup requires backend discovery, Legacy credential APIs require a Windows
native process, and old queue records without connection identity stop sending
automatically. These are review findings, not fixes made by this snapshot.

R3/INT-05 is incomplete. R4-R7 and real environment-local CAgent acceptance remain
open. The historical CAgent prerelease does not validate this snapshot.
Do not treat historical passing checks as fresh validation of the complete HEAD.

## Working with the snapshot

Use the root `package.json` as the source of build/test commands. Its declared
toolchain is Node.js 22 or newer and Bun 1.4.2. Follow the module documentation and
project skills before editing. Reinstall dependencies only if needed; generated
build outputs and selected local caches were removed during handoff.

The [original project README](README.md) retains the application's normal
overview. No package version, release tag or release asset is changed by this
handoff.
