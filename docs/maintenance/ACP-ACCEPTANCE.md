# ACP acceptance and feature parity

Review date: 2026-10-14. Scope: the current independent ACP worktree, including its uncommitted changes. English is canonical; [Chinese archive](ACP-ACCEPTANCE.zh-CN.md).

The 2026-10-21 handoff preserves this tested source and selected logs in the [durable evidence archive](evidence/acp-handoff/INDEX.md). References to `.codex-temp` below identify the original local runs.

## Evidence

Real-agent checks call OpenChamber's `createAcpRuntime`, including its process launcher, permission handling, tool projection, persistence and cancellation. They use isolated D-drive workspaces and the configured OpenAI-compatible model credentials. These are model-backed backend integration checks. They do not establish a new packaged-browser, mobile or remote ACP Server acceptance.

OpenCode 1.19.0 (`--pure acp`) completed two concurrent sessions with distinct markers, file reading/writing with exact approval options, denied writes, cancellation while awaiting approval, cancellation of a running shell process, restart/resume with remembered context, and agent history loading into an empty client store. The cancelled shell exited in 1,839 ms; its delayed output file was absent. Cancellation at a pending permission returned `end_turn` from this agent, while running-shell cancellation returned `cancelled`; neither left pending approvals or performed the blocked write.

The live run exposed Windows scoped discovery comparing forward-slash UI paths against native agent paths. The fix normalizes local stdio queries and comparisons while preserving remote path spelling and the stored agent cwd. A fresh in-memory client then discovered three real sessions with a lowercase drive, forward slashes and a trailing separator, and loaded six messages with the original marker. Focused runtime/parity/mapping tests passed 30/30 with no skips; syntax, oxlint, Web ESLint and Web type-check passed. Bun could not launch the package checks, so the installed Node TypeScript/ESLint entrypoints ran the same package arguments successfully.

Qwen Code 0.25.1 completed two concurrent model-backed sessions with distinct assistant replies, approved file writes, rejected writes with no file created, cancellation of a running terminal turn, and restart/load followed by a new successful prompt. The initial model requests failed because OpenCode Go requires `x-opencode-session`. The isolated Qwen settings used its supported `outboundCorrelation.allowDynamicHeaderValues` and `generationConfig.customHeaders` with the literal `${session_id}`. The dedicated `OPENCODE_GO_API_KEY` remained in the process environment. This was a provider configuration correction; it required no product code change.

A fresh runtime also recovered the first reply's marker without receiving that marker in the new prompt. A separate approved shell command wrote its PID before waiting 60 seconds to write a file. Cancellation returned `interrupted`; OS polling confirmed the PID exited, and the delayed file remained absent throughout 62 seconds of observation. Both agents were stopped before temporary-directory cleanup.

Grok CLI was invoked with `--model grok-4.7 --reasoning-effort high`. It emitted a complete review in one `grok-4.7-build` model call. Saving its own chat then failed with a disk-space error, so CLI exit status was 1. The complete answer was captured; this is a completed model review with a failed CLI archive, not a clean CLI run. Source/protocol cross-checks corrected two model errors: ACP v1 supports capability-gated session deletion, and advertised slash commands intentionally travel as ordinary prompt text.

## Feature matrix

“Implemented” describes current code; only the real-agent results above are live acceptance. “UI possible” distinguishes presentation using an existing operation from a proposed approximation. No speculative feature in this table was added during acceptance.

| Existing OpenChamber feature | ACP today | UI-only completion or alternative | What needs an agent/backend contract |
|---|---|---|---|
| Explicit cmd/server connection selection | ACP stdio and explicit ACP Server are separate choices | Existing connection UI | A generic HTTP server URL is not an ACP transport; remote credentials are not implemented |
| Multiple sessions and concurrent conversations | Implemented; one process can own multiple sessions | Existing sidebar and chat | Agent concurrency support; same-session prompts remain serialized |
| Project/cwd selection | Per-session stdio cwd; explicit remote default and mappings | Existing project selector | Remote directory availability and mapping; no automatic file upload |
| Session discovery/pagination | Advertised `session/list`; local saved records retained | Existing session list | Agent must supply list; Windows path fix described above |
| History, reload and continuation | Local transcript plus advertised load/resume | Existing history renderer | Missing agent history cannot be reconstructed by UI; agents without restore remain read-only |
| Rename, archive and unarchive | Local metadata, preserved across discovery | Already available | Cross-client synchronization requires an agent/host metadata service |
| Remove/delete | Agent delete when advertised; otherwise local hiding | Already available | Local hiding does not delete agent history |
| Streaming text/reasoning and live status | Implemented from ACP updates | Existing message rendering | Agent must emit updates; persisted history is not live status |
| Tool calls, output and diffs | Implemented; running output and mixed text/diff retained | Existing tool cards | Exact input/output/diffs depend on agent updates |
| Plans/todos | ACP plan updates projected to todo cards | Already rendered | UI cannot infer authoritative plan state when none is emitted |
| Permission grant/reject | Exact agent option IDs/names/kinds | Existing permission card | Persistent policy and OpenCode auto-accept semantics belong to the agent/backend |
| Stop | `session/cancel`, pending-input cleanup and local owned-terminal cleanup | Existing Stop control | Agent cancellation cooperation; remote command termination remains agent-owned |
| Questions/forms/URL input | Implemented elicitation and consent UI | Already available | Agent must emit a compatible request |
| Model/reasoning/mode selection | Advertised select config options and legacy modes | Existing ACP controls | Arbitrary provider catalogs and unsupported settings cannot be invented |
| Slash commands | Advertised commands with autocomplete, sent as prompts | Existing command UI | Command meaning belongs to the agent; OpenCode built-ins are not universally portable |
| Context compaction | No generic OpenCode compact action for ACP | An advertised agent compact command can be offered; a summary prompt is only text | True context replacement/compaction requires agent support |
| Image/audio/embedded text | Negotiated prompt capabilities | Hide unsupported inputs; render accepted attachments | Agent/model capability and payload support |
| Local file attachment | Resource links on stdio; local file URLs rejected for ACP Server | Existing attachment flow | Remote file transfer/access needs a backend contract |
| Session move | No portable live-session move | UI may regroup a local record, but cannot retarget an existing session cwd | Agent-supported migration/recreation and clear history semantics |
| Fork/fork-at-message/BTW | Exact fork unsupported | A new session seeded with selected transcript is feasible as an explicitly named copy-context action, not an exact fork | Agent hidden state, tool context and branch lineage require fork support |
| Revert/unrevert/retry-from-message | Exact rollback unsupported | UI can copy/edit/resubmit text, not rewind state | Agent history plus filesystem rollback transaction |
| Session-wide change review | Per-tool supplied diffs are available | UI could aggregate supplied diffs; this is incomplete when edits/diffs are missing | Authoritative session changes/checkpoints require host or agent records |
| Usage/context display | Agent-supplied usage/config data only | Present supplied usage; derive message/tool counts from available transcript | Exact billing, token categories and global usage require agent accounting; absent data is not zero |
| Same-instance session/message links | App navigation, separate from ACP | Existing links | Recipient must access the same OpenChamber instance |
| Public share/unshare | OpenCode sharing API unavailable | Local export/copy is a possible separate experience | Public publishing/access control needs a host service |
| Provider catalog, credentials and OAuth | OpenCode management unavailable; advertised agent authentication is separate | Render declared auth methods; terminal login remains CLI-side | Provider credential storage and OAuth lifecycle |
| Agent/subagent catalog and switching | Only advertised modes/options; no portable child-agent management | Render supplied controls; independent chats can be arranged side by side | Agent spawning, lineage, results and cancellation semantics |
| MCP status/connect/config/tool catalog | No ACP management implementation; new/load send empty `mcpServers` | A panel alone cannot administer an agent | ACP MCP configuration forwarding could be added at the backend; dynamic management needs agent APIs |
| Skills/plugins/hooks/agent configuration | OpenCode-specific configuration unavailable | Expose an advertised workflow command; not a managed skills catalog | Agent-specific configuration and lifecycle |
| LSP | Not available through ACP client facade | Show unavailable state | A host LSP service or agent API |
| File search/browser, Git and worktrees | Existing host services remain separate | Reuse existing host UI and routes | These operate on host files, not automatically on remote agent files; not all flows were live-tested here |
| User terminal vs agent terminal | Host terminal remains separate; ACP callbacks on local stdio only | Existing host terminal and ACP output cards | Remote ACP gets no local filesystem/terminal callbacks |
| Queue and parallel composer | ACP queue gated; parallel composer OC2-only | Foreground client queue/parallel dispatch could use ACP prompts, with explicit tab-lifetime limits | Durable delivery, ordering, restart recovery and background scheduling need a backend owner |
| Goals, schedules and autonomous continuation | OpenCode workflows gated/unavailable | A goal prompt or draft reminder is possible, not a scheduler | Durable scheduler, budgets, cancellation and session lifecycle |
| Prompt optimization/synthetic context | OpenCode-backed operations not portable | Local text editing/templates can operate before send | Model generation, hidden/synthetic insertion and provider selection require supported operations |
| Connection health/reconnect | ACP info/status and SSE snapshots implemented | Existing connection state UI | OpenCode health/upgrade/server administration do not become ACP operations |
| Web/Electron/hosted mobile/Capacitor | Shared backend ACP owner | Shared conversation UI | Each platform still needs device acceptance; this run tested Windows backend |
| Standalone VS Code | Explicitly unsupported for ACP | UI alone cannot enable it | Extension-host launcher/bridge and validation |

## Sources and retained evidence

- Baseline inventory: [dual-kernel interfaces](DUAL-KERNEL-INTERFACES.md), UI-01–20, HTTP-01–11, EV-01–07 and CFG-01–05.
- Implementation: [ACP owner](../../packages/web/server/lib/acp/DOCUMENTATION.md), `packages/ui/src/lib/opencode/acp.ts`, `client.ts`, composer capability gates and session actions.
- Protocol: [session deletion](https://agentclientprotocol.com/protocol/v1/session-delete), [slash commands](https://agentclientprotocol.com/protocol/v1/slash-commands).
- Local evidence: `.codex-temp/acp-opencode-real.log`, `acp-opencode-stop.log`, `acp-discovery-real.log`, `acp-discovery-fix-results.md`, `acp-qwen-configured-run.json`, `acp-qwen-final-probe.json`, `acp-grok-parity.log` and `acp-grok-parity-results.md`. These logs are development evidence, not release assets.

This acceptance task does not publish a release. The existing portable package predates any fix made here.
