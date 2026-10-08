# DIJIANG Development Plan: Future Major Releases

Recorded 2026-09-16 from the maintainer's request. This document preserves requirement intent and historical code context. [PLAN.md](PLAN.md) remains the general execution queue; its RUN-01/RUN-02 entries now delegate OpenCode integration status and acceptance to the [integration milestones](OPENCODE-INTEGRATION-MILESTONES.md). HOST-01 through HOST-04 still cover section 4.

The maintainer's original 2026-09-16 request is preserved verbatim in [DEV-PLAN.original.md](DEV-PLAN.original.md). If sections 1 through 5 differ from that source, the original takes precedence. Later explicitly added requirements follow the dates recorded in this plan.

Each major release corresponds to one DIJIANG feature increment. See [BUILD.md](BUILD.md) for versioning rules.

## 1. MCP optimization (major release)

The maintainer still needs to define the exact scope. Work can build on the current state:

- The MCP reconnect module copies a pinned BGPM package (`@waylaidwanderer/background-process-mcp` 1.2.8) into a versioned runtime directory and replaces the `npx` call with a direct `node` invocation (`packages/web/server/lib/mcp-reconnect/launch.js:9-75`).
- An always-running OpenCode plugin reconnects servers that OpenCode marks `failed`, using backoff from 1s to 30s (`mcp-reconnect/runtime.js:52-246`). It records idle reclamation before sending the disconnect request, so it can recover even when the response is lost (`idle-reclaim.js:22-86`).
- Idle reclamation runs after five minutes when every session is idle and the BGPM task count is zero. Clients send the resource mode through a lease to `POST /api/system/project-resources` (`resource-modes.js:7-55`).
- On Windows, stdio connections run in a Job Object that terminates them when closed (`mcp-reconnect/windows-job.cs`). Settings changes are applied later; see `config-entity-routes.js:149-231` and `mcp.js:43-166`. The UI is in `McpSidebar.tsx` and `McpPage.tsx`, with JSON import in `mcpImport.ts` and `McpPage.tsx:630-724`.
- DIJIANG 1.2 and 2.1 reduced process counts, added idle reclamation and recovery, bounded log size, and protected active sessions. Records are in [PLAN.md](PLAN.md) and [evidence/MCP-1.2.md](evidence/MCP-1.2.md).

Scope questions to resolve: which costs to target (process count, memory, startup delay, or reconnect storms); whether more MCP servers should share lifecycle management; and which acceptance measures will demonstrate the result.

## 2. Interaction improvements (major release)

The [interaction design](INTERACTION-DESIGN.md) expands on the following four items, including proposed behavior, runtime differences, open product decisions, and acceptance criteria. Read it when designing or implementing this milestone. The original request remains the source of intent, and PLAN.md remains the source of execution status.

### 2.1 Sidebar letter case

Current behavior conflicts with the request: CSS forces project labels to lowercase through the `lowercase` class in `packages/ui/src/components/session/sidebar/projects/sortableItems.tsx:102`. Sticky headings and the Recent list reuse that style (`SessionProjectScroller.tsx:415-428` and `SidebarActivitySections.tsx:267`). Session titles preserve the case entered by the user (`SessionNodeItem.tsx:1424`; rename logic is in `useSessionActions.ts:127-136`). The shared `Button` base class also applies `lowercase` (`components/ui/button.tsx:49`). Project and session names are not currently converted to uppercase.

Task: define the intended letter-case rule. The documented intent is to show folder names exactly as they appear on disk; see `sidebar/utils.tsx:159-160`. Apply the rule consistently to project titles, sticky headings, Recent, worktree groups, and session titles, without changing unrelated Button styles.

### 2.2 Update notifications for the DIJIANG release repository

Current behavior: personal builds set `updatePolicy` to `"notify-only"` (`packages/web/personal-build.json`). Desktop checks fetch `openchamber/openchamber/releases/latest` and compare its tag with the upstream version (`packages/electron/personal-updates.mjs:10-26`, `personal-build.js:11-12`, and `main.mjs:4467-4475`). Web, mobile, and VS Code query the official update API and fall back to npm on failure (`package-manager.js:23-187,675-704`); they read release notes from the community `changelog/index.json`.

Personal builds are published to this fork's Releases with version format `v<upstream>-DIJIANG.<feature.fix>`; see the “Operations” section of [BUILD.md](BUILD.md). Task: verify new DIJIANG release metadata from the fork's Releases or a release manifest, then compare DIJIANG versions so installed personal builds can notify users when a newer personal build is available. Keep the notification-only policy and the 403 installation guard (`openchamber-routes.js:39-103`).

### 2.3 Work status: breathing effect in chat

Current behavior: chat's work-status row uses `BusyDots` with an opacity breathing animation (`animate-busy-pulse`, 1.2s ease-in-out infinite), disabled when reduced motion is enabled. See `packages/ui/src/components/chat/message/parts/BusyDots.tsx:8-23` and `packages/ui/src/index.css:1749-1760`. Session list items show a static dot and duration at one-second granularity (`SessionNodeItem.tsx:730-746`, `SessionActivityDuration.tsx:11-33`). Two defined keyframe animations are currently unused: `navrail-dot-wave` and `border-glow-pulse` (`index.css:1762-1817`).

Task: add a breathing effect to the conversation UI itself, such as a glow or border pulse around the chat container or input. Define its scope so it appears only when `sessionStatus` is busy/retry. Reuse the unused `border-glow-pulse` if appropriate. Keep the reduced-motion opt-out.

### 2.4 Improvements to adding projects

The maintainer still needs to define the exact scope. Current flow: `DirectoryExplorerDialog` supports manual path entry with autocomplete, directory browsing, multi-selection, repository cloning, and directory creation. Submission uses `useProjectsStore.addProject` (`packages/ui/src/stores/useProjectsStore.ts:596-656`) and server routes `GET /api/fs/home`, `GET /api/fs/list`, `POST /api/fs/mkdir`, and `POST /api/fs/clone` (`packages/web/server/lib/fs/routes.js:710,723,761,1585`). Entry points include the sidebar heading, mobile drawer, project settings page, and command palette.

## 3. OpenCode integration milestone

Revised 2026-10-08 for the current OC1/OC2 architecture. This milestone completes requirements 3.1-3.7 and adds a dedicated Legacy OpenCode 1.2.27 profile with automatic detection or manual selection and operation-wide compatibility.

Urgent addition on the same date: CAgent is an independent backend with an API available only inside the target environment. Deliver its shared architecture, offline adaptation kit and environment-local acceptance before the remaining integration work. A local agent works in a bounded adapter workspace; evidence-based capability gates disable unavailable features and typed extensions expose CAgent-specific features.

Detailed requirements and execution gates now live in:

- [CAgent architecture](CAGENT-INTEGRATION-SPEC.md) and [local adapter workbook](CAGENT-ADAPTER-WORKBOOK.md): urgent CA-00 through CA-03, contract boundaries and local acceptance.
- [CAgent consumer contract](CAGENT-CONSUMER-CONTRACT.md): chat/sync migration, missing-field behavior and protected adaptation expectations before feature activation.
- [Integration SPEC](OPENCODE-INTEGRATION-SPEC.md): adapter boundaries, five explicit connection modes, disposal and UI behavior.
- [Legacy 1.2.27 SPEC](OPENCODE-LEGACY-1.2.27-SPEC.md): profile selection, API/event/config compatibility and exact-version acceptance.
- [Subversion milestones](OPENCODE-INTEGRATION-MILESTONES.md): common baseline, CAgent priority gate, Legacy evidence and proposed DIJIANG 5.0-5.13 delivery gates; the authoritative execution status for this milestone.
- [Current source audit](OPENCODE-INTEGRATION-AUDIT.md): coverage and remaining work for every former 3.X requirement.

The [original request](DEV-PLAN.original.md) remains an unchanged historical record. Existing OC1/OC2 support is the implementation base; it does not establish exact 1.2.27 compatibility. RUN-01/RUN-02 are routed to the new milestone queue.

## 4. Decouple third-party platforms (major release)

Goal: decouple all third-party platform integrations so another platform can replace the current one later, while keeping facade layers on both the server and shared UI. [ADAPTERS.md](ADAPTERS.md) contains the design: platform adapters own endpoints, authentication, pagination, and payload conversion; application operations use platform-independent repositories, change requests, and review records; GitHub-specific fields stay inside the GitHub adapter. Current coupling includes GitHub server code under `packages/web/server/lib/github/`, the Web adapter in `packages/web/src/api/github.ts`, shared types in `packages/ui/src/lib/api/types.ts`, state in `useGitHubPrStatusStore.ts`, and a separate VS Code bridge composition. Local Git, release metadata, the skills directory, and providers are intentionally separate identities.

PLAN.md lists staged tasks: HOST-01 inventory and contracts, HOST-02 repository/PR reads, HOST-03 mutations and authentication, and HOST-04 a second hosting platform. This section records the maintainer's intent to deliver the plan as one major release; HOST tasks remain the execution details.

## 5. Built-in tools (major release)

Scope direction: improve and extend built-in development tools and support opencode-like commands that are not native OpenCode. The clearest current example is automatic development-server discovery. The server scans listening ports (Windows uses `netstat -ano`; other systems try `lsof` and then `/proc/net/tcp`) and exposes `GET /api/dev-servers` (`packages/web/server/lib/dev-servers/routes.js:71-135`). The browser panel merges announced and detected servers (`lib/browser/announcedServers.ts:3-17`, `lib/browser/devServers.ts:31-42`), and the project action button offers “Auto-discover” (`ProjectActionsButton.tsx:389-400,466-511,551-570`).

Related discovery tools include nested Git repositories (`fs/routes.js:307-378`, `GET /api/fs/git-dirs`), Git credentials (`git/credentials.js:7`, `git/routes.js:98`), project icons (`project-icon-routes.js:319-396`), skills and directory scanning (`skills.js:156-199`, `skills-catalog/`), loop files (`scheduled-tasks/loops.js:167-186`), and running-instance detection (`packages/web/bin/lib/cli-lifecycle.js:163-219`).

OpenCode-like command support shares the connection model defined in the [integration SPEC](OPENCODE-INTEGRATION-SPEC.md). Tool injection and upgrades must follow process ownership and the resolved compatibility profile. The maintainer still needs to provide a list for the broader built-in-tool scope.

## 6. Configure the no-project chat directory in Settings (release TBD)

Added 2026-09-25. The server reads `OPENCHAMBER_CHATS_DIR` only at startup. If unset, it uses `chats` under the OpenChamber user configuration directory (`packages/web/server/index.js:292-302`). This environment variable lets deployments where OpenCode runs as another user place no-project chats somewhere both users can access, but the app currently has no matching setting.

The goal is to configure the **server-side** no-project chat directory in Settings and persist it on the server so clients connected to the same server use the same effective directory. Keep the environment variable as an optional configuration path for older deployments, but make it secondary. Precedence is: the value saved by the user, then `OPENCHAMBER_CHATS_DIR`, then the current default directory. Use the environment variable or default again only after the user clears the saved setting. If the user explicitly selects an invalid or inaccessible directory, show an error instead of silently falling back to the environment variable.

Settings should show the effective path and its source, and state that the path belongs to the server's filesystem so users do not mistake a client-local path for a remote one. Define when a saved change takes effect. If the server must restart, tell the user and verify after restart. A directory change affects only no-project chats created afterward; it does not automatically move or delete existing chat directories. Existing sessions continue to load from their original paths, and cleanup handles only chat directories whose ownership has been confirmed. Project and worktree chat storage rules remain unchanged.

Acceptance covers four cases: a saved setting, environment-variable-only configuration, neither value set, and an explicitly invalid setting. Check persistence after server restart and consistency across clients. In a deployment where OpenCode and OpenChamber run as different users, create and open a no-project chat and verify both can access the target directory. Also confirm that old chats still open and switching directories does not delete data by mistake. Add this item to [PLAN.md](PLAN.md) when implementation begins, and decide its release assignment and migration plan then.
