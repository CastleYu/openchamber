# OpenCode integration source audit

Reviewed 2026-10-08 at `a62bbe7136b740ff08d39b902b98fc4b0ebfe2e6` in the `dijiang-next` worktree. This is a static audit of the current personal tree after upstream intake. No application, tests or OpenCode 1.2.27 server were run for this audit.

The findings classify current coverage of the full requirement. They do not attribute every existing behavior to a particular official upstream commit. In particular, the dual-kernel architecture is personal integration work; several branch and shortcut foundations already appeared in the September DEV-PLAN. Existing behavior is reused regardless of origin.

## Results

The later urgent [CAgent requirement](CAGENT-INTEGRATION-SPEC.md) is planned work outside this source audit. No CAgent API or feature support was examined. CA-00 inventories the shared consumers; CA-03 supplies the environment-local capability findings.

| Requirement | Current coverage | Remaining contract |
| --- | --- | --- |
| 3.1 Decouple agent-server integration | Partial. UI facade, OC1/OC2 session adapters, server operations and generation/epoch binding exist. | Complete profile dispatch across all consumed operations, remove or account for direct escapes, add Legacy and an explicit compatible-server boundary. |
| 3.2 Explicit connection modes | Core target missing. Binary-path settings and generation detection exist. | Five independently selected modes, saved mode/source, migration and failure without endpoint/binary substitution. |
| 3.3 Dispose on server-mode reload | Missing. External reload rechecks health and asks for manual restart. | Profile-aware instance disposal with scope, readiness and pending-state semantics. |
| 3.4 Native menu Chinese | Missing. Native menu/tray labels remain English; web context menu has no translated labels configured. | Locale propagation, menu rebuilding and real host acceptance. |
| 3.5 Always show current branch | Partial. Desktop has a branch metadata row. | Keep it visible with work status, and add persistent mobile branch context and honest failure/non-Git states. |
| 3.6 Explicit new-session branch refresh | Partial foundation. Git status and 30-second branch-cache refresh exist. | A user-triggered refresh bypassing TTL, scoped status/branch reconciliation and visible result. |
| 3.7 Shortcut hover hints | Partial. Shared lookup/formatter exist and some controls manually include shortcuts. | Shared hint behavior, effective-binding updates and complete registered-action coverage. |
| Legacy 1.2.27 | Missing as a dedicated profile. Detection accepts OC1 major version as one generation. | Exact profile selection, per-operation compatibility and real 1.2.27 acceptance. |

None of the original 3.X requirements is marked fully complete from this audit.

## Source evidence

Line numbers below refer to the pinned baseline. Open the named symbol/module when later commits shift lines.

| Finding | Source and observed behavior |
| --- | --- |
| Existing UI adapters | `packages/ui/src/lib/opencode/client.ts:293` defines the service; `v1/sessions.ts:27` and `v2/sessions.ts:46` provide separate session adapters. Generation-specific operations still remain in the service. |
| Existing server boundary | `packages/web/server/lib/opencode/kernel-runtime.js`, `kernel-operations.js` and `kernel-operations.d.ts` bind generation/endpoint/epoch and expose operations for autonomous callers. The declaration still includes SDK-specific raw/result types; it is not a complete protocol-neutral boundary. |
| No exact Legacy descriptor | `packages/web/server/lib/opencode/compatibility.js:1` defines OC1/OC2 and failure generations; `isSupportedOpenCodeVersion` accepts major 1 and `detectOpenCodeGeneration` resolves health/info. `packages/ui/src/lib/opencode/runtime.ts:10` has generation/endpoint/epoch/version, no compatibility profile. |
| Settings gap | `packages/ui/src/components/sections/openchamber/OpenCodeCliSettings.tsx:22` edits `opencodeBinary`, with reads/writes at lines 38/78. It is not a five-mode connection selector. |
| Resolver and startup gap | `packages/web/server/lib/opencode/DOCUMENTATION.md:349` records setting, environment, bundled, PATH and discovery resolution. `env-config.js:40` warns and ignores an invalid host. `lifecycle.js:1192` selects external/managed startup using environment/probes. |
| Reload gap | `packages/web/server/lib/opencode/lifecycle.js:926` re-probes an external instance. `core-routes.js:1048` returns manual-restart guidance. The inspected integration paths contain no instance/global dispose implementation. |
| Native locale gap | `packages/electron/main.mjs:4685` and `:4795` build English application menus; `:4912` configures `electron-context-menu` without translated labels. `packages/electron/tray.mjs:188` and `:288` contain English tray labels. |
| Branch visibility gap | `packages/ui/src/components/layout/Header.tsx:733` derives the label; `:741` hides metadata for chat context and visible work-status panel; `:1528` renders that conditional row. `packages/ui/src/apps/MobileHeader.tsx:49` explicitly omits project/branch metadata. |
| Refresh foundation | `packages/ui/src/components/chat/composer/state/useDraftTarget.ts:105` fetches initial Git status and `:113` refreshes stale branch data. `composer/ui/DraftTargetSelectors.tsx:409` and `:457` offer target choices without an explicit refresh action. |
| Hint foundation | `packages/ui/src/components/layout/TitlebarLeftControls.tsx:31` formats the sidebar shortcut; `:144` shows only the new-session label. `composer/ui/FocusModeButton.tsx:25` independently formats its hint. `session/sidebar/shell/SidebarFooter.tsx:42` uses label-only hints. |

The September prose assumed only the OC1 SDK boundary. The current [dual-kernel architecture](DUAL-KERNEL-ARCHITECTURE.md) and [interface inventory](DUAL-KERNEL-INTERFACES.md) already establish a larger foundation. Reimplementing them from scratch would duplicate owners. The new [integration SPEC](OPENCODE-INTEGRATION-SPEC.md) describes the remaining behavior against that foundation.

## Evidence limits and inherited validation

The current package manifests identify upstream version 2.0.4 and DIJIANG 4.0. [Upstream intake evidence](evidence/2026-10-01-upstream-intake.md) records later upstream content and intermediate broad checks, including failed UI tests and Web fixes without a complete post-fix rerun. These historical checkpoints neither prove current failures nor provide final acceptance for this milestone. INT-00 establishes the relevant baseline again.

The [dual-kernel adoption ledger](DUAL-KERNEL-ADOPTION.md) records newer OC1/OC2 tests and open live cases. It does not establish exact 1.2.27 semantics. The Legacy SPEC therefore distinguishes verified current-code structure from old-version contract questions and requires exact-version evidence before compatibility acceptance.
