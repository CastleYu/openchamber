# Agent integration milestone specification

Status: planned, 2026-10-08. No implementation or runtime acceptance is claimed.
Source baseline: `codex/personal` commit `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6`, workspace version `2.0.4`, DIJIANG `4.0`.

## Scope and document ownership

This milestone implements DEV-PLAN requirements 3.1 through 3.7 on the existing OC1/OC2 architecture and adds dedicated OpenCode 1.2.27 compatibility. The maintainer's 2026-10-08 request replaces the earlier decision to treat all OC1 versions as one compatibility target for this milestone.

Urgent addition, 2026-10-08: prepare an independent CAgent Server API integration for local adaptation inside an inaccessible environment. The [CAgent architecture](CAGENT-INTEGRATION-SPEC.md) and [local adapter workbook](CAGENT-ADAPTER-WORKBOOK.md) own its bounded adapter kit, capability exclusions and native extensions. Deliver CA-00 through CA-02 architecture and documentation, pass existing-feature regressions, build and publish the temporary Release, then begin other INT work; CA-03 remains environment-local real adaptation and acceptance. No CAgent API or compatibility is currently verified.

Read this document for shared architecture, connection behavior, reload behavior and integration UI. Read the following documents when working on their scope:

- [Current implementation audit](OPENCODE-INTEGRATION-AUDIT.md): source findings and remaining work for each original requirement.
- [Legacy 1.2.27 specification](OPENCODE-LEGACY-1.2.27-SPEC.md): profile selection, operation coverage and exact-version acceptance.
- [Subversion milestones](OPENCODE-INTEGRATION-MILESTONES.md): dependencies, scope, completion gates and execution status.
- [Existing interface inventory](DUAL-KERNEL-INTERFACES.md) and [adoption evidence](DUAL-KERNEL-ADOPTION.md): the starting operation ledger, not proof of Legacy compatibility.
- [Original request](DEV-PLAN.original.md): historical requirement text. Its intent remains binding except where the dated follow-up explicitly refines it.

The new milestone keeps shared UI, OpenChamber-owned data, scheduling and native transports in their existing owners. It extends the existing adapters and adds the explicitly requested CAgent backend family. A generic plugin framework remains outside scope. An opencode-like command uses the OpenCode path only when it exposes a verified OpenCode-compatible contract; CAgent uses its own host adapter and capability contract. Other protocols report unsupported until a concrete adapter exists.

## Language review and handoff

The ten documents listed in the [Chinese review index](zh-CN/README.md) have complete Chinese review copies. During review, apply each maintainer-requested revision to the affected English sources and Chinese copies in the same change. Keep requirements, task IDs, versions, evidence status, dependencies and acceptance gates aligned; verify cross-references after editing. This rule also applies to future documents added to this milestone's handoff set.

Use the English documents for the next implementation handoff. Before handoff, reconcile both languages and record the handoff date and English revision or commit in the Chinese index. Mark the Chinese directory archived at that point and retain it as the review record, not a second execution queue. Until handoff it remains under review. If the maintainer later requests plan revisions, reopen review, update both languages and record a new archive revision. Resolve discrepancies using the maintainer's latest explicit decision; English handoff ownership does not override Chinese feedback.

## Existing architecture and target model

The current product already has `opencodeClient`, UI `v1/` and `v2/` operations, server `kernel-operations.js`, a runtime descriptor, generation-specific config/auth/plugin owners and runtime-epoch checks. OC1 uses the SDK namespace `@opencode-ai/sdk/v2`; that name does not mean OpenCode 2.x. OC2 uses `@opencode/client`.

Keep backend identity separate from OpenCode-specific compatibility decisions:

| Decision | Values | Owner |
| --- | --- | --- |
| Backend family | OpenCode or CAgent | Persisted explicit selection and verified host descriptor |
| Connection mode | External server, managed server command, system PATH, configured executable, bundled executable | Server or VS Code extension lifecycle owner |
| Protocol generation | OC1 or OC2 | Resolved endpoint descriptor |
| Compatibility selection | Auto, OC1, OC2, Legacy 1.2.27 | Persisted endpoint configuration; resolved profile is authoritative |

Legacy is an OC1 compatibility profile, not a third protocol generation or a second application. The server/extension resolves the profile before bootstrap, autonomous requests, config writes or plugin materialization. A user choosing OC1 still receives the mandatory Legacy profile if the endpoint reports exact version 1.2.27. Selection rules are owned by the Legacy specification.

The generation/profile rows apply only to OpenCode. CAgent uses its own versioned adapter contract, initially with an external server connection. Its availability and launch restrictions are owned by the CAgent SPEC. No OC1/OC2 generation or Legacy selection is assigned to CAgent.

Extend the existing descriptor with selected/resolved profile, version provenance, connection mode, connection identity and capability set. An identity revision covers endpoint, authentication identity, generation, profile and managed runtime replacement. Changing any of them retires old operations and reconnects through the existing runtime-switch flow. Clients and windows consuming the same backend receive its authoritative descriptor; a window cannot silently change the backend for its peers.

Define named constants and discriminated contracts in the owning shared boundary, grouped by connection mode, profile, lifecycle state and operation. Do not duplicate mode strings across UI, web and VS Code or introduce a second descriptor registry. Credentials remain in the established secret owner; the public descriptor contains no secret material.

## 3.1 Adapter completion

Keep `packages/ui/src/lib/opencode/client.ts` as the caller-facing service. Profile-specific requests, response/error parsing, event decoding and capability decisions belong under that boundary. Keep protocol-neutral chat components and queue business logic outside it. Adding a protocol changes only its adapter, composition points and, when protocol-specific editing is necessary, an explicitly protocol-owned editor. Do not build a generic SDK or plugin framework.

CA-01 first extracts the consumed domain contracts and closes existing SDK leaks required for CAgent. The CAgent implementation executes once in the trusted host adapter, as specified in its architecture; shared UI reaches it through explicit runtime operations. Existing OpenCode SDK paths remain intact behind their adapters. Subsequent local CAgent adaptation changes only the generated adapter workspace, not these shared consumers.

Acceptance covers the minimum consumer contract end to end: identity and capabilities, session history, send and stop, message events, permission requests, and configuration capabilities. Verify supported and unsupported behavior for each resolved profile, including preservation of authoritative state after failed reads. Unsupported operations are refused before dispatch and identify the selected profile and available next action.

Inventory existing direct SDK/HTTP/SSE escapes, dynamically assembled routes, generated plugin calls and host bridges. For each, record its owner, consumer, profile disposition, migration decision and test. Move an escape when its consumer needs the profile contract; retain it only with a documented boundary and evidence that it cannot bypass profile dispatch. New code must not add untracked escapes. The 43 historical interface rows are a starting index; include operations added by the current upstream intake.

Server jobs, proxy routes, config/auth handlers and plugins consume the same resolved identity through their existing owners. Browser closure must not change the selected profile for queue, scheduled tasks, assist, goals, routing, notifications or other autonomous callers. Electron owns native process integration; the in-process web backend owns protocol behavior. VS Code uses its extension and dedicated message/SSE bridges.

An operation has a typed supported result or an explicit unsupported/error result. Existing OC1 user features cannot be removed merely because an OC2 primitive differs. No SDK union or raw wire payload becomes a new component contract.

## 3.2 Explicit connection modes

The five launch contracts below describe OpenCode. Backend-family selection comes first; CAgent initially enables only its verified external-server path, and other modes follow its separate launcher evidence gates.

The connection settings show mode, target on the server's filesystem/network, requested compatibility, resolved version/profile, config source, readiness and last failure. OpenChamber host selection and OpenCode endpoint selection remain distinct controls. Editing a form does not change the active runtime. Test connection is read-only; starting a command is an explicit action.

| Mode | Inputs and resolution | Ownership and failure |
| --- | --- | --- |
| External server | Explicit HTTP(S) endpoint including host, port and optional base path; credentials stored by the host | Connect only to this endpoint. Never spawn, upgrade, kill or adopt its PID. Failed validation remains a connection failure. |
| Managed server command | Executable, argument list, server-side cwd and deliberate environment references; parse its announced endpoint, then probe it | One owned process tree per backend connection. A missing/malformed announcement, incompatible server or timeout fails this attempt. Output alone is not readiness. |
| System PATH | Resolve `opencode` exclusively from the backend host's effective PATH; display the resolved executable | Use the native OpenCode launch contract. Missing executable fails without probing known install locations or using the bundle. |
| Configured executable | Explicit backend executable or supported Windows shim plus arguments supported by the native launch contract | Validate and launch that target only. Invalid path/shim/arguments remain an error. |
| Bundled executable | Select the host's packaged, verified OpenCode binary | Available only when that host actually ships the bundle. Missing/corrupt bundle fails; no download or PATH substitution. |

The two command-oriented modes differ by launch contract: managed server command consumes an already configured server invocation and endpoint announcement; configured executable uses the native OpenCode launcher and controlled serve arguments. Windows `.cmd` shims are resolved by the existing launch-spec owner. Arbitrary shell pipelines are not implied by an executable field. Background children remain hidden and keep their process ownership records until exit is confirmed.

Modes do not encode protocol generation. Each available mode can use OC1 or OC2 and the Legacy profile when its actual binary/endpoint matches. A bundled modern binary cannot become 1.2.27 through profile selection.

### Saved settings and migration

The backend stores a versioned connection record. On first upgrade, valid existing settings and environment variables only prefill candidate values. Show each candidate's source and resolved value, then require the user to confirm before enabling it. Invalid or conflicting inputs stop at a visible setup error. With no saved choice, a bundled executable may be recommended, but it cannot start automatically. Do not scan ports to adopt an unrelated server.

The saved record is the sole authority for startup. Legacy environment variables are prefill sources, not recurring overrides or fallback chains. A CLI may explicitly save or update a choice through the same authenticated save contract as the UI, but cannot silently override that record at startup or make the UI read-only. Deployment administrator lock mode is outside this milestone. The OpenChamber settings service must remain reachable in setup/failed state, including when the OpenCode service/kernel fails.

Keep a recoverable copy of the prior connection settings when writing the migrated record. Failed validation or persistence leaves the previous saved record intact. Clearing settings returns to setup rather than silently rediscovering a mode. Older binaries are not assumed to understand the new record; rollback uses the preserved previous record.

### Switching, retries and process lifecycle

Use one owner for `unconfigured`, `validating`, `starting`, `ready`, `applying`, `stopping` and `failed` states, with state-specific fields. Serialize connection changes per backend. Tests and probes have deadlines and cancellation; duplicate submissions join or reject the active transition.

Validate a candidate before retiring the current descriptor when possible. For a managed target requiring startup, stop the previous owned server before spawning the replacement so that the one-instance contract holds. Busy sessions, queued dispatches, pending approvals and other clients are shown before switching. Defer until idle or accept an explicit user stop-and-switch decision; preserve drafts and queued intent under the original identity, and never send them to the replacement implicitly.

During a switch, pause dispatch, drain/cancel in-flight work according to its owner, retire the epoch, stop owned resources and bind the verified replacement. A failure after stopping leaves a visible failed state and offers an explicit return to the saved prior target. An external process remains running. Cleanup failure blocks another owned launch until ownership is resolved.

Bounded retries may reconnect to the same selected endpoint or restart the same owned executable under a displayed policy. They cannot change mode, executable, endpoint configuration or compatibility profile. There is no automatic fallback to another mode in this milestone.

## 3.3 Reload and dispose

The paths below define OpenCode behavior. CAgent config/reload remains disabled until its own documented scope and outcome contracts pass; neither an OpenCode dispose route nor a process restart is a CAgent fallback.

Expose the operation's actual effect before apply: live config apply, directory-instance reload, server-wide instance reload or owned process restart. The settings owner reports whether a change is pending; a successful HTTP response alone does not clear pending state.

| Selected path | Required behavior |
| --- | --- |
| External server | Use the resolved profile's verified dispose operation and scope, then probe and reload authoritative config/catalog/session state. Never restart or kill the external process. |
| Managed server command | Treat reload as the profile-aware instance dispose requested for server mode. A process restart is a separate visible operation for launch/binary changes or an explicit user action. |
| PATH, configured executable, bundled | Preserve the existing owned-process restart path where required. Keep OC2 watched config application for changes that already apply live. |

Keep connection epochs separate from directory-instance validity. Retire the connection epoch when the endpoint, profile or managed process is replaced, or when a verified operation requires global disposal. Directory-scoped disposal reuses the existing directory lifecycle: reject results from that directory's old instance and restore its subscriptions after reload. Preserve activity, requests and approvals for every other directory. Never pause the whole backend under a global lock for a directory-only reload. Global/profile switches may pause the whole backend. A missing directory dispose capability must not silently promote the request to global disposal. Verify actual method, route, body, response and scope separately for OC1, OC2 and Legacy before enabling each path; historical SDK method names alone are insufficient evidence.

Acquire the relevant transition lock and check activity before disposal. Reconnect streams only when the connection epoch changes; for directory reload, restore only that directory's subscriptions and refresh its authoritative state. A timeout or ambiguous response preserves pending state and reports an indeterminate result. Re-probe before an explicit retry; never blindly repeat a potentially completed destructive operation. Failed apply neither claims an empty config nor marks the change applied.

## 3.4 Native menu localization

Translate Electron application, tray and web-content context menus using the effective application language, including custom labels around Electron roles. Keep locale resources with the owning native code and pass only a validated locale through the established bridge. Rebuild menus when language changes, preserving actions, platform accelerators, checked/disabled states and window ownership. For conflicting window languages, native application/tray menus follow the app preference; a window-specific context menu follows that window's effective language.

Verify Simplified Chinese and English on Windows and macOS, with Linux tray behavior explicitly tested or marked unverified. Shared in-app menus retain their existing localization; browser/VS Code host-owned menus are outside Electron control.

## 3.5 Persistent branch context

For a Git-backed conversation or draft, show its current repository/worktree branch beside or below the title regardless of work-status panel visibility. On phones and tablets use a compact persistent branch label, with the full name accessible by activation/focus. Ellipsis may shorten a label; a panel must not hide it entirely.

Resolve the actual conversation/draft directory, not the globally selected project. Detached HEAD shows a short commit label. An empty repository and a non-Git directory have honest distinct states. Loading or failed reads do not present a cached branch as fresh. Existing sessions keep their directory; refreshing does not check out a branch or relocate a session. Runtime and directory switches reject stale results.

## 3.6 Explicit draft branch refresh

Add an accessible refresh action beside the draft target/branch selector. Bypass the normal TTL and request both current Git status and branch/worktree choices for the captured target directory. Join repeated refresh clicks while one is pending; changing target cancels or invalidates its result.

Show refreshing, success and retryable error states. Retain previous data on ordinary refresh failure and show a stale warning. If the current checkout changed externally, show the new current branch. Preserve an explicit new-worktree/branch selection if it still exists; if it disappeared or the target cannot be resolved, require reselection and disable sending. Keep draft text and attachments. Suspend target-sensitive sends only while the target itself is changing; a refresh error alone does not block sending to a still-valid target or require extra confirmation.

## 3.7 Effective shortcut hints

Use the existing shortcut registry and display formatter through one shared action-hint API/component. It reads the effective customized binding and platform, including disabled/unbound actions. Reuse it for new session, sidebar and focus controls, workspace navigation, draft refresh when bound, and other buttons already associated with registered commands. Maintain a finite action-to-control coverage list during implementation.

Hints update when shortcuts change and appear on keyboard focus as well as hover. Action labels remain understandable on touch devices. Do not invent shortcuts for unbound actions or overwrite native/OS-owned bindings. The displayed binding and actual command handler must share the same action identity.

## Runtime responsibilities

| Runtime | Required result |
| --- | --- |
| Web | Server owns connection/profile/settings and autonomous work. Authenticated UI can inspect and change supported modes; missing bundle/native path picker has an explicit unavailable state. |
| Electron | In-process web backend owns all protocols. Main/preload own native menus, executable selection and packaged process lifecycle. Additional windows consume the same local descriptor or their own selected remote backend. |
| VS Code | Extension host owns its connection/profile and process lifecycle; webview, message and SSE bridges agree. A mode unavailable in the extension is explicitly disabled. No Electron-menu promise. |
| Hosted mobile | Shares the server descriptor/settings and branch/refresh flows. Server paths never refer to the phone filesystem. Touch labels remain usable. |
| Capacitor | Select an OpenChamber host first; then use that host's modes/profiles. No local OpenCode process or bundle is started on the device. Reconnect discards stale host/profile state. |

## Verification and completion

Each subversion has its own gate in the milestone document. Record exact code SHA, tested kernel versions, mode/profile, host and directory, operation outcomes, artifacts and untested paths. Existing upstream-intake checkpoints are context, not a passing baseline for this release.

Run focused contract tests at each changed owner; cross-workspace contracts also require root type-check/lint and affected builds. Follow repository rules for dead-code and authored oxlint checks when executable implementation begins. Verify real startup, prompt/stream/reply, reconnect, switching, reload and quit on the promised hosts. Legacy completion requires exact 1.2.27 evidence specified in its document. Documentation generation only requires link, traceability and consistency validation.
