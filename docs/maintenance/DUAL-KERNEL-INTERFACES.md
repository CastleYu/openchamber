# OC1 / OC2 OpenChamber interface inventory

## Scope and evidence

Pinned trees: personal OC1 `4ac81115c17c203c89c5b52f93a930af32ea2163` (`.worktrees/dual-kernel-20260926`), official OpenChamber v2.0.1 `63bd5070c8620432817e1e67de77791f801bcf3e` (`.worktrees/upstream-v2-20260926`). `@opencode-ai/sdk/v2` in the former is an **OC1 SDK namespace**. “OC2” below means OpenCode 2.x protocol, consumed by official OpenChamber v2.0.1, whose minimum is OpenCode 2.0.15 (`packages/web/server/lib/opencode/compatibility.js:11-14`).

Boundary: interfaces **actually consumed by these two OpenChamber trees** under `packages/`: SDK calls, direct OpenCode HTTP/SSE, wire events, config files/plugin hooks, and VS Code forwarding. This is not a census of every upstream OpenCode API. `interface-inventory-extract.py` scanned tracked non-test TypeScript/JavaScript files in both trees (OC1 1,890 files; OC2 1,935), producing `interface-inventory-raw.json` and `interface-inventory-mechanical.md`. Raw hits are deliberately overinclusive: route strings include OpenChamber-owned routes, event-looking strings include domain events/config names, and broadened SDK alias matching also catches ordinary `.session.map` or `.model.trim` calls. Dynamic routes and multiline calls require manual review. Counts (OC1/OC2): SDK-shaped 175/128, route 995/996, event 394/607, SDK imports 187/32. These are **occurrences**, not API counts. Code reading below separates OpenCode from OpenChamber ownership.

The 43 interface rows are an implementation and acceptance ledger, not a claim
that every row has passed live testing. Isolated conversations passed against
OpenCode 1.18.32 and 2.0.16 for core catalog, prompt, stream, persistence,
interrupt and cleanup behavior. See `DUAL-KERNEL-ADOPTION.md` for the exact
profiles and remaining gates. Focused fixtures, source mappings and real-runtime
results remain separate evidence types.

Classification key: **changed** means the user capability existed in OC1 but the wire contract or lifecycle changed; **moved** gives the OC2 destination; **added API** is a new OC2 primitive and does not alone establish a new user feature; **removed** means the old upstream API has no matching OC2 primitive; **local** means OpenChamber owns the endpoint on both sides. **Unchanged** requires matching request/response/event semantics, not merely a spelling match. One source-backed unchanged bridge behavior is `x-opencode-directory` plus optional URI decoding: both proxy copies implement the same decode and forwarded header logic (`proxy.js:133-147,929-938` OC1; `:133-147,982-991` OC2). This is an OpenChamber transport contract; individual OpenCode method semantics still need wire comparison. Shared names such as `session.list`, `session.get`, `session.create`, `permission.reply`, `mcp.connect`, `command.list`, `session.status`, and `message.updated` are not counted unchanged merely by name.

## Shared UI SDK call map

Primary call sites: OC1 `packages/ui/src/lib/opencode/client.ts:541-1694`; OC2 `packages/ui/src/lib/opencode/client.ts:664-1867`. OC2 projects records through `projection.ts`, events through `events.ts`, and UI state through `model.ts`; OC1 uses SDK wire types directly at more consumers. Each row is an implementation task, not a claim of tested parity.

| OC1 consumed call / intent | OC2 consumed destination | Class and required OC1 behavior |
|---|---|---|
| UI-01 `path.get`, `project.current` | `location.get`, `project.list`, `vcs.get` | Moved/changed. Keep OC1 directory/project identity path; project list, location, VCS are distinct OC2 records. |
| UI-02 `session.list` (directory-scoped array), `session.get`, `session.create`, `session.update`, `session.delete` | same names except `delete`→`remove`; list cursor paging, new session/project/metadata records | Changed/moved. Preserve OC1 list and mutation shapes, title/archive behavior. OC2 `session.list` is paged (`client.ts:777-805`). |
| UI-03 `session.messages` | `message.list` plus `session.message.get` | Moved/changed. OC2 messages carry inline parts; cursor/replay and message identity need projection (`client.ts:867-884`). |
| UI-04 `session.promptAsync` | `session.prompt` | Changed. OC1 async 204 acceptance + SSE completion; OC2 prompt request and event lifecycle differ (`client.ts:981`, `client.ts:1109`). Keep OC1 completion logic. |
| UI-05 `session.command`, `session.shell` | same names | Changed. Compare request body, ID, output and completion events; preserve OC1 behavior. |
| UI-06 `session.abort` | `session.interrupt` | Moved/changed. Validate stop semantics and error/idle transitions. |
| UI-07 `session.revert`, `session.unrevert` | `session.revert.stage/commit/clear` | Moved/changed. Map OC1 single-step revert/unrevert to legacy path; OC2 staged workflow and related events are separate. |
| UI-08 `session.summarize` | `session.compact` | Moved/changed; retain OC1 compaction request/results. |
| UI-09 `session.fork` | `session.fork` | Changed until before-message selection and response shape verified. Do not label fork an OC2-only feature. |
| UI-10 `session.todo` | no same-name OC2 call in UI client | OC2 UI call absent; upstream removal **unconfirmed** until full SDK/server schema comparison. Locate current todo derivation and preserve OC1 todo read. |
| UI-11 `session.status` | `session.active` plus live `session.status`/execution events | Moved/changed. OC1 directory status map vs OC2 global active set; recover after reconnect without turning fetch errors into empty status. |
| UI-12 `permission.reply`, `permission.list`, `v2.session.permission.create` | `permission.reply/get/create`, `permission.request.list` | Changed. OC1 permission request/effect/source shapes and pending list must remain; OC2 request IDs/rules differ (`client.ts:1372-1450`). |
| UI-13 `question.reply/reject/list` | `session.form.reply/cancel`, `form.list` | Moved/changed. Existing OC1 question UX stays available; OC2 form contract and answer validation are distinct (`client.ts:1461-1476`). Do not call forms wholly OC2-only. |
| UI-14 `config.update`, `config.providers`, `config.get`, `v2.model.list`, `app.agents`, `command.list`, `app.skills` | `config.get`, `provider.list`, `model.list/default`, `agent.list`, `command.list`, `skill.list` | Changed/moved. Keep OC1 config writes and provider/model/agent/skill projections. `config.update` has no matching UI-client v2 write; server config ownership replaces it. |
| UI-15 `mcp.status/connect/disconnect`, `tool.ids` | `mcp.list/connect/disconnect`; no `tool.ids` peer in UI wrapper | Changed/removed API. Keep OC1 MCP status/tool discovery behavior; OC2 MCP result/config semantics differ. |
| UI-16 OC1 direct `experimental.controlPlane.moveSession`, `find.files`; older model/agent selection and diff flows | `session.move`, `session.switchModel`, `session.switchAgent`, `session.synthetic`, `session.generate`, `session.diff`, `generate.text`, `file.find` | Moved plus added APIs. `session.move` and `file.find` have old direct SDK counterparts (`sync/session-actions.ts:382`, `client.ts:1909`). Check every other API against OC1 product flow before treating it as a genuinely new feature. |
| UI-17 direct `sdk.global.config.get`, `sdk.lsp.status`, `sdk.vcs.get` | `config.get`, projected `vcs.get`; LSP status destination needs tracing | Mixed moved/undetermined. These bypass the OC1 wrapper (`sync/bootstrap.ts:66,204` and `sdk.vcs.get` in raw ledger); include them in bootstrap contract. |
| UI-18 direct `provider.auth/list/oauth.authorize/oauth.callback`, `auth.set` | OC2 provider/auth OpenChamber route or SDK path needs field mapping | Changed. Old provider settings and OAuth UI make direct SDK calls (`ProvidersPage.tsx:225,477-512`, `ProviderOAuthMethods.tsx:108,148`). Carry auth ownership and callback semantics into both runtimes. |
| UI-19 OC1 direct SDK `session.list/get/messages` and `global.event` in sync/multi-run/global sessions; VS Code/server direct SDK calls | OC2 `session.list/get`, `message.list`, `event.subscribe` and server SDK | Changed. Wrapper-only inventory misses bootstrap, child-store recovery, queue/routing and VS Code Git/session watcher. See raw occurrence ledger and audited direct consumers. |
| UI-20 OC1 stats computed from message/session data | OC2 `session.stats` | Added API, existing statistics UX. OC2 direct call `lib/opencode/session-stats.ts:98`; retain OC1 computation rather than disable statistics. |

Also compare SDK direct consumers outside the wrapper; raw JSON records `client.*` hits across web/VS Code. `client.global.event` in OC1 goes to `client.event.subscribe` in OC2; this is a transport migration, not an unchanged subscription.

## Direct HTTP and server-owned workflows

| OC1 consumption | OC2 destination | Class / owner |
|---|---|---|
| HTTP-01 `/global/health` | `/api/info` | Moved/changed readiness. Web `opencode/routes.js:93`→`:165-227`, VS Code `opencode.ts:640-641`→`:647-650`; OC2 minimum/version check added. |
| HTTP-02 `/agent` during warmup | `/api/agent` | Path moved; compare response/warmup behavior (`opencode/lifecycle.js:1013`→`:1038`). |
| HTTP-03 `/session/status` warmup/queue activity | `/api/session?directory=…&limit=1` and `/api/session/active` | Changed. OC2 active is global, session list paged (`lifecycle.js:1190`→`:1235`; queue runtime below). |
| HTTP-04 `/session` for PWA recent session | `/api/session` cursor list | Changed (`pwa-manifest-routes.js:104` both). |
| HTTP-05 `/global/event` and directory `/event` | one `/api/event` global stream | Moved/changed. Web watcher `watcher.js:68`→`:75`, VS Code `sseProxy.ts:47-68`→`:47-58`; OC2 proxy retains `/api/global/event` as a temporary alias (`proxy.js:941-950`), not a distinct upstream stream. |
| HTTP-06 `/session/:id/message`, `/session/:id/command`, `/session/:id/prompt_async`, `/session/status` in queue runtime | `/api/session/:id/message`, `/api/session/:id/command`, `/api/session/:id/prompt`, `/api/session/active`; plus `/api/session/:id/{model,agent,synthetic}`, `/api/command` | Changed/added API; queue is an **existing OC1 feature**. Map queue lifecycle, IDs and delivery. Evidence `packages/web/server/lib/message-queue/runtime.js:393-526`→`:418-557`. |
| HTTP-07 `/session/:id/prompt_async` in scheduled tasks | OC2 SDK through origin based on `/api/info` | Changed backend, **existing OC1 scheduled task feature** (`scheduled-tasks/runtime.js:494`→`:267-269`). |
| HTTP-08 `/global/upgrade` | OpenChamber upgrade policy/CLI, no OC2 equivalent direct route in `opencode/routes.js` | Removed upstream route; retain OC1 upgrade ownership and explicitly choose OC2 policy (`routes.js:275` old; OC2 `upgrade-capability.js`). |
| HTTP-09 `/mcp/:name/auth/callback`, provider OAuth callback | OC2 `/api/*` forwarding and OAuth flow | Changed; examine route timeout/auth before adapter. Old callback construction at `opencode/routes.js:572`; OC2 generic proxy and route handling. |
| HTTP-10 Session archive/read overlay, OpenChamber settings/config entity routes (`/api/config/*`, `/api/provider/*`, `/api/projects/*`) | Same OpenChamber-owned route families but different config persistence and OC2 archive store | **Local routes, changed implementation**, not upstream OpenCode API. OC1 proxy `proxy.js:813-898`; OC2 proxy `proxy.js:303-384,897-928`. Keep OC1 data semantics, including archive and project/worktree behavior. |
| HTTP-11 OC1 `session.update` writes session metadata through `PATCH /session/{id}` | OC2 `PATCH /api/session/{id}` with metadata | Changed route/schema, existing capability. OC1 baseline `session-goal/runtime.js` and SDK1 session.update already write OpenCode-held metadata. OC2 adds merge-then-PATCH coordination in `openchamber-sessions/session-metadata-store.js`; its legacy JSON migration applies to older OC2 state, not OC1 storage. |

Generic proxy path mapping is particularly important: OC1 browser `/api/*` strips the OpenChamber prefix to upstream `/*`; OC2 `/api/*` is already OpenCode's own prefix. Blindly preserving the OC2 proxy against OC1 sends the wrong path. Evidence OC1/OC2 `packages/web/server/lib/opencode/proxy.js:895-898`→`:941-950`, and `opencode-v2` skill. Compare auth/header/body/abort forwarding for both paths.

## Wire event vocabulary consumed by UI and server

OC1 reducer `packages/ui/src/sync/event-reducer.ts:247-569` and recovery `directory-recovery-snapshots.ts:36-121`; OC2 translator `packages/ui/src/lib/opencode/events.ts:220-833`, with consumption metadata at `:886-927`; OC2 web server translates v2 through `packages/web/server/lib/event-stream/translate-v2.js` before existing notification/session side effects (`opencode/DOCUMENTATION.md:890-897`). The event mapper must keep the OC1 reducer's old vocabulary path available.

| OC1 consumed event(s) | OC2 source/destination | Class |
|---|---|---|
| EV-01 `session.created/updated/deleted`, `session.status/idle/error` | `session.created`, `session.patched`, `session.deleted`, `session.execution.*`, `session.status/idle` | Changed; same names are not proof of same payload. |
| EV-02 `message.updated/removed`, `message.part.updated/delta/removed` | `session.text.*`, `session.reasoning.*`, `session.tool.*`, `session.step.*`, `message.patched/parts.replaced/tool.transition`, plus some retained `message.*` | Changed/moved. Parts, tool state, streaming and synthetic records must project to domain model; OC1 stream stays old. |
| EV-03 `permission.asked/replied` | same labels plus `permission.request.list` snapshot | Changed request/effect/rules and recovery. |
| EV-04 `question.asked/replied/rejected` | `form.created/replied/cancelled/settled` | Moved; old OC1 question flows remain. |
| EV-05 `session.diff`, `todo.updated`, `vcs.branch.updated`, `project.updated` | OC2 diff/usage/session/project events and local derivation | Mixed. Each consumer needs mapping or explicit local source; absence of a same-name OC2 event is not feature deletion. |
| EV-06 `server.connected`, `installation.update-available` | same names | Candidate unchanged **labels only**; verify envelope/sequence/replay before marking semantics unchanged. |
| EV-07 no OC1 source | `session.inbox.*`, `session.compaction.*`, `session.retry.scheduled`, `session.skill.activated`, `session.usage.updated`, `mcp.resources.changed`, `websearch.updated` | Added event vocabulary. Feature gate according to actual OC1 product baseline, not event novelty. |

## Config, plugin, auth and VS Code contracts

| OC1 | OC2 | Class / task |
|---|---|---|
| CFG-01 `config.json` fallback, legacy `provider`, `plugin`, permissions map, model string; `OPENCODE_CONFIG_CONTENT` managed plugin injection | `opencode.json(c)`, canonical `providers`, `plugins`, rules array, model+variant, watched `OPENCODE_CONFIG=<data-dir>/opencode.managed.json` | Changed. Maintain two isolated config readers/writers, schema transforms and apply semantics. OC2 `config-v2.js:24` explicitly maps `providers` (v2) to `provider` (v1). OC1 `shared.js:16,152-159`, `managed-plugin-config.js:24-27`; OC2 `shared.js:20,165-171`, `managed-config-file.js:56-115`. |
| CFG-02 OC1 agent/command/MCP mutations return deferred restart and `POST /api/config/reload` applies | OC2 watched config changes apply live; restart only for binary/port/external or fallback user-owned config | Changed existing settings capability. Evidence OC1 `opencode/DOCUMENTATION.md:325-329,362-363`; OC2 `DOCUMENTATION.md:899-945`. |
| CFG-03 OC1 `auth.json` credential read/write assumptions | OC2 SQLite `credential` read-only plus legacy auth fallback | Changed. Keep OC1 auth path and avoid OC2 DB access/write assumptions (`opencode/DOCUMENTATION.md:897-901`). |
| CFG-04 OC1 generated plugin file conventions and `tool`/hook context | OC2 plugin **directory** with `package.json`, default export `{ id, setup }`; result title via metadata, output schema requirement, no `context.directory`/`abort` | Changed. Maintain separate generated plugin materialization and callback context; OC2 details `opencode/DOCUMENTATION.md:43-58`. This affects agent tools, prompt optimizer, MCP/skill integrations. |
| CFG-05 VS Code old readiness `/global/health`, old bridge/SSE route path | VS Code `/api/info`, `/api/event`, generic OC2 bridge; explicit 1.x rejection | Changed. Add runtime-selected bridge and separate managed binary/version acceptance. OC1 `vscode/src/opencode.ts:640-641`, `sseProxy.ts:47-68`; OC2 `opencode.ts:647-676`, `sseProxy.ts:47-58`. |

## Task tree for dual runtime delivery

1. **Freeze and verify the classification.** Generate a canonical manifest from the raw extractor; add method, route, event, request/response fields, origin and consumer file to every OpenCode-facing hit. Review all dynamic URL construction, aliases, SDK direct calls and plugin hooks by hand. Match OC1 feature baseline before designating OC2-only features. Mark entries as unchanged only after wire fixture comparison.
2. **Select runtime before any I/O.** Probe OC1 `/global/health` and OC2 `/api/info` without mutating the server; expose a single runtime kind/capability object to web, Electron and VS Code. Validate against the OC1 runtime currently available to the maintainer; defer the separate 1.2.27-specific gate. Reject unknown responses rather than guessing.
3. **Build two OpenCode adapters behind one domain contract.** OC1 adapter retains old SDK/paths/status/errors; OC2 adapter retains `@opencode/client` and projection. Cover session/project/message/prompt/command/shell/revert/compact/fork, permissions/questions-or-forms, config/catalog/MCP/skills and supported advanced calls. Put new-only primitive gates at the domain boundary, not scattered UI checks.
4. **Split server/proxy/realtime ownership by runtime.** Route `/api/*`→OC1 `/*` versus OC2 `/api/*`, choose correct health, SSE, OAuth and long-running message forwarding. Project old/new events to a common reducer vocabulary; keep reconnect snapshots, ordering, partial failures and live status authoritative. Adapt queue, scheduled tasks, assist, goal, knowledge and notifications that call OpenCode directly.
5. **Separate persistent state and managed plugins.** Keep OC1 config/auth/plugin files and deferred apply. Keep OC2 JSON/SQLite/read-only credential and watched managed plugin directories. Put session metadata/archive behind runtime-owned stores; do not allow a one-shot OC2 migration to consume an OC1 live store. Preserve rollback/backup semantics.
6. **Wire every surface.** Web/Electron share server adapter; VS Code extension and webview select compatible proxy, SSE, managed process and config writers; hosted/Capacitor consume the selected server contract. Return explicit unsupported for a genuinely OC2-only feature in OC1 mode.
7. **Accept with both runtimes.** Test with the OC1 binary currently available to the maintainer: connect, history, prompt, streaming/tool state, permission/question, stop, reconnect, then queue/scheduled tasks, fork/compact, settings/plugin/MCP and metadata. OC2 pinned >=2.0.15: repeat core chain and regress new features. Record the tested OC1 version; 1.2.27-specific acceptance is deferred. Add focused contract fixtures for every mapped call/event, server proxy/VS Code tests and package checks; distinguish static/type/test evidence from live runtime evidence.

## Open review items

- `session.todo` and `tool.ids`: trace every current UI consumer and compare the full OC2 SDK/server schema before claiming upstream deletion; old OC1 calls must remain.
- OC2 `session.move/synthetic/generate/diff`, model/agent switching and file search: compare actual OC1 product flow before marking *feature* new and disabling it. API novelty alone is insufficient.
- Authentication/OAuth and custom provider write routes: verify OC1 and OC2 request bodies, secret-store owner and reload policy against runtime fixtures.
- The mechanical extractor cannot resolve constants, template strings assembled over lines, or arbitrary SDK client aliases; consume its raw evidence as an audit checklist, not a proof of no omissions. A second pass through import graph and route registration is needed before implementation is complete.
- No OpenCode process was started and no API response was captured in this inventory. Semantic classifications are static/source-backed hypotheses pending the acceptance matrix.
