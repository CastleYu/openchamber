# OpenCode Module Documentation

## Purpose

Personal-build OpenChamber update checks include `notifyOnly`. The install route rejects replacement with HTTP 403 before loading process/package-manager dependencies. Policy and version ownership are documented in [the personal build guide](../../../../../docs/maintenance/BUILD.md).
This module provides OpenCode server integration utilities for the web server runtime, including configuration management and provider authentication.

## Entrypoints and structure
- `managed-env-runtime.js` owns the managed child configuration sequence. It
  requires the protected OpenCode family/revision before reading settings and
  after each asynchronous preparation phase. Retirement prevents subsequent
  tool/prompt/MCP phases and rejects the result; it cannot undo writes already
  performed by an entered preparer. OC1 retains the tool/prompt/MCP merge order
  and switches; OC2 uses only its managed configuration builder. Unknown
  generations refuse before configuration work. Lifecycle still checks its
  original selection before spawning. This gate does not activate CAgent.
- `managed-generation.js` probes the selected CLI through its resolved launch
  specification before managed configuration or plugin writes. Lifecycle spawning
  reuses that specification. An unknown generation stops startup before writing.
- `../agent-tool/dual-routes.js` checks the active family and Legacy profile before dispatching
  the agent-tool callback by generation. `plugin-routes.js` applies that same
  entry refusal, then captures family/revision and the kernel descriptor around
  directory resolution and rechecks them before plugin reads or mutations.
  Retirement returns 409 before a later effect; it cannot undo a synchronous
  operation that already began.
- Production composition in `packages/web/server/index.js` passes the selected
  agent host into the callback router, event hub, watcher and Git routes.
  `feature-routes-runtime.js` registers plugin routes with generation-specific
  operations. The managed environment lease checks family/revision at entry and
  after each awaited preparation phase. Generation probing identifies OC1/OC2;
  it does not classify or disable the Legacy profile for all plugin preparation.
- The shared event hub owns upstream kernel identity and epoch checks when it
  commits events. The watcher checks current family/revision and refuses Legacy
  events; its standalone reader also checks the attached kernel descriptor.
  Watcher event callbacks do not capture the startup epoch, so a same-target
  managed restart can reconnect through the hub.
- OC1 keeps its existing file-URL plugins, configuration merge and `auth.json`
  ownership. OC2 uses `managed-config-file.js` for watched `OPENCODE_CONFIG` and
  directory plugins; a user-owned config path retains the environment-based
  fallback. Only managed OC2 settings changes refresh this managed file.
- Configuration entity/provider routes select their writers from the current
  backend descriptor. OC2 2.0.15–2.0.19 credential inspection uses the retained
  read-only database view in `auth-v2-legacy.js`. OC2 2.0.20 and newer use
  OpenCode's authenticated credential API through `auth-v2.js`; a failed API
  read never falls back to stale storage. Credential deletion belongs to
  OpenCode's credential API.
  Unknown generations and provider requests spanning a connection change cannot
  fall through to OC1 configuration or credential writes.
- `websearch-config.js` owns OC2 `GET/PUT /api/config/websearch`. The GET
  returns `{ projectPath }`, the project config whose `websearch` key overrides
  the Settings write, or `null`. The PUT accepts `{ selection: false | null |
  string }`; `null` removes the key. It writes through `shared-v2.js` to
  `OPENCODE_CONFIG` when set, otherwise the OC2 user config. The route checks
  the selected kernel before reading or writing and rechecks its epoch after
  directory resolution. Invalid or unreadable config returns an error, not an
  empty source; OC1 cannot read or write this OC2 setting. The VS Code bridge
  forwards the same GET/PUT contract through `api:config/websearch`.
- `compatibility.js` resolves OC1/OC2 from authoritative HTTP health/info responses. It reads health first and stops for stable 1.2.27, including normalized v/build metadata. That version has no `/api/info` API and forwards unknown paths with request headers to its hosted web app. Other versions retain health/info comparison; this exception does not enable the dedicated Legacy profile.
- `kernel-runtime.js` owns one backend endpoint/version/epoch descriptor. Its optional resolved profile participates in identity changes; a changed profile advances epoch even at the same endpoint/version. Web/Electron bind the requested `opencodeSelection` from strict instance settings before startup. An absent field selects Auto; an invalid field or unreadable settings aborts OpenCode startup. After a successful settings write, a changed selection retires the descriptor before the save response. Failed or repeated saves do not retire it. The next runtime/readiness probe resolves the new profile. VS Code uses the same selection parser at manager creation and retires its descriptor after a canonical shared-settings write. Legacy profile admission does not enable its unaccepted operations. Unknown
  startup endpoints are not probed. Credential changes and managed restarts retire
  old request identities, including discovery performed while the old process is
  closing. A health `reprobe` keeps a resolved OC1 or OC2 descriptor when detection
  returns `unreachable` or `unknown`. See lifecycle health monitoring below.
  `/api/opencode/runtime` exposes the descriptor through the authenticated
  OpenChamber route with no-store caching. When profile admission runs, the
  descriptor carries its finite `PROFILE_STATUS` value. Invalidation removes
  that status until a fresh probe commits. Web, Electron and mobile share this
  descriptor; VS Code forwards the same kernel result. No credentials or raw
  error details are added. A health reprobe that preserves a live descriptor
  retains its committed status; runtime discovery performs a fresh refresh.
  Protected host family selection also retires this descriptor. CAgent selection,
  loading and failed loading produce `unsupported` with no OpenCode endpoint or
  probe. Clearing that selection does not select OpenCode. Explicit OpenCode
  selection permits a fresh probe. Concurrent refresh and health consumers share
  one probe; committing its descriptor does not invalidate the other consumer.
  Connection invalidation still rejects outstanding results before commit.
- `kernel-operations.js` selects server-side session/message/send operations from
  that descriptor. Deferred sends carry their captured identity and reject after
  a connection switch. Prompt acceptance does not imply response completion.
  Message views expose ordered `textParts` and explicit `agent`/`variant`
  selections. The goal reader uses these fields without inspecting protocol
  `raw` records. The [CAgent contract](../agent/DOCUMENTATION.md#goal-reader-migration)
  records the remaining migration boundary.
  It also owns generation-specific permission list/reply, single-message reads,
  OC2 synthetic insertion, and OC2 session model/agent switches for the web
  autonomy runtimes. Callers capture identity before multi-step work and pass
  it to writes so an old completion cannot mutate a new connection. OC2
  selection catalog reads first call `integration.list`, whose pinned 2.0.16
  handler awaits plugin activation; direct model and agent lists can otherwise
  return an empty cold registry. The runtime epoch is checked after that wait.
  OC2 fork inheritance rollback uses `removeSession` with the captured identity;
  it rejects OC1 and checks the epoch before sending a DELETE to OpenCode.
- `proxy.js` uses that descriptor to route OC1 requests without `/api` and OC2
  requests with `/api`, including SSE. Unknown generations remain behind the
  readiness gate. An explicit unsupported descriptor returns 501 `unsupported`
  before readiness or forwarding, including HTTP mutations and SSE. A held
  readiness request rechecks that refusal after each wait, so selection of CAgent
  cannot become a restarting response. Previously registered OpenChamber-owned
  routes retain their own guards. The [Chinese review note](../../../../../docs/maintenance/zh-CN/CAGENT-DISPATCH-CONTRACTS.md#通用-opencode-代理拒绝)
  records this boundary. OC1 retains Windows session merging and sanitization; OC2
  preserves cursor envelopes and overlays app-owned archive or pending legacy
  metadata when the owner supplies those getters. The encoded OC2 directory
  header remains intact during upstream forwarding, while the worktree gate
  decodes a local copy for its readiness lookup. A configured archive or metadata
  reader failure makes the OC2 session read fail with 503 rather than returning
  an apparently complete upstream snapshot. Direct SSE responses capture the
  full kernel identity and close on retirement so clients reconnect to the
  selected endpoint. Exact OC1 Legacy 1.2.27 admits only GET `/event` and
  `/global/event` through this generic proxy. Other Legacy HTTP routes retain
  their 501 refusal; kernel-owned operations have their separate finite contract.
  Admission and stale-response checks include the exact version. Stream tests
  cover auth, directory, replay cursor and rejection before upstream work.
- `packages/web/server/lib/opencode/index.js`: public entrypoint (currently baseline placeholder).
- `packages/web/server/lib/opencode/auth.js`: provider authentication file operations.
- `packages/web/server/lib/opencode/auth-state-runtime.js`: managed OpenCode server auth password/header runtime.
- `packages/web/server/lib/opencode/cli-options.js`: CLI/environment option parsing for server startup arguments.
- `packages/web/server/lib/opencode/cli-entry-runtime.js`: CLI entrypoint runtime that detects direct execution, parses CLI options, and starts server bootstrap.
- `packages/web/server/lib/opencode/routes.js`: OpenCode/provider settings and auth-related route registration.
  Its OpenCode resolution, upgrade, health/version, MCP OAuth, provider,
  websearch, warming, directory and managed AGENTS.md routes check the protected
  host family before their handlers. CAgent receives HTTP 501 with
  `unmigrated-consumer` and no-store caching. MCP pending-auth checks precede its
  route-local JSON parser. OpenChamber settings and the runtime descriptor remain
  available. This is an entry check, not a lease across asynchronous work or
  complete migration of all configuration routes. See the bilingual
  [execution checkpoint](../../../../../docs/maintenance/CAGENT-EXECUTION.md).
- `family-guard.js` owns request-entry family refusal shared by the OpenCode,
  configuration entity, plugin and skill registrars. Production supplies the
  protected host selection to all four. Agent, command, MCP, plugin and skill
  route prefixes refuse CAgent before directory resolution, file access or
  registry/scan/install calls. The entity registrar then checks generation
  readiness for OpenCode. App-owned snippets are outside these prefixes.
  The compatibility default for callers without host selection is OpenCode;
  it must not be used by a CAgent-enabled production composition. These checks
  do not retire already entered asynchronous operations.
- `packages/web/server/lib/opencode/v1-migration-topup.js`: re-arms OpenCode's own V1 -> V2 session import for V1 sessions changed by 1.x after the last completed import. `startOpenCodeOnce` runs it only before a managed OC2 spawn. OC1 credential reads and writes stay on their existing path. See "v1-migration-topup.js" below.
- `packages/web/server/lib/opencode/lifecycle.js`: OpenCode process lifecycle runtime (startup, restart, readiness, health monitoring). A valid explicit `OPENCODE_HOST` or skip-start flag establishes external ownership before readiness, even when the target fails. Direct managed start is rejected for external configuration or ownership; recovery only re-probes its configured endpoint. Skip-start without an explicit endpoint fails setup and recovery instead of probing port 4096. The legacy port-only auto-detection branch remains until confirmed connection records replace environment discovery. After readiness it warms the most recently used directories (`getWarmupDirectories` dep, sequential and best-effort) because OpenCode initializes each directory lazily on first request and that cost would otherwise be paid by the user's first interactive session open. The Desktop runtime warms the last-used directory only, because its UI bootstraps the directories it shows in its own priority order.
- `packages/web/server/lib/opencode/provider-env-aliases.js`: mirrors known provider credential env aliases into the managed OpenCode process environment (for example `GEMINI_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY`) so OpenCode connection detection and the upstream AI SDK agree on the same key names. Canonical implementation shared by web lifecycle and the VS Code managed spawn path (`packages/vscode/src/provider-env-aliases.ts` re-exports this module).
- `packages/web/server/lib/opencode/env-runtime.js`: OpenCode CLI/binary resolution and shell environment runtime.
- `packages/web/server/lib/opencode/env-config.js`: OpenCode-related environment variable parsing and validation (host/port/hostname).
- `packages/web/server/lib/opencode/hmr-state-runtime.js`: HMR-persistent runtime state initialization, auth-state bootstrap, and HMR sync helpers.
- `packages/web/server/lib/opencode/bootstrap-runtime.js`: base app bootstrap runtime for status/auth/tts/notification/OpenChamber route wiring.
- `packages/web/server/lib/opencode/network-runtime.js`: OpenCode URL construction, health-probe readiness checks, and API prefix runtime.
- `packages/web/server/lib/opencode/project-directory-runtime.js`: request-scoped and settings-backed project directory resolution/validation runtime.
- `packages/web/server/lib/opencode/config-entity-routes.js`: route registration for agent/command/MCP config orchestration with deferred-apply semantics (`restartDeferred` payloads; explicit apply via `POST /api/config/reload`).
- `packages/web/server/lib/opencode/config-mutation-response.js`: shared response builders for deferred OpenCode restarts and external manual-restart guidance.
- `packages/web/server/lib/opencode/snippets.js`: opencode-snippets-compatible snippet file CRUD, discovery, and hashtag expansion.
- `packages/web/server/lib/opencode/cli-options.js`: CLI/environment option parsing for server startup arguments.
- `packages/web/server/lib/opencode/core-routes.js`: server status/system routes, auth/access guard routes, and settings utility route registration.
- `packages/web/server/lib/opencode/shutdown-runtime.js`: graceful shutdown orchestration runtime for watcher/session/terminal/process/server teardown.
- `packages/web/server/lib/opencode/server-startup-runtime.js`: server listen/startup tunnel flow and process/signal handler orchestration runtime.
- `packages/web/server/lib/opencode/static-routes-runtime.js`: static asset/SPA fallback route registration and manifest route wiring.
- `packages/web/server/lib/opencode/feature-routes-runtime.js`: feature route composition runtime for dynamic import-backed config/skill/provider route registration.
- `packages/web/server/lib/opencode/opencode-resolution-runtime.js`: OpenCode binary resolution snapshot runtime for settings routes and diagnostics.
- `packages/web/server/lib/opencode/upgrade-capability.js`: authoritative upgrade ownership policy for the active OpenCode runtime. Bundled, external, and unresolved runtimes fail closed; only managed non-bundled runtimes delegate upgrades to OpenCode.
- `packages/web/server/lib/opencode/tunnel-wiring-runtime.js`: tunnel service/routes composition runtime and active-port wiring for main server startup.
- `packages/web/server/lib/opencode/startup-pipeline-runtime.js`: server startup tail orchestration runtime for terminal/proxy/static/start-listen flow.
- `packages/web/server/lib/opencode/startup-performance.js`: opt-in startup phase diagnostics with fixed labels and numeric metadata allowlists.
- `packages/web/server/lib/agent-tool/runtime.js`: managed OpenCode custom-tool materialization, environment injection, same-machine authentication (loopback, or the bound address for a concrete bind), and fixed CLI action dispatch.
- `packages/web/server/lib/system-prompt/runtime.js`: opt-in managed OpenCode system-prompt optimizer materialization and plugin injection.
- `packages/web/server/lib/opencode/managed-plugin-config.js`: the one `OPENCODE_CONFIG_CONTENT` merge every managed plugin (agent tools, system prompt optimizer) appends itself through.
- `packages/web/server/lib/opencode/server-utils-runtime.js`: shared server runtime utilities for OpenCode proxy wiring, OpenCode port/readiness helpers, and snapshot fetchers.
- `packages/web/server/lib/opencode/openchamber-routes.js`: OpenChamber update and models metadata route registration.
- `packages/web/server/lib/opencode/pwa-manifest-routes.js`: PWA manifest route registration with recent-session shortcut resolution and short-lived caching.
- `packages/web/server/lib/opencode/project-icon-routes.js`: project icon upload/read/discovery route registration and icon storage orchestration.
- `packages/web/server/lib/opencode/skill-routes.js`: route registration for skill config CRUD, supporting files, and skills catalog scan/install flows.
- `packages/web/server/lib/opencode/settings-runtime.js`: Settings persistence runtime (disk IO, migrations, normalization, project validation, and persisted update serialization). `onOpenCodeSelectionChanged` notifies the host after a changed instance selection has been written successfully, before other settings side effects.
- `packages/web/server/lib/opencode/settings-helpers.js`: Settings payload sanitization/format helpers runtime for response shaping and persisted merge prep.
- `packages/web/server/lib/opencode/settings-normalization-runtime.js`: path/settings/tunnel normalization and sanitization helpers runtime used by settings/routes/config wiring.
- `packages/web/server/lib/opencode/theme-runtime.js`: custom theme JSON validation and theme directory loading runtime for settings utility routes.

  `POST /api/config/themes` saves a converted VS Code palette. The runtime validates
  literal colors and required authored roles, assigns a content-derived filename,
  and publishes through a same-directory hard link so partial files and overwrites
  are impossible. Identical retries reuse the existing file; a manually edited
  collision returns 409. Temporary files are ignored by the loader and removed
  after publication or failure. Non-missing-directory read failures propagate to
  the route instead of returning an authoritative empty library.

  The common request middleware parses theme POST bodies before these routes;
  integration tests must use that middleware rather than an unrestricted test parser.
  `DELETE /api/config/themes/:id` finds a valid regular JSON file by its metadata ID
  inside the custom themes directory. IDs are never used as filenames. Hand-added
  themes are supported; symlinks and bundled themes are outside deletion ownership.
  Duplicate matching IDs fail explicitly. Missing themes are an idempotent success;
  filesystem failures remain errors.
  `theme-catalog.js` owns POST catalog search/package routes under
  `/api/config/themes/catalog/`. It fetches only Open VSX and its Eclipse CDN over
  HTTPS, validates redirects and checksums, and verifies packaged identity.
  `theme-archive.js` reads selected JSON entries in memory with bounded decompression.
  JSON includes and token references stay inside the package. Each failed variant
  is reported separately so valid siblings remain available. No extension code runs.
- `packages/web/server/lib/opencode/proxy.js`: OpenCode API/SSE forwarding and readiness-gate route registration.
- `packages/web/server/lib/opencode/session-runtime.js`: session status/attention/activity runtime for OpenCode SSE events.
- `packages/web/server/lib/opencode/watcher.js`: global SSE watcher runtime for push/session event fanout.
- `packages/web/server/lib/opencode/shared.js`: shared utilities for config, markdown, skills, and git helpers.
- `packages/web/server/lib/ui-auth/ui-auth.js`: UI session authentication runtime (outside OpenCode module).
- `packages/web/server/lib/ui-auth/ui-passkeys.js`: UI passkey storage and WebAuthn registration/authentication helpers (outside OpenCode module).

## Public exports (auth.js)
- `configureOpenCodeCredentials(getRuntime, source)`: Binds the current kernel
  descriptor and OC2 API reader. The reader coalesces by endpoint and epoch.
- `readOpenCodeCredentials()`: Reads the OC1 file, the retained pre-2.0.20 OC2
  database owner, or the 2.0.20+ OC2 API according to the known version. A
  failed read throws; the descriptor is checked again before returning.
- `readAuthFile()`: Reads and parses `~/.local/share/opencode/auth.json`.
- `writeAuthFile(auth)`: Writes auth file with automatic backup.
- `removeProviderAuth(providerId)`: Removes a provider's auth entry.
- `getProviderAuth(providerId)`: Async, returns the selected kernel's stored
  auth for one provider or null. OC2 environment keys are not counted here.
- `listProviderAuths()`: Returns list of provider IDs with configured auth.
- `AUTH_FILE`: Auth file path constant.
- `OPENCODE_DATA_DIR`: OpenCode data directory path constant.

The generic proxy refuses `GET` and `HEAD /api/credential` in both enterprise
and ordinary mode: OpenCode 2.0.20 returns raw secrets there. Enterprise mode
also refuses `POST /api/credential`; account activation and removal stay
available. The server reads the credential API privately with its own auth
headers, never through the client proxy.

## v1-migration-topup.js

OpenCode 2.x imports the legacy `session`, `message`, and `part` tables into
`session_v2` and `session_message` once, then records `{"phase":"completed"}`
under `migration.v1-v2` in the `kv` table. V1 sessions a bundled OpenCode 1.x
created after that point stay out of the v2 session list. `topUpV1Migration()`
writes a resume cursor so OpenCode's own migration imports them. OpenChamber
does not write session rows.

`startOpenCodeOnce` calls it only when the selected managed kernel is OC2,
immediately before that process is spawned. An external OpenCode is left alone,
and the call does not run against a managed process that is already up. A
failure is logged and startup continues. OC1 credential reads and writes stay
on `auth.js`. This module does not open `auth.json`.

It opens `<data>/opencode.db`, or `OPENCODE_DB`, read-write through `node:sqlite`
on Node or `bun:sqlite` on Bun, and skips when neither runtime is available.
It returns `{ status: 'skipped' | 'scheduled' | 'unsafe' | 'unavailable', missing, revisited, reason? }`
and logs one line. There is no HTTP route and no UI.

When the migration row says `completed`, and some `session` rows have no
`session_v2` twin and `session.time_updated` is later than the completion stamp
on that row, it sets the row to `{"phase":"sessions","cursor":...}`. A v2 delete
leaves the legacy row behind, so a missing twin by itself does not qualify.
The cursor is the largest missing id plus a suffix. OpenCode walks `id < cursor`
in descending id order, and ids are fixed width, so no real id falls between an
id and that cursor. Comparison is SQLite TEXT order, byte by byte. Session ids
encode time in a field that wraps, so id order is not time order.

Hard rules, as this module implements them. The comments record the check
against OpenCode v2.0.8 `packages/core/src/database/v1-migration.bun.ts`, and
the completion stamp against v2.0.16:

- The `migration.v1-v2` row is updated in place. It is never cleared or deleted.
  With no row, OpenCode treats the database as pre-migration and deletes the
  `event` table, v2's durable event log.
- A cursor is not written when a session under it already has v2 activity: a
  message created after completion, a `session_v2.time_updated` after completion,
  or a message `type` other than `user`, `assistant`, `synthetic`, or
  `compaction`. The outcome is `unsafe` with reason
  `revisited-sessions-have-v2-activity`, and one warning names how many sessions
  stay missing.
- Only 1.x activity after the last completed import schedules another import.
  When 1.x was used again, OpenCode's loop still walks every legacy row under
  the cursor, so a deleted session that sorts below a fresh one comes back with
  it.

## Public exports (providers.js)
- `getProviderSources(providerId, workingDirectory)`: Resolves which OpenCode config layers define a provider.
- `upsertProviderConfig(providerId, config, workingDirectory, scope?, options?)`: Validates and writes a custom provider block (`npm`, `name`, `options.baseURL`, `models`, optional `env`/`headers`) into the user/project/custom config layer. The adapter may be OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages. Existing provider, option, and retained-model fields not managed by the form are preserved; omitted models, headers, and env credentials remain explicit removals. Updating a legacy `providers` entry migrates it to the canonical `provider` key. Does not store API keys. Requires `config.env` or `options.hasStoredAuth` (auth already written via OpenCode `auth.set`). Edit flows must pass the provider's effective existing layer (`custom` > `project` > `user`) so updates do not create a global user override.
- `validateCustomProviderConfig(providerId, config, options?)`: Structural validation for custom provider payloads (id format, adapter allowlist `@ai-sdk/openai-compatible`/`@ai-sdk/openai`/`@ai-sdk/anthropic`, http(s) base URL, models, credentials via `env` or `hasStoredAuth`).
- `removeProviderConfig(providerId, workingDirectory, scope?)`: Removes a provider block from the selected config layer.

## Public exports (shared.js)
- `OPENCODE_CONFIG_DIR`, `AGENT_DIR`, `COMMAND_DIR`, `SKILL_DIR`, `CONFIG_FILE`: Path constants rooted at `$XDG_CONFIG_HOME/opencode` when `XDG_CONFIG_HOME` is non-empty, otherwise `~/.config/opencode`. These constants are evaluated when the module loads; no files are migrated. `OPENCODE_CONFIG` remains a separate explicit config-file path and is resolved at call time for the custom config layer; it does not replace the global config directory.
- `AGENT_SCOPE`, `COMMAND_SCOPE`, `SKILL_SCOPE`: Scope constants with USER and PROJECT values.
- `ensureDirs()`: Creates required OpenCode directories.
- `parseMdFile(filePath)`, `writeMdFile(filePath, frontmatter, body)`: Markdown file operations with YAML frontmatter.
- `getConfigPaths(workingDirectory)`, `readConfigLayers(workingDirectory)`, `readConfig(workingDirectory)`: Config file operations with layer merging. OC1 keeps its existing user, project, custom order. OC2 reads both global `opencode.json` and `opencode.jsonc` when present: the JSONC file overrides the primary user file, followed by project and custom. A named entry is edited in its winning file; new user entries still go to the primary file. `readConfigLayers` isolates `INVALID_JSONC` per layer: a broken file is omitted from the merge (`{}` for that layer only), recorded on `layerErrors`, and does not block valid sibling layers. Writes still refuse to overwrite the broken file.
- `readConfigFile(filePath)`: Reads one config file. Missing, whitespace-only, and comment-only files return `{}`; a comment-only file is recognized by `ValueExpected` being the only parse error. A `jsonc-parser` error that produces a partial or non-object tree throws `INVALID_JSONC` — partial parse trees must never be treated as authoritative (avoids rewriting a `$schema`-only stub over a full config). Content that yields no JSON value for any other reason (YAML, plain text) also throws instead of reading as empty.
- `readConfigLayer(filePath)`: Same parse as `readConfigFile`, but isolates `INVALID_JSONC` to `{ config: {}, error }` so plugin/MCP/agent readers can skip one broken layer without aborting valid siblings. Writes still refuse to overwrite the broken file.
- `writeConfig(config, filePath)`: Writes config with automatic backup. Refuses to overwrite an existing non-empty file that fails the same JSONC parse check.
- `getJsonEntrySource(layers, sectionKey, entryName)`: Resolves which config layer provides an entry. A failed custom or user layer throws `INVALID_JSONC` instead of treating that file as empty. A failed project layer is skipped so a valid user/custom entry can still be found.
- `getJsonWriteTarget(layers, preferredScope)`: Determines write target for config updates. Throws `INVALID_JSONC` when the chosen target file is the unparseable layer.
- `getAncestors(startDir, stopDir)`, `findWorktreeRoot(startDir)`: Git worktree helpers.
- `isPromptFileReference(value)`, `resolvePromptFilePath(reference)`, `writePromptFile(filePath, content)`: Prompt file reference handling.
- `walkSkillMdFiles(rootDir)`: Recursively finds all SKILL.md files.
- `addSkillFromMdFile(skillsMap, skillMdPath, scope, source)`: Parses and indexes a skill file.
- `resolveSkillSearchDirectories(workingDirectory)`: Returns skill search path order (config, project, home, custom).
- `listSkillSupportingFiles(skillDir)`, `readSkillSupportingFile(skillDir, relativePath)`, `writeSkillSupportingFile(skillDir, relativePath, content)`, `deleteSkillSupportingFile(skillDir, relativePath)`: Skill supporting file management.

## Public exports (routes.js)
- `registerOpenCodeRoutes(app, dependencies)`: Registers OpenCode-owned HTTP routes and internal module runtime:
  - `GET /api/config/settings`
  - `PUT /api/config/settings`
  - `GET /api/config/opencode-resolution`
  - `POST /api/opencode/upgrade` (enforces the active runtime's upgrade capability, serializes supported OpenCode upgrades, then restarts managed OpenCode so the new binary is active)
  - `GET /api/opencode/upgrade-status` (returns version availability plus the authoritative `upgrade.supported`, `upgrade.manager`, and `upgrade.reason` capability)
  - `POST /api/opencode/directory` (validates and activates an existing project directory; `{ create: true }` explicitly creates the requested project directory before activation, including outside the previously active workspace)
  - `GET /api/provider/:providerId/source` (directory-scoped layer sources and stored provider `config`, with `apiKey` removed; OC1 reads its original user/project/custom layers, OC2 includes the user JSONC override; a runtime switch before reply fails)
  - `PUT /api/provider` (create/update custom OpenAI-compatible provider config in OpenCode user/project/custom layers via `scope`; secrets stay in auth via the OpenCode auth API)
  - `DELETE /api/provider/:providerId/auth`
- Owns lazy auth library loading for provider auth checks/removal.
- Keeps route behavior independent from composition root; `index.js` now supplies dependencies only.

## Public exports (session-runtime.js)
- `createSessionRuntime({ writeSseEvent, getNotificationClients, broadcastEvent?, getOwner? })`: creates runtime-owned state machine and APIs for session status.
- Returned API:
  - `processOpenCodeSsePayload(payload)`
  - `getSessionActivitySnapshot()`
  - `getActiveSessionCount()`
  - `getSessionStateSnapshot()`
  - `getPendingBlockingRequestsSnapshot()`
  - `getSessionAttentionSnapshot()`
  - `getSessionState(sessionId)`
  - `getSessionAttentionState(sessionId)`
  - `markSessionViewed(sessionId, clientId)`
  - `markSessionUnviewed(sessionId, clientId)`
  - `markUserMessageSent(sessionId)`
  - `resetAllSessionActivityToIdle()`
  - `interruptBusySessionsAfterRestart()`: settles every session whose authoritative status is `busy`/`retry` or whose activity phase is still busy, broadcasts `openchamber:session-status` idle plus an OpenCode-shaped `session.error`, resets leftover activity/cooldowns, and returns the interrupted session IDs in stable order.
  - `dispose()`

The optional `getOwner` callback returns a stable opaque snapshot-owner key. Public state reads and writes retire all snapshots and cooldown timers when that key changes. Production composition includes the configured connection revision, backend family/revision, requested selection and last resolved generation/profile. Request epoch changes alone preserve same-owner state so managed restart can report interruption explicitly. A stale cooldown callback cannot emit activity for a replacement owner. Callers without `getOwner` retain a single unscoped owner.

The runtime maintains active-session count incrementally from idempotent activity phase transitions. Upstream stall-timeout and lifecycle health checks read it in O(1); the hourly cleanup removes activity phases older than 24 hours without broadcasting synthetic state transitions. Snapshot generation remains reserved for the session-activity API.

## Public exports (lifecycle.js)
The optional `getBackendSelection` dependency binds lifecycle work to the host's
family/revision snapshot. Production uses the same coordinator as Agent dispatch.
CAgent skips bootstrap and health monitoring; direct OpenCode start, restart,
readiness, agent-presence and config-refresh calls reject with `backend-changed`
before work begins. Await boundaries retire old work before subsequent launch,
credential preparation or readiness commits, including a return to OpenCode at
the same endpoint. A newly spawned instance from retired startup is closed.
Existing owned-process shutdown remains available. Readiness polling also checks
the selection before each detection pass and rejects a stale successful result.
An already issued detection pass can finish under its existing timeout; this is
not immediate HTTP cancellation or CAgent server cancellation. The production
selector and remaining route/UI migrations still precede CAgent activation.
See the [Agent contract](../agent/DOCUMENTATION.md) and its
[Chinese review copy](../../../../../docs/maintenance/zh-CN/CAGENT-DISPATCH-CONTRACTS.md).

- `createOpenCodeLifecycleRuntime(dependencies)`: creates lifecycle runtime for managed/external OpenCode process orchestration. The optional `onOpenCodeRestarted` dependency (default `null`) is fired after a successful managed restart. `index.js` rebinds event-stream readers to the possibly-new port (#2638), then calls `interruptBusySessionsAfterRestart()` and broadcasts one `opencode-restart-interrupted` UI notification when interrupted turns exist (#2943).
- Returned API:
  - `startOpenCode()`
  - `restartOpenCode()`
  - `waitForOpenCodeReady(timeoutMs?, intervalMs?)`
  - `waitForAgentPresence(agentName, timeoutMs?, intervalMs?)`
  - `refreshOpenCodeAfterConfigChange(reason, options?)`
  - `bootstrapOpenCodeAtStartup()`
  - `startHealthMonitoring(healthCheckIntervalMs)`
  - `waitForPortRelease(port, timeoutMs, hostname?)`
  - `killProcessOnPort(port)`

Managed OpenCode launch also merges the environment returned by the agent-tool
runtime and the opt-in system prompt optimizer, each appending its `file://`
entry to the previous one's config. OpenChamber adds no automatic MCP reconnect
loop; recovery after a failed connection is manual for both local and remote
servers. Previously generated reconnect plugin files are inert because managed
launch no longer registers them. User-configured plugins remain user-owned.
PATH and `OPENCODE_SERVER_PASSWORD` remain lifecycle-owned and cannot
be replaced by injected values. External OpenCode processes receive no
OpenChamber tool injection. Managed launch env strips AppImage `ARGV0` before
spawn so zsh-backed OpenCode tools do not rewrite child argv[0] to the AppImage
path (#2588).

Before spawn, `applyProviderEnvAliases` fills unset Google credential aliases
from any present sibling (`GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY`,
`GEMINI_API_KEY`) so a shell that only exports `GEMINI_API_KEY` still satisfies
the Generative AI SDK path used at chat time. Existing non-empty values are
never overwritten.

`createManagedOpenCodeServerProcess` treats a stdout line as the listen line
only when the line starts with `opencode server listening` (OC1) or
`server listening` (OC2 2.0.20), then reads the `on http(s)://...` URL. A line
that merely contains those words later is ignored.

Before that spawn, and only when the probed kernel is OC2, `startOpenCodeOnce`
runs `topUpV1Migration`. See "v1-migration-topup.js" above.

Set `OPENCHAMBER_STARTUP_PERF=1` to emit bounded startup phase records for server listen, managed OpenCode preparation/readiness, and proxy readiness holds. Every OpenCode bootstrap emits one terminal `opencode.bootstrap.ready` or `opencode.bootstrap.error` event, including reused and external server paths. Records contain controlled phase/outcome/route labels and timing values only; they never contain request URLs, runtime keys, directories, session IDs, credentials, or content.

macOS `say` voice enumeration starts concurrently with server composition. The server listener and managed OpenCode startup do not wait for it; `/api/tts/say/status` awaits the same authoritative capability promise when queried before enumeration completes.

Transport-triggered health checks share the periodic monitor's failure accounting interval. Rapid WS reconnect callbacks therefore cannot exhaust the managed-process restart threshold using one cached unhealthy result; an exited managed process still restarts immediately.

A periodic re-probe keeps a live OC1 or OC2 descriptor when detection returns
`unreachable` or `unknown`. `reprobe` leaves that descriptor and its epoch in
place and still returns the raw generation. `probeOpenCodeHealthDetailed`
treats that preserved result as unhealthy. `runHealthCheckCycle` restarts, and
`restartOpenCode` calls `invalidate`, when the managed process has exited or
the consecutive-failure budget is spent. Busy sessions postpone the budget
restart until the two-minute stale guard. A re-probe that identifies a
different generation commits that generation on the same probe.

Managed health failures are classified as `timeout`, `connection_refused`, `connection_reset`, `invalid_response`, or `error`. The lifecycle retains the latest counted failure with a bounded detail string and source. Managed process wrappers continue capturing a sanitized, bounded stderr tail after readiness and retain exit code/signal. Before replacing a managed process, lifecycle snapshots the reason, latest health failure, process diagnostics/aliveness, busy-session count, and timestamp into `lastOpenCodeRestartDiagnostics`; successful startup does not clear this snapshot, and `/health` exposes it for post-restart diagnosis without process environment or credentials.

Every managed OpenCode child is recorded in the shared managed-process registry.
The timestamp is captured before spawn so descendants created during startup are
included. On Windows, shutdown awaits asynchronous tree termination before the
root can be killed separately. A root exit requests registry removal, but removal
requires a successful snapshot with no root or direct descendants. A failed scan
or surviving descendant retains the record. Unix retains its process-group behavior.

On Windows, if the recorded OpenCode root and owner are both gone, the next run
performs a bounded descendant scan. It reaps only newer descendants whose name or
command identifies the MCP/OpenCode chain. Unknown identities and live owners are
left alone. A failed scan or termination retains the record for retry; a command
reporting success is checked against target liveness. Parent cycles are bounded.
Lifecycle registry operations remain injectable. Logs contain bounded PID, owner,
port and outcome fields, never commands, paths, environment values or credentials.

Managed process ownership starts at spawn. The registry and runtime process
handle include children that have not announced readiness yet, so shutdown can
stop an in-flight startup. Readiness timeout, malformed startup output, and
health-probe errors close that child before retrying. Shutdown cancels further
startup attempts. Closing a process is single-flight and unregisters it only
after it exits.

On Windows, managed teardown invokes the existing tree termination command
before terminating the root. Calling `child.kill()` first loses the ancestry
needed to find Git, shell, and MCP descendants. On POSIX, the managed child
starts in its own process group and teardown escalates against that group even
if the root has already exited. A tool ignoring SIGTERM must not survive just
because the server closed its own pipes. The
`lifecycle-process.test.js` regressions launch real parent/child fixtures and
check PID exit plus registry cleanup. macOS results do not validate Windows
ConPTY or Console Window Host behavior.

## Public exports (env-runtime.js)
- `createOpenCodeEnvRuntime(dependencies)`: creates runtime that owns OpenCode CLI environment and binary discovery state.
- OpenCode CLI resolution order is persisted settings, environment overrides, bundled Desktop CLI when available, PATH, known install locations, then platform shell discovery.
- The first non-empty environment override is authoritative, in order `OPENCODE_BINARY`, `OPENCODE_PATH`, `OPENCHAMBER_OPENCODE_PATH`, `OPENCHAMBER_OPENCODE_BIN`. A missing or desktop-application target throws `OPENCODE_BINARY_INVALID` before another alias, bundled CLI or PATH lookup. Managed startup uses the same validator as discovery, including quoted paths. Authenticated settings remain available after this failure. The planned five-mode connection record is not implemented by this repair.
- Automatic bundled resolution under `OPENCHAMBER_RUNTIME=desktop` stays in runtime state and is returned to the managed launch function, including on OpenCode restart. It does not populate `process.env.OPENCODE_BINARY`: AppImage updater relaunch inherits that environment and would mistake the previous bundle path for an explicit override. Explicit settings/env selections and non-desktop or non-bundled resolution retain their existing environment behavior. This prevents future inheritance; it does not reinterpret overrides already inherited from older releases.
- The login-shell snapshot (`$SHELL -lic 'env -0'`) is taken synchronously at import time, so it blocks whatever process embeds the server for as long as the user's shell startup files take. An embedding host that already probed the shell hands its result over before importing the server through `login-shell-env.js` (`provideLoginShellEnvSnapshot(snapshot | null)`); the runtime then uses that and never probes, `null` included. Desktop does this on macOS and Linux; on Windows the server keeps its own registry-based snapshot. The handoff is a module slot, never an environment variable: the snapshot is the user's whole shell environment and `process.env` reaches every child.
- Returned API:
  - `applyLoginShellEnvSnapshot()`
  - `getLoginShellEnvSnapshot()`
  - `ensureOpencodeCliEnv()`
  - `applyOpencodeBinaryFromSettings()`
  - `resolveOpencodeCliPath()`
  - `resolveManagedOpenCodeLaunchSpec(opencodePath)`: resolves the effective managed OpenCode launch target, unwrapping Windows package-manager shims to a direct native binary or explicit runtime+script when possible.
  - `resolveGitBinaryForSpawn()`
  - `resolveWslExecutablePath()`
  - `buildWslExecArgs(execArgs, distroOverride?)`
  - `isExecutable(filePath)`
  - `searchPathFor(binaryName, searchPath?)`: resolves an executable from the supplied PATH value, defaulting to the process PATH.
  - `clearResolvedOpenCodeBinary()`

## Public exports (env-config.js)
- `resolveOpenCodeEnvConfig(options?)`: resolves and validates OpenCode host/port/hostname environment configuration.
- Returned object fields:
  - `configuredOpenCodePort`
  - `configuredOpenCodeHost`
  - `effectivePort`
  - `configuredOpenCodeHostname`

## Public exports (hmr-state-runtime.js)
- `createHmrStateRuntime(dependencies)`: creates runtime for HMR state container initialization and runtime<->HMR state synchronization.
- Returned API:
  - `getOrCreateHmrState()`
  - `ensureUserProvidedOpenCodePassword(hmrState)`
  - `getUserProvidedOpenCodePassword(hmrState)`
  - `resolveOpenCodeAuthFromState({ hmrState, userProvidedOpenCodePassword })`
  - `syncStateFromRuntime(hmrState, runtime)`
  - `restoreRuntimeFromState({ hmrState, userProvidedOpenCodePassword })`

## Public exports (bootstrap-runtime.js)
- `createBootstrapRuntime(dependencies)`: creates runtime for base app route bootstrap and UI auth controller initialization.
- Returned API:
  - `setupBaseRoutes(app, options)`

## Public exports (network-runtime.js)
- `createOpenCodeNetworkRuntime(dependencies)`: creates runtime for OpenCode network and URL concerns.
- Returned API:
  - `waitForReady(url, timeoutMs?)`
  - `normalizeApiPrefix(prefix)`
  - `setDetectedOpenCodeApiPrefix()`
  - `buildOpenCodeUrl(path, prefixOverride?)`
  - `ensureOpenCodeApiPrefix()`
  - `scheduleOpenCodeApiDetection()`

## Public exports (settings-runtime.js)
- `createSettingsRuntime(dependencies)`: creates settings lifecycle runtime for read/migrate/persist concerns.
- Returned API:
  - `readSettingsFromDisk()`
  - `readSettingsFromDiskMigrated()`
  - `writeSettingsToDisk(settings)`
  - `persistSettings(changes)`
- Persistent permission auto-accept policy is stored under `permissionAutoAccept`; execution ownership lives in `lib/permission-auto-accept/`.
- Queued follow-up messages live in `<data-dir>/message-queue.json`, not in settings; execution ownership lives in `lib/message-queue/`.
- Shared sidebar preferences are stored as validated top-level fields: `sidebarProjectDisplayMode`, `sidebarSessionGroupingMode`, `sidebarProjectSortOrder`, and `sidebarShowRecentSection`. Device-local picker selection and sticky-header state do not enter either settings file.
- Two files (`settings-files.js`): `settings.json` holds instance facts and any legacy or unknown keys; `preferences.json` beside it holds every key the generated registry snapshot (`settings-registry.json`) marks `profile`, as `{ version: 1, fields: { key: { value, updatedAt, surfaces? } } }`. Keys the snapshot marks `perSurface` are stored per surface kind: `GET`/`PUT /api/config/settings` read the client's kind from the `surface` query parameter (`settingsSurfaceOf`; the legacy `x-openchamber-surface` header is still honoured, but a header forces a CORS preflight that cross-origin shells and older instances refuse, so clients must not send one) (`web`, `desktop`, `vscode`, `mobile`; anything else means base), `persistSettings(changes, { surface })` writes a changed per-surface key under `surfaces[surface]` and never touches its base, and `readSettingsFromDisk({ surface })` resolves that kind's value first, the base otherwise. Callers without a surface (migrations, the seed, server-side feature writers) read and write the base. `readSettingsFromDisk()` returns the merged document and seeds `preferences.json` once from an existing `settings.json` (which it leaves intact). An existing `preferences.json` that fails to parse is a failure, not an empty profile: it is never seeded or overwritten, the merged read serves the instance part, and `persistSettings` drops profile keys with a warning until the file is fixed or removed. `writeSettingsToDisk(document)` splits by scope and writes `settings.json` as the instance part plus a copy of the profile's base values (`legacySettingsDocumentOf`): a build from before the split reads only that file, so a rollback keeps the user's preferences, while current builds ignore the copy because `preferences.json` wins in the merge; device keys are dropped from writes. Modules that read one profile key off the disk on a hot path use `readMergedSettingsSync`.

## Public exports (settings-files.js)
- `parsePreferencesDocument(raw)`, `serializePreferencesDocument(fields)`, `flattenPreferences(fields)`, `buildPreferencesFields(previousFields, document, now)`, `instancePartOf(document)`, `seedPreferencesFrom(document, now)`, `readMergedSettingsSync({ fs, path, settingsFilePath })`, `getSettingsScope(key)`, `isProfileSettingsKey(key)`, `isDeviceSettingsKey(key)`, `preferencesFilePathFor(settingsFilePath, path)`.
- The VS Code extension host writes the same two files with the same shape (`packages/vscode/src/settings-files.ts`); format changes go to both.

## Public exports (settings-helpers.js)
- `createSettingsHelpers(dependencies)`: creates settings helper runtime for settings request/response shaping.
- Returned API:
  - `normalizePwaAppName(value, fallback?)`
  - `sanitizeSettingsUpdate(payload)`
  - `mergePersistedSettings(current, changes)`
  - `formatSettingsResponse(settings)`

## Public exports (settings-normalization-runtime.js)
- `createSettingsNormalizationRuntime(dependencies)`: creates normalization/sanitization runtime for shared settings and tunnel helper logic.
- Returned API:
  - `normalizeDirectoryPath(value)`
  - `normalizePathForPersistence(value)`
  - `normalizeSettingsPaths(input)`
  - `normalizeTunnelBootstrapTtlMs(value)`
  - `normalizeTunnelSessionTtlMs(value)`
  - `normalizeManagedRemoteTunnelHostname(value)`
  - `normalizeManagedRemoteTunnelPresets(value)`
  - `normalizeManagedRemoteTunnelPresetTokens(value)`
  - `isUnsafeSkillRelativePath(value)`
  - `sanitizeTypographySizesPartial(input)`
  - `normalizeStringArray(input)`
  - `sanitizeModelRefs(input, limit)`
  - `sanitizeSkillCatalogs(input)`
  - `sanitizeProjects(input)`

## Public exports (theme-runtime.js)
- `createThemeRuntime(dependencies)`: creates custom theme runtime for on-disk theme discovery and JSON normalization/validation.
- Returned API:
  - `normalizeThemeJson(raw)`
  - `readCustomThemesFromDisk()`

## Public exports (project-directory-runtime.js)
- `createProjectDirectoryRuntime(dependencies)`: creates runtime for request/project directory candidate normalization and validation.
- Returned API:
  - `resolveDirectoryCandidate(value)`
  - `validateDirectoryPath(candidate)`
  - `resolveProjectDirectory(req)`
  - `resolveOptionalProjectDirectory(req)`

## Public exports (config-entity-routes.js)
- `registerConfigEntityRoutes(app, dependencies)`: registers configuration entity routes:
  - Agents: `/api/config/agents/:name` and `/api/config/agents/:name/config`
  - Commands: `/api/config/commands/:name`
  - MCP servers: `/api/config/mcp` and `/api/config/mcp/:name`
  - Snippets: `/api/config/snippets`, `/api/config/snippets/:name`, and `/api/config/snippets/expand`
- Agent/command/MCP write routes persist config to disk and return a deferred-restart payload (`requiresReload: false`, `requiresRestart: true`, `restartDeferred: true`) instead of restarting OpenCode immediately. The UI accumulates these changes and applies them with `POST /api/config/reload`.

## Public exports (config-mutation-response.js)
- `buildDeferredRestartResponse(message)`: success payload for config mutations that are saved on disk but waiting for an explicit Apply & Restart (`restartDeferred: true`).
- `buildExternalManualRestartResponse(message)`: success payload when OpenCode is an external process and the operator must restart it manually (`requiresManualRestart: true`).

## Public exports (auth-state-runtime.js)
- `createOpenCodeAuthStateRuntime(dependencies)`: creates runtime for managed OpenCode auth password state and request headers.
- Returned API:
  - `getOpenCodeAuthHeaders()`
  - `isOpenCodeConnectionSecure()`
  - `ensureLocalOpenCodeServerPassword(options?)`

## Public exports (core-routes.js)
- `registerServerStatusRoutes(app, dependencies)`: registers status/system endpoints:
  - `GET /health`
  - `POST /api/system/shutdown`
  - `GET /api/system/info`
 - `registerAuthAndAccessRoutes(app, dependencies)`: registers browser auth/session exchange and API access middleware:
   - `GET /auth/session`
   - `POST /auth/session`
   - `GET /auth/passkey/status`
   - `POST /auth/passkey/authenticate/options`
   - `POST /auth/passkey/authenticate/verify`
   - `POST /auth/passkey/register/options`
   - `POST /auth/passkey/register/verify`
   - `GET /api/passkeys`
   - `DELETE /api/passkeys/:id`
   - `POST /api/auth/reset`
   - `GET /connect`
   - `POST /api/system/probe-url`
   - `app.use('/api', ...)` auth/tunnel guard
- `registerSettingsUtilityRoutes(app, dependencies)`: registers small settings utility endpoints:
  - `GET /api/config/themes`
  - `POST /api/config/reload` — applies accumulated deferred OpenCode config changes. Managed OpenCode restarts and returns `requiresReload: true`. External OpenCode returns `requiresManualRestart: true` (changes are already on disk; the connected server must be restarted outside OpenChamber).
- `registerCommonRequestMiddleware(app, dependencies)`: registers shared request middleware stack:
  - conditional JSON body parser behavior for `/api/*` vs non-API requests
  - URL-encoded parser setup
  - request logging middleware

## Public exports (cli-options.js)
- `parseServeCliOptions(options)`: parses serve CLI flags and environment-derived defaults:
  - Port/host/ui-password
  - Tunnel provider/mode/config/token/hostname
  - Legacy `--tunnel` shorthand normalization

## Public exports (cli-entry-runtime.js)
- `runCliEntryIfMain(dependencies)`: detects direct CLI execution and runs server startup with parsed CLI options.

## Public exports (server-utils-runtime.js)
- `createServerUtilsRuntime(dependencies)`: creates server utility runtime for OpenCode orchestration helpers.
- Returned API:
  - `setOpenCodePort(port)`
  - `waitForOpenCodePort(timeoutMs?)`
  - `buildAugmentedPath()`
  - `parseSseDataPayload(block)`
  - `fetchAgentsSnapshot()`
  - `fetchProvidersSnapshot()`
  - `fetchModelsSnapshot()`
  - `setupProxy(app)`

## Public exports (shutdown-runtime.js)
- `createGracefulShutdownRuntime(dependencies)`: creates graceful shutdown runtime for managed OpenCode and web server teardown sequencing.
- After stopping owned runtimes and OpenCode, HTTP shutdown closes active connections as well as the listener. A remaining SSE response must not hold Desktop open until its fallback deadline. Upgraded sockets remain the responsibility of their owning runtime.
- Returned API:
  - `gracefulShutdown(options?)`

## Public exports (server-startup-runtime.js)
- `createServerStartupRuntime(dependencies)`: creates runtime for server bind/startup tunnel and process handler wiring.
- Returned API:
  - `resolveBindHost(host)`
  - `startListeningAndMaybeTunnel(options)`
  - `attachProcessHandlers(options)`

## Public exports (static-routes-runtime.js)
- `createStaticRoutesRuntime(dependencies)`: creates runtime for static dist resolution and static route registration.
- Returned API:
  - `registerStaticRoutes(app)`

## Public exports (feature-routes-runtime.js)
- `createFeatureRoutesRuntime(dependencies)`: creates runtime for main feature route registration orchestration.
- Returned API:
  - `registerRoutes(app, routeDependencies)`

## Public exports (opencode-resolution-runtime.js)
- `createOpenCodeResolutionRuntime(dependencies)`: creates runtime for OpenCode binary/source snapshot resolution.
- Returned API:
  - `getOpenCodeResolutionSnapshot(settings)`: returns configured/resolved OpenCode binary details plus effective managed-launch fields (`launchBinary`, `launchArgs`, `launchWrapperType`) when applicable.

## Public exports (tunnel-wiring-runtime.js)
- `createTunnelWiringRuntime(dependencies)`: creates runtime for tunnel service construction and tunnel route registration.
- Returned API:
  - `initialize(app, initialPort)`

## Public exports (startup-pipeline-runtime.js)
- `createStartupPipelineRuntime(dependencies)`: creates runtime for terminal wiring, proxy/bootstrap scheduling, static route registration, and server startup/listen flow.
- Returned API:
  - `run(options)`

The pipeline binds the OpenChamber listener and publishes its active port
before starting managed OpenCode. The managed custom tool therefore receives
an authoritative loopback callback URL even when OpenChamber binds port `0`.

## Public exports (openchamber-routes.js)
Browser completion checks use `appType=web&updateStatus=true` to stay on the
Desktop Host's native updater. A rejected native restart is retained in the
server process and returned to these polls as `DESKTOP_UPDATE_RESTART_FAILED`;
ordinary availability checks remain usable so a browser reload can offer a
retry. Starting another installation clears the previous restart error.
The shared UI's `lib/web-update.ts` parses install/check responses and waits
for the installed native target version, rather than treating absence of a
newer release as installation success. Poll requests have individual deadlines
within a ten-minute overall deadline.

- `registerOpenChamberRoutes(app, dependencies)`: registers OpenChamber endpoints:
  - `GET /api/openchamber/update-check`
  - `POST /api/openchamber/update-install`
    - Desktop-managed hosts delegate authenticated Web update requests to the Electron main process, which checks, downloads, and applies the update through `electron-updater` before restarting the host.
    - Foreground servers running under a systemd user unit queue installation in
      a separate transient unit and restart the configured service afterwards.
      `OPENCHAMBER_SYSTEMD_UNIT` overrides the default `openchamber.service`.
    - On Windows the install-and-restart script is written to
      `<data dir>/update-install.cmd` before the response and run with
      `cmd.exe /c <file>`. A newline ends a `cmd.exe /c` command line, so the
      same script passed as an argument ran nothing and exited 0; the batch
      file keeps every line. The package-manager line is `call`ed because
      npm, pnpm and yarn are `.cmd` shims that would otherwise end the script,
      the pre-install pause is a loopback `ping` because `timeout` rejects a
      detached child's stdin, and the file deletes itself on its last line
      because the restart command carries the server's flags. If the file
      cannot be written the route answers 500 and the server keeps running.
      The listener is closed before the batch is spawned: on Windows the
      detached child inherits the listening socket and would hold the port
      for the whole batch, so the restart inside it failed with "port already
      in use" and the update ended with no server.
  - `GET /api/openchamber/models-metadata`
  - `GET /api/zen/models`

## Public exports (pwa-manifest-routes.js)
- `registerPwaManifestRoute(app, dependencies)`: registers PWA manifest endpoint with dynamic app-name resolution and recent-session shortcuts:
  - `GET /manifest.webmanifest`
  - Recent sessions use the selected kernel operation, including OC2 cursor pages. The cache is keyed by kernel generation, endpoint and epoch. A failed read leaves the Settings shortcut available and is not cached as an authoritative empty session list.

## Public exports (project-icon-routes.js)
- `registerProjectIconRoutes(app, dependencies)`: registers project icon routes and owns icon storage/discovery flow:
  - `GET /api/projects/:projectId/icon`
  - `PUT /api/projects/:projectId/icon`
  - `DELETE /api/projects/:projectId/icon`
  - `POST /api/projects/:projectId/icon/discover`

## Public exports (skill-routes.js)
- `registerSkillRoutes(app, dependencies)`: registers skills-related routes:
  - Skills config CRUD and metadata under `/api/config/skills*`
  - Skill rename via `PATCH /api/config/skills/:name` with `{ renameTo }` (directory rename preserves `SKILL.md` body and supporting files; restricted to managed skill roots under `.opencode/skills|skill`, `.claude/skills`, and `.agents/skills`)
  - Skill list responses include authoritative `renamable` derived from the same managed-root policy used by rename
  - Discovery calls OC1 `app.skills` or OC2 `skill.list` according to the bound kernel. OC2 responses use the official `location/data` envelope and `path` field. The list keeps local filesystem skills and marks `partial: { source: 'opencode', reason: 'discovery-unavailable' }` when the generation is not ready or OC2 discovery fails; a changed kernel epoch rejects the stale read.
  - Skills catalog listing/source pagination, scan, and install routes
  - Supporting skill file read/write/delete routes
  - Directory resolution prefers an explicit request directory, then soft-falls
    back to the active project / `lastDirectory` so repository-local
    `.agents/skills` and `.opencode/skills` remain discoverable when the client
    omits `directory`. Requests without any project still list user-scoped skills.

## Public exports (proxy.js)
- `registerOpenCodeProxy(app, dependencies)`: registers OpenCode proxy routes and middleware.
- `retireOpenCodeDirectSseStreams()`: aborts and closes direct OpenCode SSE
  responses when the kernel runtime identity changes; the server lifecycle
  calls it before rebinding WS readers.
- Owns:
  - SSE forwarders: `GET /api/global/event`, `GET /api/event`
    - Downstream heartbeats keep clients and intermediaries alive, while a separate upstream-only stall watchdog closes the downstream response when OpenCode stops producing bytes so clients reconnect instead of trusting synthetic heartbeats indefinitely. Each watchdog reset uses the current load-aware timeout, matching the shared event transport.
  - Session message forwarder: `POST /api/session/:sessionId/message`
  - Interactive OAuth forwarder: `POST /api/provider/:providerID/oauth/callback`
    - Upstream blocks inside this call for the whole browser sign-in (device-code polling or a loopback redirect), so it is exempt from the ordinary request deadline and uses a 15-minute proxy timeout instead of `LONG_REQUEST_TIMEOUT_MS`. All other `/api/provider/*` routes, including `oauth/authorize`, keep the ordinary deadline.
  - Generic `/api/*` forwarding with hop-by-hop header filtering
  - Windows `/session` merge fallback path behavior
  - OpenCode readiness gate for proxied `/api` requests
  - Worktree checkout gate before directory-scoped upstream reads and writes

Git bootstrap must reach `git-ready` before OpenCode can cache a new worktree's
project identity or config. Setup scripts may still be running; the optional UI
setup wait remains separate. Failed or timed-out checkout returns 503 without
forwarding. The shared draft creator keeps the project directory selected until
creation returns, because preview paths have no bootstrap state.

This server gate covers web, Electron, hosted mobile, and Capacitor connections.
The VS Code extension owns its separate Git and proxy implementation.

## Public exports (watcher.js)
- `createOpenCodeWatcherRuntime(dependencies)`: creates global event watcher runtime backed by the shared upstream SSE reader.
- Returned API:
  - `start()`
  - `stop()`
- Behavior:
  - Waits for OpenCode readiness before attaching the watcher.
  - In production wiring, subscribes to the shared global message-stream hub instead of opening its own `/global/event` connection.
  - Can still create its own `/global/event` reader when no shared hub is provided, which keeps module tests and isolated reuse simple.
  - Reuses event-stream parsing, `Last-Event-ID`, stall timeout, and reconnect behavior.
  - Forwards unwrapped global event payloads into notification/session side effects.

## Storage and configuration
- Provider auth: `~/.local/share/opencode/auth.json`.
- User config: `$XDG_CONFIG_HOME/opencode/opencode.json`, falling back to `~/.config/opencode/opencode.json` when unset or blank.
- Project config: `<workingDirectory>/.opencode/opencode.json` or `opencode.json`.
- Custom config: `OPENCODE_CONFIG` env var path.
- Rate limit config: `OPENCHAMBER_RATE_LIMIT_MAX_ATTEMPTS`, `OPENCHAMBER_RATE_LIMIT_NO_IP_MAX_ATTEMPTS` env vars.

## Notes for contributors
- This module serves as foundation for OpenCode-related server utilities.
- Route ownership moved to module-level `routes.js`; `index.js` wires dependencies only.
- All file writes include automatic backup before modification.
- Config merging follows priority: custom > project > user.
- UI auth uses scrypt for password hashing with constant-time comparison.
- Tunnel auth treats `host.docker.internal` as local-only when the socket remote IP is private/loopback.

The behavior `GET /api/behavior/agents-md` response includes `path`, the effective
server-side filename, whether or not the file exists. Settings displays this
path without deriving a directory from the browser environment.

## Profile admission

`compatibility.js` owns `detectOpenCodeProfile` and the selection/profile/status constants. The result separates requested selection, resolved descriptor and server versus user-declared version provenance. Legacy admission requires GET-only health, session list/status, pending permissions/questions and command catalog contracts. Explicit version-absent Legacy declarations never probe `/api/info`, and failed authentication cannot be overridden. Admission is distinct from operation acceptance. Production hosts still use generation detection until selection persistence and capability dispatch are adopted together. Web and Electron share this owner; VS Code must adopt the same contract; hosted and Capacitor mobile inherit their selected host. The isolated executable harness consumes the admission helper now.

## Selection persistence and runtime adoption

settings-helpers.js accepts only the shared selection enum. Its existing merge preserves a valid saved choice when an update omits or rejects that key. settings-runtime.js stores the choice in instance settings.json, separately from profile preferences and the runtime descriptor.

createKernelRuntime accepts an optional getRequestedSelection dependency. A null selection preserves the existing generation detector; a configured selection uses profile admission. Selection changes retire in-flight probes even at the same URL. getAdmission() returns the current diagnostics after checking identity. Admission failures retract the ready descriptor except temporary unreachability, which retains the existing health-monitoring behavior. Production now supplies the requested selection alongside capability dispatch and host adoption; a stored choice alone does not establish operation acceptance. See the [paired INT-01 checkpoint](../../../../../docs/maintenance/OPENCODE-INTEGRATION-MILESTONES.md#int-01-implementation-checkpoint).

Kernel operations preserve profile in captured contexts and reject late results after a profile-only change. `legacy-contract.js` owns the finite read-operation constants and admission set. Legacy requires OC1 and an admitted operation before headers or SDK construction. Session, message/history, children/status, pending permission/question, command and selection-catalog reads use the existing OC1 SDK and projections. Identity capture is available for ownership checks. OC2-only default-model lookup remains refused. The original read foundation is recorded in `artifacts/int03-exact-host-read.json`. Current finite conversation admission and its remaining R2 gates are described under Exact Legacy minimum host writes below.

Proxy forwarding checks the exact Legacy version and finite HTTP admission before prefix/readiness work and after asynchronous middleware. OAuth and advanced operations remain unavailable. Routes owned by OpenChamber and registered before the proxy retain their own admission rules. Direct SSE captured identity includes profile. Configuration and autonomous caller coverage retain their later acceptance gates.

The existing family guard optionally reads the owning kernel descriptor and refuses unaccepted Legacy configuration before route work. Config entity, plugin, Skill and Provider routes supply that descriptor; CAgent rejection still happens first. OpenChamber settings/snippets and runtime/resolution/health/version diagnostics remain usable independently of operation admission. Provider and plugin mutation identities and Skill response identities include profile. Config-entity and Skill routes capture runtime/backend identity before directory waits and return 409 before disk access when it changes. Skill fallback preserves that rejection; supporting-file writers recheck after SDK discovery. Snippets remain independent. Skill repository installs pass the captured-identity check into the installer and discard prepared copies after an owner change, returning HTTP 409 with earlier committed entries. Before production activation, complete the remaining credential/autonomous direct-call audit. VS Code local configuration remains a separate host responsibility.

Credential profile preparation: auth.js refuses unaccepted Legacy access before credential filesystem/API work, including generation queries used by quota refresh writers. Late OC2 reads compare profile as well as generation, endpoint and epoch. auth-v2.js also keys concurrent requests by profile. Web/Electron and the VS Code shared reader consume these modules; VS Code standalone file writers still require their own host guard before production profile activation.

KernelIdentity includes the optional profile. captureIdentity, result envelopes and prepareSession use one identity projection; requests with a different or missing profile reject before transport when the active identity has a profile. OC2 metadata-write sequencing also includes generation/profile. Generation-only hosts retain their previous identity shape until production profile activation.

## Confirmed connection record (INT-02 host checkpoint)

Production Web and the in-process Electron backend require the instance setting `opencodeConnection`: version 1, confirmed true, and exactly one mode. External owns an HTTP(S) endpoint; command owns an absolute executable, complete server argument vector, absolute cwd and optional environment name/reference pairs; path searches the backend PATH; configured owns an absolute CLI executable; bundled resolves only the packaged CLI. Native CLI modes use the controlled serve invocation. Command owns its configuration and skips native CLI generation probing and managed-config injection. Environment references resolve in the host and values are never persisted in this record. Server authentication and PATH remain host-owned. The backend PATH keeps precedence when login-shell entries are added.

Legacy environment and binary settings are candidates, not confirmation. An absent, malformed or unavailable record leaves the authenticated settings API reachable and launches no fallback process. PUT /api/config/settings parses JSON at the route boundary and validates the record before persistence. Changed records save the previous instance document to settings.opencode-previous.json; a failed settings write restores the instance document. The existing strict preferences reader remains responsible for profile recovery. Identical records are inert; changed records return 409 while ready, owned or transitioning. After a changed cold record is durable, POST /api/config/reload bootstraps that confirmed connection in the same host. External recovery probes only its endpoint, and shutdown preserves the external process. Owned launches require observed process exit before another launch can proceed. Connection revision retires stale startup resolution before spawn.

The shared connection editor supports explicit cold confirmation and recovery. Saved-record restart now validates the complete target before retiring the live owner, joins duplicate restarts, hides the retired endpoint, and observes owned-child exit before replacement. Failed validation preserves the old live connection; failed cleanup retains ownership and blocks launch until an explicit retry succeeds. Failure after retirement remains visible. A retired selection closes a newly launched owned replacement. External processes are never closed. Hosted and native mobile observe their configured host; VS Code still owns its separate connection manager and has no editor/adoption for this record. Keep these migration and runtime gates open before release. Read the paired INT-02 milestone checkpoint for actual acceptance and remaining work.

### Confirmed settings transaction

The existing lifecycle owner accepts an internal replacement through restartOpenCode(reason, { resolve, beforeRetire, commit }). Resolve validates and returns the prepared candidate before queue pause or retirement. After drain and observed owned-child exit, commit saves the confirmed record and returns the exact backend selection committed by the settings owner. Only connectionRevision may change; family/revision retirement or a stale returned selection prevents bootstrap. Startup uses that prepared candidate instead of resolving the old saved target again. Conflicting replacement submissions return 409. Validation failure preserves the live owner; cleanup failure keeps ownership; persistence or startup failure remains visibly failed. An explicit subsequent transaction can return to the saved prior target. External processes remain unowned.

The lifecycle contract is internal. Generic active-record writes still return 409. The authenticated host confirmation API below owns the settings permission and decisions. Shared editor confirmation/recovery, peer coordination and VS Code adoption remain required before R1 acceptance. Web, Electron, hosted mobile and Capacitor share this host owner; VS Code keeps its existing unsupported boundary. The [Chinese archive](../../../../../docs/maintenance/zh-CN/QUEUE-CONNECTION-DRAIN.md#确认配置提交事务) records the same contract.

## Readonly connection migration discovery

GET /api/config/opencode-connection is an authenticated, no-store host settings route. It remains readable without kernel admission. It reads the strict instance document and host environment at call time, then uses only filesystem resolution for PATH, bundle and imported binary candidates. It does not use the old mutating CLI-resolution snapshot, launch/version probes, port scans, writes or retries. A failed authoritative read returns 503 settings_unavailable; a host without this capability returns 501 unsupported_runtime.

A valid saved record suppresses legacy prefill. Otherwise each old OPENCODE_HOST, binary environment alias and opencodeBinary setting has its own source/key and normalized candidate. Candidate records have confirmed false and cannot pass the save parser. Matching records retain all provenance without conflict; distinct records require visible conflict resolution. Invalid inputs omit raw values, including credential-bearing endpoint strings. An unavailable candidate remains visible without substituting another mode. Both skip-start aliases without an endpoint are setup errors. With no saved choice, input or error, an available bundle is recommended without enabling it. Availability means filesystem availability or a mode requiring user input, not protocol or server readiness. Readiness still belongs to the existing confirmed startup path.

Web and Electron own these machine values. Hosted and Capacitor mobile observe their chosen host. VS Code returns 501 for the route and for HTTP connection-record writes; its native settings gate also rejects any write containing this unsupported setting before returning fields for persistence. This is a temporary boundary until the extension connection manager adopts the INT-02 contract. The editor and cold confirmation journey are implemented. Public active-record replacement remains gated until busy work, queued dispatch, pending approvals and peer-client confirmation are supported; its settings write still returns 409. Serial restart of the already saved target does not complete that migration.


### Saved-target queue drain

Confirmed saved-target restart now pauses and drains the owning message queue after target validation, before endpoint invalidation or owned-child cleanup. A drain timeout or persistence failure leaves the old process and readiness intact. The queue resumes after restart finishes or fails. Read the [queue contract](../message-queue/DOCUMENTATION.md#saved-target-restart-boundary) and its [Chinese archive](../../../../../docs/maintenance/zh-CN/QUEUE-CONNECTION-DRAIN.md). Active-record writes remain gated; this does not authorize busy-session interruption or queue migration to another connection.

### Activity inspection before active replacement

GET /api/config/opencode-connection/activity returns authenticated, uncached
inspection evidence. connection-activity.js owns aggregation; the host composes
the current working directory, strict configured projects and queue directories.
It uses kernel-operations.js rather than the event caches, which have no complete
initial permission/question snapshot. OC1 question.list and OC2 form.list retain
their SDK transport, directory, auth and abort behavior. The projected input
records contain only request/session IDs, not questions, answers or form fields.

The response reports active/inactive/transitioning host state, scope, busy,
permissions, questions, queue and clients. Busy reads are global on OC2 and
directory-scoped on OC1. Permission and input coverage is limited to the listed
directories. Known counts are unique request/session IDs within that coverage.
An empty directory set or a failed category/scope produces unknown with an
observedCount, a lower bound from successful reads. Other complete categories
remain available. Inactive/transitioning hosts leave upstream categories unknown.
Clients always remain unknown until client identity and coordination are owned;
event subscriptions do not establish a count of other users or tabs.

When a queue owner is supplied, the queue count is its loaded in-memory projection, including
its revision and entered sends, not proof of durable target ownership. Passing
queue: null explicitly means this host cannot observe client queues. The report
then contains unknown/observedCount 0, with no count, sending or revision fields.
An authoritative queue read failure still fails inspection; it never selects
the unknown branch as a successful fallback. Queue
loading retains its existing recovery behavior. A queue/settings read failure
returns 503 activity_unavailable. Kernel retirement, transition/readiness changes
or queue revision changes reject with 409 activity_changed. Unsupported profiles
or runtimes return 501 unsupported_runtime. Responses omit endpoints, credentials,
queued text and input payloads. The read does not start, stop or replace a target.

Web and Electron share the host route. Hosted and Capacitor mobile inspect their
selected host. VS Code composes the same inspection owner in its dedicated
connection bridge and passes no queue owner. Its client queues remain unknown.
This snapshot is not an authorization token and is not an atomic upstream
transaction. Generic active connection-record writes remain 409. The host confirmation owner below uses a fresh inspection after queue drain; the shared confirmation UI and peer coordination remain pending. Queue intent now retains its original configured target. See the [Chinese archive](../../../../../docs/maintenance/zh-CN/CONNECTION-ACTIVITY.md).

## Host connection confirmation

POST /api/config/opencode-connection/prepare accepts either { source: "candidate", connection } or { source: "previous" }. connection-switch.js parses and validates the selected record without writing, stores one pending candidate, and returns { token, connection, activity }. The token is bound to backend selection, connection revision and descriptor identity. It contains no resolved environment values. Preparing another candidate replaces the previous token.

POST /api/config/opencode-connection/apply requires { token, decision: "wait" | "stop", acknowledgeClients: true }. Clients remain unknown; the acknowledgment does not claim a measured count. After queue drain, before retirement, the owner rechecks saved configuration and activity. Wait returns 409 unless a ready upstream reports authoritative idle sessions, permissions and questions. Stop explicitly permits managed-process retirement. For an external target, connection-activity.js interrupts busy sessions through the selected SDK and rechecks status; unknown activity, failed reads or unsettled interruption preserve the old connection. External processes are never killed. Queue intent retains its original configured target.

Only the trusted host owner passes the private settings permit after observed owned-process exit. JSON requests cannot grant that permit. Invalid preparation and refused fresh activity preserve readiness; failure after retirement leaves a failed selected target without automatic fallback. Startup failure returns 503 connection_failed. Successful confirmation consumes its token; stale confirmation returns 409 connection_changed. GET /api/config/opencode-connection/previous returns { connection } from the prior settings backup. Recovery requires prepare with source previous and the same apply confirmation.

All three routes require host authentication, use no-store and register before the upstream proxy. Web and Electron share this owner; hosted and Capacitor mobile call their chosen host. VS Code returns 501 for the whole connection-route subtree before proxying. CAgent cannot enter the OpenCode confirmation owner. The existing shared editor has not adopted these active confirmation/recovery routes yet. This API checkpoint does not complete R1. See the [Chinese archive](../../../../../docs/maintenance/zh-CN/CONNECTION-ACTIVITY.md#宿主连接确认).


### Read-only connection test

POST /api/config/opencode-connection/test accepts a UUID token and a candidate connection record. Testing never saves settings, starts a process, replaces the active connection or rebinds the SDK. Managed modes validate launch inputs only; success does not prove startup or readiness. External mode probes profile admission using the saved compatibility selection; success does not prove feature coverage. Credentials are reused only for the exact active endpoint, and probes do not follow redirects.

The host cancels tests after 15 seconds. POST /api/config/opencode-connection/test/cancel accepts the original token. Cancel, unmount and runtime retirement discard the UI result; duplicate tokens and retired owners are rejected. Web and Electron share the host owner. Hosted and Capacitor mobile test their chosen host. VS Code composes the same owner through its dedicated connection bridge, including cancellation on the original bridge.

### Exact Legacy minimum host writes

The Legacy operation allowlist now admits create/update, async prompt, stop,
permission reply and question reply/rejection. Unaccepted operations still refuse
before transport. The supplementary metadata owner and failure semantics are in
[session routes](../openchamber-sessions/DOCUMENTATION.md#legacy-1227-supplementary-metadata).
The exact executable host journey is recorded in `artifacts/int03-exact-host-write.json`.
That exact-executable write evidence does not establish shared UI or VS Code acceptance.

`legacy-session-http.js` owns the SDK-shaped create/update boundary and supplementary metadata projection. Production composition shares one metadata store with `kernelOperations`. The bridge registers after readiness and worktree gates, before generic proxy forwarding. Strict body/query parsing refuses unsupported fields before effects; the kernel preserves OC1 permission/workspace create fields and keeps metadata off the Legacy wire. Session list, experimental list and detail reads restore the host supplement without another upstream request. Identity and storage-scope checks retire delayed results. Failed multi-step writes report partial state and the created ID when cleanup cannot complete.

The shared client admits only the exact 1.2.27 conversation operation set. The host independently enforces finite HTTP admission. `client.legacy-host.test.js` exercises the real shared SDK client through Express, proxy, kernel and a loopback fixture, including upstream auth, attachments, decisions, stop, metadata round-trip and advanced-operation refusal. It does not exercise browser rendering, the full OpenChamber auth gate, the exact executable or VS Code. See `artifacts/int03-conversation-http-checkpoint.json` for this implementation checkpoint; R2 remains open for those integrated journeys.
