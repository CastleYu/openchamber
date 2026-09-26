# Dual-kernel adoption ledger

Status: integration in progress. The upstream comparison checkout is a reference, not an adopted release.

- OC1 personal baseline: `4ac81115c17c203c89c5b52f93a930af32ea2163`.
- OC2 target: `63bd5070c8620432817e1e67de77791f801bcf3e` (OpenChamber 2.0.1).
- Live validation target for this delivery: available OC1 1.18.32 and OC2 2.0.16. Exact OC1 1.2.27 testing is deferred by the maintainer.

The [interface inventory](DUAL-KERNEL-INTERFACES.md) owns source evidence and semantic classification; the [task tree](DUAL-KERNEL-TASKS.md) owns implementation dependencies. The [product delta ledger](DUAL-KERNEL-PRODUCTS.md) preserves all 154 release entries and their dispositions against OpenChamber 2.0.1 at 63bd5070c8620432817e1e67de77791f801bcf3e. Interface states separate real core runs from focused contract evidence; a missing manual end-to-end run does not mean an implemented, tested behavior is absent.
Real core + contracts means the named core interaction was observed against a live kernel and paired with focused assertions. Contract verified means the named assertions passed, without claiming a complete live user flow. Open identifies an unsupported contract, an unverified path, a failed relevant test or an explicit runtime gate.

| Interface ID | Adoption state | Acceptance evidence |
| --- | --- | --- |
| UI-01 | Contract verified | client.protocol.test.ts verifies kernel binding is cleared on unavailable/conflicting descriptors, one sync source per bound epoch, and OC2 session pages carry encoded directory scope. Isolated OC1/OC2 core runs used the selected workspace. Project/location/VCS cross-surface behavior remains open. |
| UI-02 | Real core + contracts | Both isolated kernels created sessions and persisted user/assistant messages. v1/sessions.test.ts verifies old path, directory query, create/update fields and failed-read semantics; v2/sessions.test.ts verifies cursor pages and avoids fabricating absent fields. Advanced archive/list mutation workflows remain open. |
| UI-03 | Real core + contracts | Both runs persisted assistant replies and streamed two text chunks. v2/sessions.test.ts asserts inline message parts and short-page termination; v1 projection tests preserve actual session/message fields and IDs. Non-text replay and all tool/reasoning projections remain open. |
| UI-04 | Real core + contracts | Both real runs submitted a prompt, received two chunks and settled idle. v2/sessions.test.ts and server kernel-operations.test.js assert generation-specific prompt admission, directory and delivery fields. Command/shell and autonomous prompt callers remain separate gates. |
| UI-05 | Contract verified | client.facade.test.ts now checks OC1 `session.shell` response projection and OC2 model/agent selection followed by `/api/session/:id/shell` admission; v2/sessions.test.ts keeps command separate, and events.ts maps OC2 shell started/ended to transcript refresh. No live shell execution was run. |
| UI-06 | Real core + contracts | Both real kernels acknowledged interruption, returned idle and closed the provider stream. v2 session and server kernel-operation contracts cover interrupt routing. Error recovery and reconnect cases remain open. |
| UI-07 | Contract verified | session-actions.test.ts asserts optimistic revert rollback, recursive descendant cutoff, busy-descendant abort, unrevert ordering and partial failure behavior; v2/sessions.test.ts checks staged revert stays a distinct OC2 operation. No live revert workflow is claimed. |
| UI-08 | Contract verified | client.facade.test.ts checks OC1 `session.summarize` boolean and OC2 model selection plus `/api/session/:id/compact` with its 200 compaction inbox response; events.ts maps compaction started/delta/ended/failed to transcript refresh. No live compact workflow was run. |
| UI-09 | Real core + contracts | OC2 2.0.16 proxy fork checks verified before-message selection and source preservation. forkCommand.test.ts covers bare /fork, prompt delivery, failed-send restoration and runtime-switch cancellation; session-actions.test.ts covers rollback; routes.test.js and fork-inheritance.test.js cover goal repair before prompt and cleanup. The final kernel-operations/routes rerun passed 43/43 tests; main/Sol separately report 48 server fork tests passed. The new repair path has not had a separate live run. |
| UI-10 | Contract verified, explicit OC2 disposition | client.facade.test.ts checks OC1 native todo reads and OC2 rejection before network; status components read the local persisted todo store. OC2 todowrite/todoread outputs render through ToolPart, with toolRenderers.test.ts checking valid and malformed entries. The OC1 `todo.updated` feed remains OC1-specific; dedicated native session.todo is unsupported in OC2. |
| UI-11 | Contract verified | global-session-status.test.ts asserts an idle parent stays active while a nested child works and settles afterward; descendant-activity.test.js covers nested activity, unknown status on failed reads, epoch changes and OC1 behavior. The final notification-focused rerun passed 11 tests across domain-batch-authority.test.ts and unopened-directory-events.test.ts, including child-notification suppression and OC1 immediate parent notification. Live concurrent-subagent execution remains open. |
| UI-12 | Contract verified | V2PermissionCard.test.tsx asserts saved grant patterns remain visible when broader than the current request and renders wildcard scope. Permission action contract tests passed. Live permission delivery/reply on both kernels remains open. |
| UI-13 | Contract verified | client.facade.test.ts asserts structured OC2 form answers use the form route; session-actions.test.ts verifies reply/cancel success and preserves pending state on failure. Live form delivery remains open. |
| UI-14 | Contract verified | Catalog and server config conversion assertions passed, and the isolated OC2 catalog read returned 8 models and 13 agents. The useConfigStore and prewarm mock export was repaired and the focused rerun passed; live config write/apply was not run. |
| UI-15 | Contract verified | Server/UI MCP config tests cover generation-specific configuration and OAuth-method filtering. No live MCP connect/disconnect run was made. |
| UI-16 | Contract verified | client.facade.test.ts checks OC2 move, model/agent selection, synthetic and file.find route projection, and OC1 file search; v2/sessions.test.ts checks OC2 diff/generate operations. session-actions.ts keeps direct OC1 controlPlane move behind its OC1 branch. File search consumers (FilesView, SidebarFilesTree, FileMentionAutocomplete, CommandPalette) share the corrected facade. No live advanced-operation workflow was run. |
| UI-17 | Contract verified | bootstrap.ts calls the selected source for path/config/VCS, while OC1-only raw SDK fallback is unreachable from the OC2 source; OC2 LSP availability is explicitly unsupported. client.facade.test.ts checks OC1 LSP/VCS native reads and OC2 VCS projection plus LSP rejection before network. debug.ts uses the selected bootstrap path/project facade. |
| UI-18 | Contract verified | provider-oauth-v2.test.ts checks integration form visibility, field requirements, answers and error mapping; MCP OAuth tests distinguish provider logins and expose only OAuth methods. Real provider/OAuth callback flows remain open. |
| UI-19 | Contract verified | Direct-caller audit: sync-context.tsx uses the OC1 SDK object for epoch identity only; bootstrap.ts raw SDK path is the OC1 fallback; session-actions.ts direct controlPlane move is OC1-only. ProvidersPageV1/ProviderOAuthMethods mount only for OC1; useMcpStore's legacy client is protocol guarded. VS Code watcher/bridge-system/bridge-git select their OC1 SDK calls by generation. Server routing, scheduled-tasks and session-assist use kernelOperations in production; skill-routes now uses OC2 `skill.list` and retains OC1 `app.skills`. skill-routes.test.js checks both OC2 envelope and partial local results on remote failure. Packaged host workflows remain untested. |
| UI-20 | Real core + contracts | OC2 browser Stats showed 1 session, 2 prompts and 19 tokens; session-stats.test.ts verifies the typed OC2 report, rejects OC1/unknown before a request, and drops a stale-epoch response. Populated history ranges and OC1 parity remain open. |
| HTTP-01 | Real core + contracts | Isolated OC1 1.18.32 and OC2 2.0.16 were identified. compatibility.test.js covers valid/conflicting health and info responses, unsupported versions, prereleases, unreachable endpoints and epoch binding. Host packaging remains open. |
| HTTP-02 | Contract verified | Lifecycle discovery fixtures assert the OC1 name versus OC2 id/envelope contract. Real config application and warmup after settings changes remain open. |
| HTTP-03 | Real core + contracts | Both isolated real runs used the selected workspace directory. client.protocol.test.ts asserts encoded directory-scoped OC2 paging; kernel-operations.test.js asserts directory routing and refuses empty-success on failed/incomplete reads. Other proxy paths and host failure cases remain open. |
| HTTP-04 | Contract verified | pwa-manifest-routes.test.js checks actual OC1 `/session` array and OC2 `/api/session` cursor-page fixtures, directory filtering, stale epoch rejection and failed-read cache behavior. The route reuses kernelOperations.listSessions and retains the Settings shortcut when recent sessions are unavailable. No installed PWA run was made. |
| HTTP-05 | Real core + contracts | Both runs connected the global event hub and delivered matching streamed content; OC2 browser observed two chunks. Server event-stream and UI event contract tests cover ordering, translation and payload projection. Replay after reconnect remains open. |
| HTTP-06 | Contract verified | message-queue/runtime.test.js passed in the 52-file server Vitest batch; it asserts ordered delivery, failed-item retry, restart recovery, and that OC2 queue delivery waits while a child is active after parent idle. No live unattended queue run is claimed. |
| HTTP-07 | Contract verified | session-goal/runtime.test.js covers child activity, delayed audit, truncation recovery and epoch cancellation; session-assist/runtime.test.js covers stale results, unknown status and stop cancellation; scheduled-tasks tests assert once-only firing across instances and failures release the running slot. No live scheduled execution is claimed. |
| HTTP-08 | Contract verified | Upgrade capability and route fixtures cover version-specific eligibility and explicit unsupported behavior. No live binary upgrade was run. |
| HTTP-09 | Contract verified | Provider/MCP OAuth form and config contracts pass. proxy.js registers OC2 provider callback and MCP authentication ahead of the generic `/api` proxy with the interactive deadline; the mounted `/api` middleware sees the callback path without that prefix. An external provider login and its full callback sequence were not run. |
| HTTP-10 | Contract verified | Session route/storage tests cover OC1 partial archive failures, OC2 archive shapes, metadata route payloads, stale-operation rejection and storage scope. Full settings/archive round trip across both live kernels remains open. |
| HTTP-11 | Real core + contracts | Both isolated kernels verified metadata semantics. client.facade.test.ts asserts merge-and-retain behavior for unrelated namespaces; routes.test.js asserts the full-state metadata response and stale archive rejection. Autonomous caller parity remains open. |
| EV-01 | Contract verified | global-session-status.test.ts and descendant-activity.test.js assert the parent remains active through nested child work, settles after child state clears, preserves unknown on failed reads, and keeps OC1 status unchanged. Queue contract covers delayed delivery. No live child-run test is claimed. |
| EV-02 | Real core + contracts | Both real runs observed matching two-chunk assistant content. events.test.ts verifies text/reasoning part identity matches HTTP history and rejects partial session fabrication; v1 projection tests preserve part variants. Full tool/reasoning reconnect replay remains open. |
| EV-03 | Contract verified | V2PermissionCard.test.tsx verifies saved-scope display; session-actions.test.ts covers permission reply routing and stale/missing request cleanup; kernel-operations.test.js asserts generation-specific permission routes. Live request/reply remains open. |
| EV-04 | Contract verified | Form tests assert OC2 form answers are structured, route correctly, and remain pending on failed reply/cancel. Live question/form delivery is open. |
| EV-05 | Contract verified | OC1 `session.diff` and `todo.updated` retain their reducer paths; OC2 diff is an on-demand operation and native todo is explicitly unsupported. OC2 `project.updated` refreshes catalogs. OC2 `vcs.branch.updated` now projects the pinned schema into the existing tray VCS state; bootstrap populates the same state. Events/bootstrap/reducer/batch contracts cover branch update and clearing, directory isolation and stale-runtime rejection (35 focused tests). No native tray interaction was exercised. |
| EV-06 | Contract verified | translate-v2.test.js checks `server.connected` and `installation.update-available` envelope projection; event-stream rebind/upstream-reader tests exercise connection/replay boundaries. UI source events map `server.connected` to global refresh, while OC1 event-pipeline tests cover the legacy path and sync-context.tsx dispatches update-available notifications. No packaged reconnect/update notification run was made. |
| EV-07 | Contract verified for consumed events | events.ts maps OC2 inbox and compaction to transcript refresh, retry to message refresh, skill activation to transcript refresh, usage to session refresh, and websearch to catalog refresh; events.test.ts and server translate-v2.test.js cover selected projections. `mcp.resources.changed` has no current UI consumer: listMcpResources exists in client.ts but has no caller, so this event is intentionally unconsumed in this product flow. No live sequence of these events was run. |
| CFG-01 | Contract verified | Config conversion and server route tests passed, and real provider configs were recognized. The two UI config-store tests now load and pass after the mock export repair; live managed-config write/apply remains untested. |
| CFG-02 | Real core + contracts | OC2 real catalog returned 8 models and 13 agents. client.facade.test.ts covers activation barriers, runtime changes and failed activation without empty success; kernel-operations.test.js covers ordered catalogs and abort/config validation. Not every config/catalog path is covered. |
| CFG-03 | Contract verified | Server auth-v2 tests verify DB-authoritative reads, empty DB semantics and legacy fallback only when SQLite is unavailable. VS Code opencodeAuthV2.test.ts cleanup now closes the SQLite handle and its focused rerun passes. No real credentials were used. |
| CFG-04 | Contract verified | plugins-v2 tests assert v1/v2 normalization, scoped updates, duplicate handling and plugin-directory round trips. Actual managed-plugin hot apply remains open. |
| CFG-05 | Contract verified | VS Code bridge/SSE and selected host config/auth fixtures cover both protocol paths. Full extension/webview startup with supported OC1 and OC2 binaries and host packaging were not run. |

## Accepted implementation increments

| Increment | Result | Remaining integration |
| --- | --- | --- |
| Runtime detection and epoch binding | 14 compatibility tests passed; isolated OC1 1.18.32 and OC2 2.0.16 were distinguished, and stale descriptor epochs are rejected by focused contracts | Native and VS Code startup against the packaged binaries |
| Dual-kernel core calls | Wrapper and server contracts cover session pages, prompts, messages, catalogs, metadata, interrupt and directory routing; real runs created sessions, persisted messages, streamed two chunks, interrupted and cleaned up | Shell/command completion, compact, forms/permissions and broader reconnect behavior |
| Session activity and queue authority | Focused UI and server contracts assert nested-child activity, unknown-on-failure, OC1 preservation and deferred OC2 queue delivery. The changed descendant-activity.test.js and message-queue/runtime.test.js passed in the server test batch. | Live concurrent-subagent queue and auto-review workflow |
| Fork and persistent permission contracts | UI `/fork`, rollback, file-backed goal repair and saved permission-scope assertions pass; main/Sol report 48 server fork tests passed | Live packaged fork repair and permission request/reply |
| Config and catalog adapters | 41 config conversion tests and focused server/provider/catalog tests passed; real OC2 catalog returned 8 models and 13 agents; the two UI config-store files passed in the corrected focused rerun | Live config writes and hot apply |
| Dependencies and verification | Bun 1.4.2 frozen install completed without lock changes; the initial changed UI/VS Code matrix passed 186/191 files and server Vitest passed 760 tests across 52 files with 1 skipped. The five failing files were corrected and passed in a separate 140-case focused rerun. | Native-host acceptance, CI and release gates. The 191-file matrix was not repeated. |

## Remaining final gates

The focused matrix moves contract evidence ahead of packaged end-to-end acceptance. Its five failed files were repaired and passed in a separate targeted rerun (140 cases across eight files); the original 191-file matrix was not repeated. See `.codex-temp/final-integrated-validation.md` for the original failures and corrected rerun.

Complete the Windows portable build and startup gate, then verify CI and Release assets. VS Code and mobile coverage uses the recorded bridge/runtime contracts; no native device acceptance is claimed. The 154-item product ledger records adoption choices. It does not make every release-note item a manual end-to-end acceptance requirement.

## Product integration evidence

These rows describe implemented paths and focused checks, not release acceptance.

| Feature | Integrated behavior | Evidence and remaining work |
| --- | --- | --- |
| Code Mode | OC2 execute rows show script, ordered calls and truncation; OC1 keeps its generic tool renderer | Parser and mounted ToolPart checks cover both generations and unknown-output fallback; real agent execution remains |
| Historical Stats | OC2-only range/project view; OC1 retains existing live indicators | 16 focused tests; runtime/source change guards implemented; browser showed 1 session, 2 prompts and 19 tokens; populated historical-range behavior remains |
| Web search | OC2 provider settings, credential operations, consent card and result cards; config and credential events refresh opened settings | Parser, SDK boundary, store scope, search availability and server route/storage tests pass; browser confirmed the panel loaded but did not submit a search; consent/provider execution remains |
| Notifications | OC2-only agent notify setting and managed-plugin injection; OC1 notifications stay available through their old path | Registry/search and 68 server settings/plugin tests pass; actual agent-to-client delivery remains |
| CSV/TSV and fonts | Tables retain source editing; binary fonts use runtime asset loading and temporary FontFace registration | CSV parser tests pass; 3 table and 2 font focused tests pass; these OpenChamber file features do not require OC2 |
| Themes | Cursor and Osaka light/dark presets added without removing personal themes | 12 theme definition tests pass; visual inspection remains |
| File picker upload | Files panel directory menus and toolbar use the upstream upload hook with conflict confirmation and picker runtime/root checks | Source integration and UI type-check pass; 2 sidebar tests pass; mounted upload acceptance remains |

Isolated real OC1 1.18.32 and OC2 2.0.16 runs have exercised conversation
submission, persisted user/assistant messages, two streamed text chunks,
idle completion, interruption and resource cleanup with a local test provider.
OC1 retained native metadata replacement; OC2 retained sibling fields and
removed an explicitly null field. OC2 cold-start catalog reads now wait for
the official integration activation barrier before listing models and agents.
These results cover the real kernels and server operation/event paths;
they do not close all 43 interface rows or 154 product-ledger rows, and they do
not replace packaged-host acceptance. The passing profiles are
`real-conversation-oc1-QgTrQN` and `real-conversation-oc2-QKBE0X`; their
`result.json` files record observed versions, provider frames, event assertions
and cleanup. Earlier failed OC2 attempts remain in the JSONL run history and
are not counted as passes. A separate OC2 browser check showed two chunks, a
partial interrupted response, Stats for one session and two prompts with 19
tokens, and a loaded Web search panel. It did not submit a Web search request
or exercise packaged-host behavior.

The browser run exposed an Illegal invocation in the default event-pipeline timer callback. The wrapper fix and timer receiver regression tests passed in the final dual-kernel runner. Build and host acceptance remain separate gates.

Fork command and file-backed goal repair now have focused UI and server contracts, and nested-child status has focused UI/server/queue assertions. These paths have not had dedicated packaged-host live runs. Live permission and form delivery, shell execution, compact/reconnect, config/OAuth/plugin hot apply, and VS Code, desktop and mobile lifecycle remain open. The five initially failing test files passed targeted reruns; native-host, CI and release gates remain. The 154-item product ledger preserves intended adoptions and non-adoptions; it does not require manual end-to-end coverage for every release note.

## Baseline evidence

Before adapter implementation, workspace type-check passed. Baseline scripts 9/9, SDK 15/15 and UI 560/560 passed. Electron 31/31 passed. VS Code gitPathDiff failed in the full run but passed 4/4 in isolation. Web had existing git-service timeout/cleanup and SSH-install timing failures; the concurrently added detector failure was an implementation result and was subsequently repaired. Full command output is retained under the task worktree `.codex-temp/baseline/`. These observations do not waive final affected-code gates.

## Publication

No release or branch promotion has occurred. Original root checkout dirty files remain untouched. The final upstream version must describe adopted content; it cannot be inferred from the reference checkout or inherited merge ancestry.
