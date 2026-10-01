# Upstream intake inventory, 2026-10-01

## Scope and evidence

- Personal source: `0e735328bc58bcea3135ab1615d3ff11b0aa89fd`, retained OpenChamber 1.24.2 core with OC1/OC2 adapters. The worktree has unrelated changes; this inventory does not assign them an adoption state.
- Last reviewed comparison: upstream `v2.0.1`, `63bd5070c8620432817e1e67de77791f801bcf3e`. The existing 154-row product ledger covers that snapshot only.
- Pinned upstream target: `upstream/main`, `1ac782ef6c8a718cf0fdf66306269a25718ad7c7`, fetched by the coordinating agent on 2026-10-01. The range contains 194 commits and changes 1,326 paths. This inventory uses that fixed SHA; a later remote advance needs another delta.
- Personal policy: keep `packages/web/personal-build.json` at `featureVersion: "4.0"`, keep the OC1 product behavior, and adopt upstream content by reviewed behavior rather than Git ancestry. The current file also says `updatePolicy: "notify-only"`.
- Sources: `git log --reverse v2.0.1..1ac782ef6`, `git diff --name-status/--stat v2.0.1 1ac782ef6`, selected `git show` and source diffs, [the existing adoption ledger](../DUAL-KERNEL-ADOPTION.md), [product ledger](../DUAL-KERNEL-PRODUCTS.md), and [4.1 plan](../DIJIANG-4.1-UPSTREAM-PLAN.md). The table below is a commit and owner inventory, not proof that each change is already present or tested in the personal branch.

## Reopened 2.0.1 work

The old product ledger has 33 rows marked `unimplemented`, 74 marked `existingOC1` without proof of the exact upstream improvement, and 12 deliberate non-adoptions. Reopen the 33 and source-check the 74 where parity is required. Preserve the 12 decisions unless a new dependency or product decision changes them. The 33 IDs are `P013, P022, P024, P028, P057, P058, P061, P072, P081, P086, P089, P090, P093, P094, P095, P096, P097, P103, P105, P109, P111, P115, P116, P126, P133, P134, P136, P137, P142, P145, P146, P151, P153`.

`P013` and `P094` are stale as blanket absence claims. The `v2.0.1` Files view imports `useFileTreeUpload`, and the personal plan reports a current Files upload path. Recheck the actual tree menu, toolbar, mobile picker, destination and failure flow before marking either row adopted. `P133` and `P134` are SDK host contracts, not isolated UI polish. `P089/P136` and `P090/P137` are paired App/VS Code entries and should share one implementation decision. The old interface ledger's real-core results used OC1 1.18.32 and OC2 2.0.16; they do not establish behavior against this target or exact OC1 1.2.27.

## Changed consumed contracts

| Boundary | Upstream change and source | Intake decision / check |
| --- | --- | --- |
| OC2 prompt and synthetic context | `packages/ui/src/lib/opencode/client.ts` adds `SyntheticContextInput`, client-minted IDs and ordered synthetic admission before the prompt. `5a6cc6c2d` and `011820691` touch context preservation and ID tests. | Compare with the personal prompt adapter and OC1 queue/context path. Verify accepted order, rollback and id ownership on both generations. |
| Active session status and global pages | `client.ts` adds global-page `spaces` marks and routes `session.active` to the scoped Space client for Space directories. `packages/web/server/lib/spaces/space-sessions.js` owns merged lists. | Keep host and Space status authority separate; a host empty snapshot cannot settle a Space turn. Global pages, directory pages and reconnect need distinct tests. |
| Catalog and policy | `client.ts` reads Space providers from the host and models/defaults from the Space; it adds a `config.get` provider-deny read. `de5e22545`, `814f7caf3`, `e1f9dfd36`, `dc0a6089c` affect directory catalog and policy semantics. | Preserve OC1 directory catalog behavior and require server policy enforcement before showing enterprise availability. Test forbidden provider requests beyond Settings visibility. |
| Events and state | `packages/ui/src/lib/opencode/events.ts` expands shell terminal status to `running/exited/timeout/killed` with signal and adds permission mode maps to the OpenChamber event. `packages/web/server/lib/event-stream/translate-v2.js` maps OC2 `session.compaction.ended` to `session.compacted`. | Review reducers, retry rendering, shell failure, compaction restore, child activity, queue, and stale epochs. Keep OC1 event semantics. Confirm `session.compaction.ended` from real OC2, since the source comment says `session.compacted` is declared but unpublished by OC2. |
| Permissions and classification | `1bc709ed0` changes UI/store/server auto-accept to `ask/safety/auto` and adds classifier providers. `cd51cb09c` makes classification opt-in; `14f529c6c` adds custom Jev and enterprise restrictions. | The mode is a server policy as well as UI state. Preserve OC1 permission replies and prior defaults. Ensure Jev does not receive conversation text until selected. |
| Server request body and Spaces | `packages/web/server/lib/opencode/core-routes.js` adds a body-parser bypass for requests dispatched to an isolated Space and a 50 MB Spaces API body limit. `packages/web/server/lib/spaces/` adds dispatch, sockets, grants and state. | Define host-to-Space request, event and credential ownership. Inspect every direct request outside the SDK facade; test streaming bodies, failed dispatch and policy gates. |
| SDK guest and host | `packages/sdk/src/file-editor.ts`, `frame-policy.ts`, manifest/protocol/host changes, and guest server changes introduce file editor contribution and network origin contracts. | Decide editor priority, binary snapshot, save ownership, origin approval and CSP at the SDK/host boundary. These are cross-runtime contracts. |
| VS Code bridge and hosts | `packages/vscode/src/bridge*.ts`, `opencodeConfig.ts`, `opencodeServiceUrl.ts`, and `packages/electron/main.mjs` change auth, policy and lifecycle. | Validate the bridge with both kernels, and separately validate native startup, managed/external ownership and mobile file paths. Shared UI tests cannot prove host behavior. |

The unchanged operations in `DUAL-KERNEL-INTERFACES.md` remain the earlier baseline. This table identifies observed new or changed consumers; it is not yet an endpoint-by-endpoint method/path audit for every one of the 194 commits. Each implementation batch must close that audit for its touched boundary, including direct server requests, event payloads, config and persisted state.

## Bounded patch batches and dependencies

| Batch | Candidate file ownership | Dependency and acceptance |
| --- | --- | --- |
| A. Kernel and sync | `packages/ui/src/lib/opencode/`, `packages/ui/src/sync/`, `packages/web/server/lib/opencode/`, `packages/web/server/lib/event-stream/` | First. Freeze generation-specific request/event/config contracts, then test prompt, shell, compact, retry, directory catalog, child status, queue and runtime switch on OC1/OC2. Coordinate server-owned routes with the Spaces batch before edits. |
| B. Chat and sessions | Chat composer/message, sidebar/session views, session stores, mobile session UI | Depends on A for changed operations. Includes comments, In work, timeline, multi-run, permission controls and post-release chat fixes. Test reachable UI plus state transitions and failure rollback. |
| C. Provider and routing | Provider/classification/Settings UI, `packages/web/server/lib/routing/`, small-model runtime | Depends on A's config/catalog contract. Test Jev opt-in, custom endpoint, account selection, model IDs and fallback. Keep OC1 routing behavior. |
| D. SDK, files and extensions | `packages/sdk/`, `packages/extensions/`, guest server modules, Files UI | SDK contract before host and Files UI. Test editor precedence, binary saves, network origins, Excalidraw and mobile file access across applicable hosts. |
| E. Enterprise policy | `packages/web/server/lib/enterprise-mode.*`, security entrypoints, Electron and VS Code policy bridges | Depends on C and D policy targets. Block prohibited direct requests and extension/network routes at owners. Resolve OC1 provider-policy coverage before exposing enterprise mode on OC1. |
| F. Spaces | `packages/web/server/lib/spaces/`, `packages/ui/src/lib/spaces/`, Space UI and dispatcher/socket glue | Uses A's status and event contracts and E's policy boundary. Keep Space identity and resources isolated. Contract tests can run without starting Docker; a live container run is a separate deployment decision. |
| G. Host and finishing fixes | Electron, VS Code, web CLI, Capacitor/Android, localized Settings history | After affected shared contracts settle. Test actual host startup and native/mobile behavior separately. Update both Settings history languages as part of integration. |

No batch should claim adoption from a similarly named personal file. Assign a single owner per overlapping file before parallel edits. The high-risk joins are A/F for session status and streaming, C/E for provider and Jev policy, D/E for extension origins, and A/B for permission/session lifecycle.

## Promotion blockers to resolve

1. The 154-row ledger stops at 2.0.1. All 194 commits below still need a content disposition against the personal source, and the old 33 absence claims need fresh checks. The two upload rows already show why a status label alone is unreliable.
2. Enterprise mode crosses server, Electron and VS Code policy boundaries. Provider restrictions, classification requests, tunnel/relay access and extension origins need direct-call checks. The OC1 provider boundary needs an explicit supported implementation or an OC1 enterprise-mode gate.
3. Spaces changes session identity, active status, body streaming, sockets, credentials and archived-chat reads. The host's empty active-session snapshot must not mark an isolated Space idle. Live Docker validation is outside this inventory and requires its own deployment decision.
4. File editor contributions cross SDK, guest frame, server and Files UI. An editor may supersede a built-in preview; binary snapshots, save ownership and approved network origins must agree before the host exposes it.
5. The old ledger's accepted contract tests and limited real-kernel runs predate this upstream range. A static source inventory cannot mark the current target or any host surface validated. Record actual OC1 and OC2 versions and the final personal SHA at the later verification gate.

## Commit inventory

The phase is based on each commit's position relative to the release commits. The lane is an initial assignment from its subject, not a final file owner or adoption decision. `Review` means the commit's behavior still needs a personal-tree comparison, OC1/OC2 disposition where applicable, and verification. Release, docs, test and CI rows still need integration decisions; they are not automatically executable product changes.

Dispositions come from `Temp/orch/work/ledger.mjs`. For each path a commit touches, the script compares the blob at `56fbe4e3a` with the working-tree file after CRLF is converted to LF. Taken means every touched path matches, or is absent on both sides. Omitted means at least one product file under `packages/`, tests and docs excluded, is present upstream and missing locally. Any other commit is Adapted. A commit that touches only docs, CI, or media is `Not applicable (docs/CI)` unless it is Taken. `Adapted` and `Omitted` rows are the exception list. Rows 195 to 231 are the 37 commits `201de9de2..56fbe4e3a`, phase `2.0.x-post`. The lane lists top-level directories that commit touches, using `packages/<name>` under `packages/` and the first path segment otherwise.

| # | Phase | SHA | Lane | Upstream subject | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 1 | 2.0.2 | `ed0b27cfc3` | Files/SDK | test(ui): point the browser guard at the agent tab path (#3968) | Taken |
| 2 | 2.0.2 | `ccad7ec55b` | Spaces | feat(spaces): bring a space's work out and apply it (stage 3b) (#3991) | Adapted |
| 3 | 2.0.2 | `49c5e7560b` | Catalog/routing | fix(agents): re-read the agent list once after startup so late plugin agents appear (#3978) | Adapted |
| 4 | 2.0.2 | `531d4f8d80` | Chat/session | fix(chat): keep a quoted dollar in prose out of inline math (#3989) | Adapted |
| 5 | 2.0.2 | `c8efc73635` | Chat/session | fix(chat): paint the session goal strip as glass over the transcript (#3971) | Adapted |
| 6 | 2.0.2 | `a7b01887ac` | Catalog/routing | fix(ui): resolve a Fast model by its catalog id (#3960) | Adapted |
| 7 | 2.0.2 | `ffa12ea39b` | Spaces | fix(spaces): restore space protections and tests after the move to OpenCode 2 (#3992) | Adapted |
| 8 | 2.0.2 | `f9d212f38a` | Spaces | feat(spaces): the feature switch and the dispatcher (stage 4a) (#3995) | Adapted |
| 9 | 2.0.2 | `d67dcca2d0` | Spaces | feat(spaces): the merged session list, space events and socket forwarding (stage 4b) (#3999) | Adapted |
| 10 | 2.0.2 | `1290fd1216` | Spaces | feat(spaces): the space in the sidebar, chat through the prefix, the settings switch (stage 4c) (#4005) | Adapted |
| 11 | 2.0.2 | `05691e0b79` | Docs/test | fix(test): preserve persistence exports in defaults settings fixture (#3941) | Adapted |
| 12 | 2.0.2 | `4195309ed6` | Chat/session | fix(ui): keep context-chip preview actions inside the chat viewport (#3246) (#3973) | Adapted |
| 13 | 2.0.2 | `f7fc68ee4f` | Files/SDK | fix(ui): route browser-control events through the private relay (#3729) (#3970) | Adapted |
| 14 | 2.0.2 | `4b71a2112f` | Kernel/sync | fix(sync): restore attached context when reverting to a message (#3962) | Adapted |
| 15 | 2.0.2 | `450692d180` | Chat/session | fix(chat): keep markdown table identifiers on one line when space allows (#3975) | Adapted |
| 16 | 2.0.2 | `8630f9ea46` | Host/build | fix(release): recover manifests after partial build failures (#3955) | Adapted |
| 17 | 2.0.2 | `2c9eaa2461` | Chat/session | fix(sessions): keep archived status snapshots from misreporting active replies (#3972) | Adapted |
| 18 | 2.0.2 | `981aa51469` | Cross-cutting | style: update auto-review banner glass styling | Adapted |
| 19 | 2.0.2 | `7e026cde73` | Host/build | fix(ui): show shared trust dialog above mobile worktree sheet | Taken |
| 20 | 2.0.2 | `fe30a560cd` | Chat/session | fix(chat): keep reverted-message dock actions visible on narrow screens | Adapted |
| 21 | 2.0.2 | `86bb286fda` | Kernel/sync | fix(relay): give relayed health probes time before failing a send | Adapted |
| 22 | 2.0.2 | `ca8ae69729` | Catalog/routing | feat(small-model): allow Claude Code and retry while plugins load | Adapted |
| 23 | 2.0.2 | `9e7cce16c6` | Catalog/routing | fix(models): show OpenCode's live context limits in model metadata | Adapted |
| 24 | 2.0.2 | `1a541f97f1` | Chat/session | feat(chat): render compaction and shell notices as timeline rows | Adapted |
| 25 | 2.0.2 | `de5e22545b` | Catalog/routing | fix(config): scope provider and agent catalogs to the worktree directory | Adapted |
| 26 | 2.0.2 | `78b6af1d9d` | Host/build | ci(release): keep partial releases as drafts | Adapted |
| 27 | 2.0.2 | `03a0eead33` | Chat/session | fix(chat): wrap table identifiers wider than the message | Adapted |
| 28 | 2.0.2 | `5a6cc6c2d4` | Kernel/sync | fix(sync): take context carriers along when reverting or forking | Adapted |
| 29 | 2.0.2 | `b504deb885` | Kernel/sync | fix(chat): show the retry countdown from OpenCode 2.x retry events | Adapted |
| 30 | 2.0.2 | `eed16b8c87` | Kernel/sync | fix(config): read a global opencode.jsonc next to opencode.json | Adapted |
| 31 | 2.0.2 | `25ccc6b95d` | Catalog/routing | fix(settings): refuse to overwrite an AGENTS.md edited elsewhere | Adapted |
| 32 | 2.0.2 | `69ac0b7e11` | Chat/session | fix(chat): keep form answers when switching sessions | Omitted |
| 33 | 2.0.2 | `e45e79b771` | Catalog/routing | fix(agents): refresh the composer agents when a plugin adds one | Adapted |
| 34 | 2.0.2 | `367e5c9260` | Host/build | fix(startup): open the app when the last project's folder is gone | Adapted |
| 35 | 2.0.2 | `aea1d2a0eb` | Host/build | fix(ssh): find an nvm-installed npm on managed remote hosts | Adapted |
| 36 | 2.0.2 | `bc323582b3` | Kernel/sync | fix(vscode): authenticate against OpenCode's background service | Adapted |
| 37 | 2.0.2 | `c570fa82c5` | Catalog/routing | fix(settings): pick up AGENTS.md edits made in another editor | Adapted |
| 38 | 2.0.2 | `38ea51fcee` | Chat/session | feat(sidebar): mark projects whose folder is missing | Adapted |
| 39 | 2.0.2 | `e0ee886e84` | Spaces | feat(spaces): the journey's server routes and the live switch (stage 5a) (#4007) | Adapted |
| 40 | 2.0.2 | `ec306ec028` | Spaces | chore(spaces): hide the isolated-spaces switch from Settings until the feature ships (#4008) | Adapted |
| 41 | 2.0.2 | `7175b51fb4` | Chat/session | fix(composer): drop the phantom scrollbar next to the send button | Adapted |
| 42 | 2.0.2 | `7a55687697` | Catalog/routing | perf(model-picker): virtualize long provider sections | Adapted |
| 43 | 2.0.2 | `9c1556b39e` | Release | release v2.0.2 | Adapted |
| 44 | 2.0.3 | `102bff7e95` | Spaces | feat(spaces): grants on the server, with the window bound to the inner network (stage 5b) (#4011) | Adapted |
| 45 | 2.0.3 | `9c6f33e25a` | Kernel/sync | chore(opencode): bump OpenCode to 2.0.18 | Adapted |
| 46 | 2.0.3 | `cc99bec6c6` | Chat/session | fix(chat): show shell commands killed by a signal as failed | Adapted |
| 47 | 2.0.3 | `a8b1e93dd1` | Catalog/routing | feat(sidebar): show the session's provider logo on timeline rows | Adapted |
| 48 | 2.0.3 | `22a929a08d` | Catalog/routing | fix(plugins): honor npm registry config for plugin metadata | Adapted |
| 49 | 2.0.3 | `29c6be6cf1` | Catalog/routing | fix(plugins): stop naming npm in registry lookup messages | Adapted |
| 50 | 2.0.3 | `dab2f8b193` | Kernel/sync | test(vscode): keep config tests off the real user config | Adapted |
| 51 | 2.0.3 | `60d836c489` | Catalog/routing | feat(settings): redesign providers as a card grid with account switching | Adapted |
| 52 | 2.0.3 | `4e5f26d07f` | Catalog/routing | feat(settings): card grids for MCP and plugins, list search, compact model rows on mobile | Adapted |
| 53 | 2.0.3 | `0ebe53fc84` | Catalog/routing | fix(chat): show background subagent runs started by commands | Adapted |
| 54 | 2.0.3 | `8acc354532` | Chat/session | fix(sidebar): rediscover worktrees after switching to a remote instance | Adapted |
| 55 | 2.0.3 | `1bc709ed09` | Policy | feat(permissions): ask / safety net / accept-all modes and classification providers | Adapted |
| 56 | 2.0.3 | `ea15762eeb` | Chat/session | feat(sessions): keep sessions in work until the user marks them done | Adapted |
| 57 | 2.0.3 | `91daa42bf5` | Policy | docs: explain Jev, permissions, Auto routing, sessions in work and chats | Adapted |
| 58 | 2.0.3 | `54fc3f28aa` | Host/build | feat(mobile): recent section, pinning and a shorter swipe row in the sessions drawer | Adapted |
| 59 | 2.0.3 | `7c4667b743` | Host/build | fix(sessions): read the whole turn when deciding the work looks done | Adapted |
| 60 | 2.0.3 | `c82fae5ee1` | Catalog/routing | fix(models): find Fast models by their catalog id | Omitted |
| 61 | 2.0.3 | `b7f50fa0de` | Chat/session | fix(sidebar): apply metadata broadcasts to the global session list | Adapted |
| 62 | 2.0.3 | `559c78de57` | Chat/session | fix(sessions): lower the done-hint threshold to 0.8 | Adapted |
| 63 | 2.0.3 | `53795a6050` | Policy | test(permissions): wait for the reconnect reply instead of counting microtasks | Adapted |
| 64 | 2.0.3 | `211a5e7136` | Spaces | feat(spaces): the create flow, with the live switch in Settings (stage 5c) (#4069) | Adapted |
| 65 | 2.0.3 | `8a773cce82` | Chat/session | fix(sidebar): show the done hint next to the time in timeline rows | Adapted |
| 66 | 2.0.3 | `0b936476e4` | Catalog/routing | feat(routing): answer Jev through OpenRouter and Vercel AI Gateway | Adapted |
| 67 | 2.0.3 | `f42715c250` | Chat/session | feat(ui): lay out the keyboard shortcuts dialog in two columns | Adapted |
| 68 | 2.0.3 | `ff555e6774` | Chat/session | fix(ui): keep the status dot by the time and give scheduled tasks the chat background | Adapted |
| 69 | 2.0.3 | `d9fbf6b784` | Catalog/routing | feat(multirun): run on several models from the composer | Adapted |
| 70 | 2.0.3 | `9f8af62d49` | Catalog/routing | feat(vscode): replace the Agent Manager with shared multi-run | Adapted |
| 71 | 2.0.3 | `8dd842a3b7` | Kernel/sync | fix(opencode): authenticate managed OpenCode 2 with the password it actually uses | Adapted |
| 72 | 2.0.3 | `275b636fc5` | Host/build | fix(mobile): make downloads and chat file links work in the Android app | Adapted |
| 73 | 2.0.3 | `220d7e0ae6` | Cross-cutting | feat(settings): bring back the Claude Code integration card | Adapted |
| 74 | 2.0.3 | `f757d99fc7` | Kernel/sync | fix(windows): stop unbounded spawnSync calls from hanging startup (#4046) | Adapted |
| 75 | 2.0.3 | `5d80297390` | Kernel/sync | fix(vscode): stop unbounded spawnSync calls from hanging startup (#4074) | Adapted |
| 76 | 2.0.3 | `02211ba73f` | Host/build | fix(web): find project favicons on Windows (#4054) | Taken |
| 77 | 2.0.3 | `b601501328` | Chat/session | fix(ui): count stream keepalives as activity for the stale-stream watchdog (#4065) | Adapted |
| 78 | 2.0.3 | `82bc5733e3` | Chat/session | fix: restore archived chats from the header menu (#4042) | Adapted |
| 79 | 2.0.3 | `8de16d7fbd` | Chat/session | fix(github): fail PR search when enrichment fails (#4016) | Adapted |
| 80 | 2.0.3 | `5208fd961c` | Host/build | fix(chat): restore mobile focus after large paste choice (#4013) | Adapted |
| 81 | 2.0.3 | `ba68df0e8f` | Kernel/sync | fix(sync): scope the post-restore status read to the session directory (#4009) | Adapted |
| 82 | 2.0.3 | `f159fba8ba` | Kernel/sync | test(electron): add test for nvm-installed opencode in SSH login shell (#4023) | Adapted |
| 83 | 2.0.3 | `3784892c6a` | Files/SDK | fix(browser): keep dead localhost navigation failed after stop-loading (#4014) | Taken |
| 84 | 2.0.3 | `bd01f9566a` | Chat/session | fix(worktrees): keep the new-worktree selection while its attach runs (#4010) | Adapted |
| 85 | 2.0.3 | `75da88dfa4` | Chat/session | fix(worktrees): update Manage worktrees after deletion (#3738) (#4015) | Taken |
| 86 | 2.0.3 | `5c03ecc6e0` | Chat/session | fix(ui): close a session deleted outside the app when its deletion event is missed (#4061) | Adapted |
| 87 | 2.0.3 | `54d51fad6a` | Catalog/routing | fix(usage): parse Zhipu Coding Plan CREDIT_LIMIT windows and surface in-body errors (#4024) | Adapted |
| 88 | 2.0.3 | `1f0004f2a3` | Chat/session | fix(composer): send a linked reference on its own (#4027) | Adapted |
| 89 | 2.0.3 | `117e45456d` | Spaces | feat(spaces): access to a space, with its blocked attempts (stage 5d-1) (#4076) | Adapted |
| 90 | 2.0.3 | `0a19aa8049` | Kernel/sync | fix(git): dispose removed worktree OpenCode instance (#3764) (#3767) | Adapted |
| 91 | 2.0.3 | `09ec21a72e` | Chat/session | perf(ui): stop tooltips and menus from restyling the whole app | Adapted |
| 92 | 2.0.3 | `caa9d84d96` | Host/build | fix(windows): bound the remaining startup probes | Adapted |
| 93 | 2.0.3 | `5a7956915c` | Host/build | fix(mobile): drop sessions deleted outside the app | Adapted |
| 94 | 2.0.3 | `85dc07f69c` | Chat/session | refactor(worktrees): drop the dead store mirror in Manage worktrees | Taken |
| 95 | 2.0.3 | `24bb515121` | Chat/session | test(composer): keep a bootstrapping worktree selected in the draft | Adapted |
| 96 | 2.0.3 | `a367cbce46` | Catalog/routing | fix(vscode): parse the Zhipu envelope like the web provider | Adapted |
| 97 | 2.0.3 | `152bddab59` | Host/build | test(electron): skip the nvm npm shell test on Windows | Adapted |
| 98 | 2.0.3 | `32d0b4de02` | Catalog/routing | fix(model-picker): keep long provider sections scrollable to the end | Adapted |
| 99 | 2.0.3 | `a2297eb1bf` | Catalog/routing | fix(chat): render OpenCode 2 subagent output as Markdown | Adapted |
| 100 | 2.0.3 | `50766fa0fc` | Catalog/routing | fix(providers): save custom providers with an API key on OpenCode 2 | Adapted |
| 101 | 2.0.3 | `ae6659944b` | Host/build | fix(worktrees): finish removing a worktree Windows still holds | Adapted |
| 102 | 2.0.3 | `26d114ef4d` | Host/build | fix(cli): give an instance started for a tunnel a UI password | Adapted |
| 103 | 2.0.3 | `03706c92cc` | Files/SDK | fix(extensions): install git extensions on schannel-only Git for Windows | Adapted |
| 104 | 2.0.3 | `d0af2666ee` | Files/SDK | fix(extensions): stop panels flashing white in a dark theme | Adapted |
| 105 | 2.0.3 | `309ddc2b12` | Kernel/sync | fix(git): dispose removed worktrees through the OpenCode 2 client | Adapted |
| 106 | 2.0.3 | `67dd1ad5c0` | Catalog/routing | fix(startup): stop booting every project's MCP servers at launch | Adapted |
| 107 | 2.0.3 | `814f7caf3b` | Catalog/routing | fix(agents): resolve model favorites against the edited project | Adapted |
| 108 | 2.0.3 | `5badd2472e` | Host/build | feat(mobile): add copy session ID swipe action (#4060) | Adapted |
| 109 | 2.0.3 | `a30029f90d` | Files/SDK | feat: add Excalidraw editor support and file integration (#4064) | Adapted |
| 110 | 2.0.3 | `18ca96969c` | Catalog/routing | feat(ui): expand stats with token composition, efficiency and tool calls (#4026) | Adapted |
| 111 | 2.0.3 | `282914bc9d` | Catalog/routing | fix(stats): load tool calls on request and fix tool row strings | Adapted |
| 112 | 2.0.3 | `46dfffa2ec` | Files/SDK | fix(files): harden the Excalidraw canvas saves and follow the theme | Adapted |
| 113 | 2.0.3 | `10bf8b5595` | Chat/session | fix(sidebar): show the done hint before the branch and date in grouped rows | Adapted |
| 114 | 2.0.3 | `a0c0bce3e3` | Catalog/routing | fix(chat): link parallel subagent calls to their child sessions | Adapted |
| 115 | 2.0.3 | `e840823dc0` | Release | release v2.0.3 | Adapted |
| 116 | 2.0.4 | `ed371c2cd2` | Host/build | fix(build): give the web build enough heap on macOS runners | Adapted |
| 117 | 2.0.4 | `8c70e9812e` | Host/build | ci(release): finish an already published release on macOS and iOS | Adapted |
| 118 | 2.0.4 | `80c888eb63` | Host/build | ci(pr-checks): run PR checks on Blacksmith runners | Not applicable (docs/CI) |
| 119 | 2.0.4 | `e0645023d5` | Chat/session | fix(chat): keep the selection comment box text sharp | Adapted |
| 120 | 2.0.4 | `6f43b5ec7b` | Chat/session | fix(sessions): restore pinned context and goal progress after compaction | Adapted |
| 121 | 2.0.4 | `d945cdaf64` | Chat/session | refactor(chat): drop v1 compaction checks from turn projection | Adapted |
| 122 | 2.0.4 | `ef010f42aa` | Host/build | fix(sidebar): show session goal and pending requests on timeline and mobile rows | Adapted |
| 123 | 2.0.4 | `9a2f2d8b5c` | Chat/session | fix(chat): stop glass shadows from painting grey bands over nearby panels | Adapted |
| 124 | 2.0.4 | `fae74f78d0` | Catalog/routing | feat(goal): check goal progress with Jev, the small model as fallback | Adapted |
| 125 | 2.0.4 | `c8ce4565b5` | Files/SDK | feat(extensions): file editors in the SDK, Excalidraw moves to an extension | Adapted |
| 126 | 2.0.4 | `953d00e0fe` | Chat/session | fix(chat): stop forks after an answer from copying a later compaction | Adapted |
| 127 | 2.0.4 | `25c28a4b63` | Host/build | docs(changelog): notes for the next release | Not applicable (docs/CI) |
| 128 | 2.0.4 | `049ad42ae3` | Host/build | docs(readme): add the Blacksmith CI sponsor logo | Not applicable (docs/CI) |
| 129 | 2.0.4 | `4454c44f75` | Host/build | fix(mobile): move the pending-request hook out of the badge components | Adapted |
| 130 | 2.0.4 | `3509f5c44c` | Chat/session | test: repair the stale tests that keep main's suite red (#4107) | Adapted |
| 131 | 2.0.4 | `8e8e0e1bd4` | Chat/session | test(chat): teach the renderer test DOM fake last-block marking | Adapted |
| 132 | 2.0.4 | `41c7c10c96` | Files/SDK | fix(files): render README HTML and badges in the Markdown preview | Adapted |
| 133 | 2.0.4 | `cd51cb09ce` | Policy | fix(routing): make classification providers opt-in with an explicit Off | Adapted |
| 134 | 2.0.4 | `ca6ff558d8` | Chat/session | fix(ui): keep shadows off every glass surface near the composer | Adapted |
| 135 | 2.0.4 | `4032c1f11c` | Host/build | ci: move CI to Blacksmith runners and run PR checks in parallel | Not applicable (docs/CI) |
| 136 | 2.0.4 | `3c54187cc5` | Spaces | feat(spaces): the state of a space and its repair (stage 5d-2) (#4112) | Adapted |
| 137 | 2.0.4 | `dc454ca6b8` | Files/SDK | fix(ui): align shell ended event with pinned SDK (#4113) | Adapted |
| 138 | 2.0.4 | `9536b3e07e` | Host/build | fix: keep shell startup output out of the login-shell environment (#3850) | Adapted |
| 139 | 2.0.4 | `352454547b` | Chat/session | fix(chat): resolve mixed text direction per block and composer line (#4115) | Adapted |
| 140 | 2.0.4 | `52206d97ac` | Chat/session | fix(chat): reset errors when sessions change (#3491) | Adapted |
| 141 | 2.0.4 | `67bba611a2` | Chat/session | fix(chat): preserve fresh errors when switching sessions (#4116) | Adapted |
| 142 | 2.0.4 | `167883d452` | Spaces | feat(spaces): stop an idle space by itself (stage 5d-3) (#4117) | Adapted |
| 143 | 2.0.4 | `6d3c7fc0be` | Catalog/routing | fix(small-model): stay on the provider the user works with | Adapted |
| 144 | 2.0.4 | `c54e90427e` | Files/SDK | fix(extensions): keep extension frames off the network | Adapted |
| 145 | 2.0.4 | `14f529c6c1` | Policy | feat: enterprise mode and a custom Jev endpoint | Adapted |
| 146 | 2.0.4 | `d67e8040cd` | Catalog/routing | fix(goal): check goals with the small model unless Jev is picked for them | Adapted |
| 147 | 2.0.4 | `80d0f6e467` | Policy | docs(changelog): notes for enterprise mode, Jev opt-in and extension network | Not applicable (docs/CI) |
| 148 | 2.0.4 | `dc0a6089c6` | Policy | feat(enterprise): a machine policy file, also read by the VS Code extension | Adapted |
| 149 | 2.0.4 | `de319de215` | Docs/test | feat(i18n): add Dutch (nl) locale (#4100) | Adapted |
| 150 | 2.0.4 | `2f88cd6c3a` | Chat/session | fix(sidebar): stop rows from offering only Delete after a missed Shift keyup | Taken |
| 151 | 2.0.4 | `098434da0a` | Policy | test(web): repair the config-paths fixture and keep enterprise env out of the suites | Adapted |
| 152 | 2.0.4 | `4ef0ed80bb` | Policy | fix(settings): hide Routing and stop offering Jev setup when enterprise mode keeps Jev off | Adapted |
| 153 | 2.0.4 | `3792ec3256` | Policy | feat(enterprise): keep OpenChamber off the network unless the administrator allows it | Adapted |
| 154 | 2.0.4 | `1e8b2c2685` | Files/SDK | fix(files): dock the markdown preview comment bar at the bottom on mobile (#4127) | Adapted |
| 155 | 2.0.4 | `55bc0ba2de` | Chat/session | fix(chat): add visible keyboard-accessible expand control for collapsed user messages (#3744) | Adapted |
| 156 | 2.0.4 | `a86e93351c` | Cross-cutting | fix(settings): open Settings without the first-open delay (#4128) | Adapted |
| 157 | 2.0.4 | `688c31477f` | Spaces | feat(spaces): run the project's setup commands inside a space (stage 5d-4) (#4129) | Adapted |
| 158 | 2.0.4 | `f42e632a1f` | Host/build | fix(git): stop PR base branch whitespace clicks from opening the select (#3819) | Taken |
| 159 | 2.0.4 | `620f028ba2` | Chat/session | fix(multirun): keep the app booting on a non-secure origin (#4087) | Taken |
| 160 | 2.0.4 | `4e9ff5824e` | Chat/session | fix(ui): keep alt+arrow inside diff review at file boundaries (#3540) | Adapted |
| 161 | 2.0.4 | `e1f9dfd365` | Catalog/routing | fix(agents): classify built-in agents from the config-entity isBuiltIn flag (#4119) | Adapted |
| 162 | 2.0.4 | `2a387e6f1d` | Catalog/routing | fix(mac): add NSLocalNetworkUsageDescription for LAN access (#3488) | Adapted |
| 163 | 2.0.4 | `07461335a3` | Policy | docs(changelog): notes for the enterprise policy file, network access and Dutch | Not applicable (docs/CI) |
| 164 | 2.0.4 | `f84e31f7ed` | Files/SDK | docs(changelog): Excalidraw moving to an extension is an improvement | Not applicable (docs/CI) |
| 165 | 2.0.4 | `b2a5f9ed65` | Chat/session | fix(sidebar): drop "ago" from compact session times | Adapted |
| 166 | 2.0.4 | `64d80f48a9` | Files/SDK | feat(files): zoom and pan in the image viewer | Adapted |
| 167 | 2.0.4 | `7a19d120ea` | Host/build | ci: keep bots and small release steps on GitHub-hosted runners | Not applicable (docs/CI) |
| 168 | 2.0.4 | `4f0f59a473` | Chat/session | fix(chat): keep composer comments on the message they were sent with | Omitted |
| 169 | 2.0.4 | `c1cd3e5dd8` | Policy | feat(enterprise): extensions from approved repositories, and a skill for the boundary | Adapted |
| 170 | 2.0.4 | `8aebeaa777` | Files/SDK | fix(extensions): show package icons again in the desktop and dev UI | Adapted |
| 171 | 2.0.4 | `6d166beb5c` | Catalog/routing | fix(agent-tool): offer OpenChamber tools as direct tools | Adapted |
| 172 | 2.0.4 | `de69117bfb` | Chat/session | fix(worktree): wrap long errors in the New Worktree dialog (#4131) | Adapted |
| 173 | 2.0.4 | `862691a825` | Policy | fix(classification): give the custom endpoint its own section and fit key placeholders | Adapted |
| 174 | 2.0.4 | `a5b7ee80a3` | Release | release v2.0.4 | Adapted |
| 175 | post-2.0.4 | `011820691a` | Kernel/sync | test(sync): expect minted ids on skill prompt context (#4134) | Adapted |
| 176 | post-2.0.4 | `566ba61852` | Host/build | ci(mobile): install Node 22 before the Capacitor build | Not applicable (docs/CI) |
| 177 | post-2.0.4 | `1a566db6c2` | Spaces | feat(spaces): apply a space's work as a branch or uncommitted changes (stage 5e-1) (#4158) | Adapted |
| 178 | post-2.0.4 | `f82f102293` | Spaces | fix(spaces): plainer wording across isolated spaces (#4166) | Adapted |
| 179 | post-2.0.4 | `c09c773dd5` | Host/audio | fix(dictation): never time out on long local dictations (#3770) | Adapted |
| 180 | post-2.0.4 | `12cd7247b7` | Host/audio | fix(dictation): cut long dictations inside real pauses (#4181) | Adapted |
| 181 | post-2.0.4 | `abee2ffb0a` | Catalog/routing | fix(routing): show thinking level names instead of numbers (#4133) | Adapted |
| 182 | post-2.0.4 | `a394d7013c` | Chat/session | fix(chat): collapse very long error messages (#4182) | Adapted |
| 183 | post-2.0.4 | `1a186e152f` | Spaces | feat(spaces): name the domains blocked during a failed setup, each with Allow (#4183) | Adapted |
| 184 | post-2.0.4 | `14d603e968` | Catalog/routing | fix(agents): drop the Reset that always failed and keep deleted agents out of the list (#4184) | Adapted |
| 185 | post-2.0.4 | `d78dac542d` | Files/SDK | fix(browser): don't retry a restored tab's dead dev server at launch (#4186) | Adapted |
| 186 | post-2.0.4 | `6e9c57bf34` | Spaces | feat(spaces): keep a deleted space's chats as a read-only archive (stage 5e-2) (#4201) | Adapted |
| 187 | post-2.0.4 | `3db4e7adf0` | Chat/session | fix(ui): double spacing between Recent and projects (#4208) | Taken |
| 188 | post-2.0.4 | `e3a6392abe` | Chat/session | fix(ui): toggle Stats panel from session sidebar (#4210) | Adapted |
| 189 | post-2.0.4 | `6a1e43e56e` | Chat/session | fix(chat): fold extra changed files into a +N chip (#4211) | Adapted |
| 190 | post-2.0.4 | `c29158dd6e` | Catalog/routing | fix(model-picker): keep the list in place when starring a model (#4213) | Adapted |
| 191 | post-2.0.4 | `692ab16a61` | Chat/session | feat(sidebar): Shift+click deletes a clean worktree and its local branch without the dialog (#4212) | Adapted |
| 192 | post-2.0.4 | `155411b73a` | Chat/session | fix(sidebar): explain PR colors with status tooltips (#4216) | Adapted |
| 193 | post-2.0.4 | `030f9ecdc3` | Spaces | feat(spaces): list a project's isolated spaces and the ones whose project is gone (stage 5e-3) (#4220) | Adapted |
| 194 | post-2.0.4 | `1ac782ef6c` | Chat/session | fix(chat): fade a live reply's tail above the composer instead of cutting it (#4221) | Adapted |
| 195 | 2.0.x-post | `405e903815` | .github, packages/ui | fix(browser): keep page annotation above modal dialogs (#4238) | Adapted |
| 196 | 2.0.x-post | `4c1af0e42c` | .github, docs, packages/ui, packages/web | feat(spaces): places page in Settings with disk and clean-up (stage 5e-4) (#4235) | Omitted |
| 197 | 2.0.x-post | `e61d445948` | .github, packages/electron, packages/web | fix(desktop): keep AppImage launcher paths out of the terminal and agent tools (#4240) | Adapted |
| 198 | 2.0.x-post | `940c9f46d0` | .github, packages/ui | fix(chat): keep the hover action row under a user message inside its row (#4243) | Adapted |
| 199 | 2.0.x-post | `8ee35503f5` | (root), packages/electron, packages/ui, packages/vscode, packages/web | chore(opencode): bump OpenCode to 2.0.19 | Adapted |
| 200 | 2.0.x-post | `1ac71e5ae8` | packages/ui | fix(diff): survive synchronous stat callback when swapping to full diff | Taken |
| 201 | 2.0.x-post | `6064f99152` | packages/ui, packages/web | fix(browser): load restored tabs on demand and capture without revealing the panel | Adapted |
| 202 | 2.0.x-post | `f70725c357` | packages/ui | feat(chat): show background commands and subagents where they run | Adapted |
| 203 | 2.0.x-post | `031d2af7e2` | packages/vscode, packages/web | feat(worktree): start from the fetched upstream of any published base branch | Adapted |
| 204 | 2.0.x-post | `6333f9469b` | packages/ui | feat(chat): copy selected response text as markdown | Adapted |
| 205 | 2.0.x-post | `612103ec02` | packages/ui | feat(ui): session archive undo, session history keys, terminal tab management | Adapted |
| 206 | 2.0.x-post | `3c5390c923` | packages/web | fix(dev-tunnel): reach dev servers bound to IPv6 loopback and log refusals | Taken |
| 207 | 2.0.x-post | `718129060a` | packages/ui | feat(chat): let wide tables and code blocks use the chat width in wide layout | Adapted |
| 208 | 2.0.x-post | `b41935caf3` | packages/ui | feat(files): git change gutter, code folding, occurrence highlight, preview tabs | Omitted |
| 209 | 2.0.x-post | `6008e24d51` | (root), packages/electron, packages/ui, packages/vscode, packages/web | chore(deps): bump OpenCode to 2.0.20 | Adapted |
| 210 | 2.0.x-post | `eb8e276cd7` | .agents, packages/vscode, packages/web | refactor(server): read provider credentials from OpenCode's API | Omitted |
| 211 | 2.0.x-post | `43c11d1c4f` | packages/ui | feat(chat,providers): show provider error details and sign-in-again status | Adapted |
| 212 | 2.0.x-post | `b876c86a2e` | packages/ui | fix(chat): keep wide-layout breakout blocks inside user bubbles and reasoning | Taken |
| 213 | 2.0.x-post | `e086a60214` | packages/ui | feat(ui): redesign the command palette | Adapted |
| 214 | 2.0.x-post | `de9b86d2b0` | packages/ui | fix(providers): keep plugin models, agent and thinking stable across worktree switches | Adapted |
| 215 | 2.0.x-post | `81ab2ab13d` | packages/ui, packages/web | feat(scheduled-tasks): schedule tasks in chats and open the page on mobile | Adapted |
| 216 | 2.0.x-post | `8fd19f95a7` | packages/ui | fix(mobile): close the topmost sheet or popup on Android back | Adapted |
| 217 | 2.0.x-post | `3eb78ee73a` | packages/ui, packages/web | fix(routing): run thinking levels the model does not list on its default | Adapted |
| 218 | 2.0.x-post | `7bc55a15ae` | packages/ui | fix(routing): stop autosave from trimming the text being typed | Adapted |
| 219 | 2.0.x-post | `eae34ed119` | packages/ui | fix(chat): let the wide layout use the full chat width for the transcript | Adapted |
| 220 | 2.0.x-post | `29310bda48` | packages/ui | feat(chat): reopen a session where the reader left it | Adapted |
| 221 | 2.0.x-post | `13e0f02e18` | packages/ui | fix(sync): declare the error response body where the notification reads it | Adapted |
| 222 | 2.0.x-post | `222fe9af1d` | packages/ui | feat(app): reopen the last open session on launch | Adapted |
| 223 | 2.0.x-post | `ffd38f6c2f` | packages/electron, packages/ui | feat(chat): link to a single message | Adapted |
| 224 | 2.0.x-post | `57e302a071` | packages/ui, packages/vscode, packages/web | fix(github): keep sidebar PR status live without per-branch polling | Adapted |
| 225 | 2.0.x-post | `404826896a` | packages/docs, packages/ui | feat(preview): name the worktree in action URLs and open portless addresses | Adapted |
| 226 | 2.0.x-post | `ca506e2d55` | packages/ui, packages/web | fix(sidebar): track PR badges of Timeline, Recent and In work rows | Adapted |
| 227 | 2.0.x-post | `a3ff2cab7a` | packages/ui, packages/web | feat(sidebar): show PRs linked to a session next to its branch PR | Adapted |
| 228 | 2.0.x-post | `f437a4fe69` | packages/ui | feat(sidebar): show the PR title in PR hover tooltips | Adapted |
| 229 | 2.0.x-post | `6a87eb822e` | packages/ui, packages/vscode, packages/web | feat(search): opt-in full-text search across conversations | Adapted |
| 230 | 2.0.x-post | `e9bc7aa1ba` | packages/ui | fix(ui): make bohdan/dev lint and UI tests pass again (#4241) | Adapted |
| 231 | 2.0.x-post | `56fbe4e3a9` | packages/vscode, packages/web | fix(server): keep stored provider keys away from clients (#4239) | Adapted |
