# OpenChamber ACP handoff branch

`codex/acp-handoff-20261021` freezes the independent ACP development based on DIJIANG 4.0. This is a source handoff, not a new application release.

[中文归档](README-ACP.zh-CN.md) · [Development and Codex conversation handoff](docs/maintenance/ACP-HANDOFF.md) · [38-feature acceptance table](docs/maintenance/ACP-ACCEPTANCE.md)

## Included

Explicit OpenCode command/server and ACP stdio/server selection; Windows BAT/CMD launch; multiple sessions; streaming tools and diffs; permissions and forms; advertised model/mode controls and commands; local callbacks; remote project mappings; persisted history and Windows scoped discovery.

Real OpenCode 1.19.0 and Qwen Code 0.25.1 checks covered concurrent sessions, tool execution, approval/rejection, cancellation with process exit, and restored context. Exact fork/rollback, public sharing, provider/MCP administration and durable scheduling remain outside implemented generic ACP support. Standalone VS Code ACP, exact OpenCode 1.2.27 and real remote/mobile acceptance remain unvalidated.

## Run and build

Use `bun install --frozen-lockfile`, then `bun run dev`. Build a local portable package with `node scripts/build-personal.mjs --acp`. Read [connection setup](docs/maintenance/ACP.md) and [build details](docs/maintenance/ACP-BUILD.md).

Select a program, separate arguments and an absolute working directory. For OpenCode use `opencode.exe` with `--pure` and `acp`. BAT/CMD paths need no surrounding quotes. ACP Server needs an explicit transport, endpoint and remote working directory.

The publishing workflow remains restricted to `codex/acp-integration`. This handoff branch does not widen that gate or publish automatically. Existing [ACP.3.1](https://github.com/CastleYu/openchamber/releases/tag/v2.0.4-DIJIANG.4.0-ACP.3.1) predates this snapshot's additional work.

## Continue development

Read the handoff and [retained evidence index](docs/maintenance/evidence/acp-handoff/INDEX.md) before editing. Start a bounded follow-up from this snapshot. Run checks for subsequent changes, then prepare a new package in a separate release task. Historical acceptance does not validate future changes.

The paused 5.X/CAgent route is background, not active scope. Its loose local remnants are preserved as an inert patch in the evidence archive rather than activated in this branch. User data, installed dependencies and existing release packages remain intact.
