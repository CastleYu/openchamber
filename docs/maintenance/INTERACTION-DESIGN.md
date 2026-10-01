# DIJIANG interaction optimization design

Status: design proposal, 2026-09-22. Implementation and runtime acceptance have
not started under this document. The four sections below expand the maintainer's
interaction milestone. Proposed choices are reviewable defaults, not additional
requirements attributed to the maintainer.

## Sources and scope

The source of intent is [the original request](DEV-PLAN.original.md), request 1,
items 2.1 through 2.4. [The development plan](DEV-PLAN.md#2-interaction-optimization-major-version)
adds code context. [The execution plan](PLAN.md) owns task status and evidence.
The original request takes precedence when their wording differs.

| Item | Original wording | Design outcome |
| --- | --- | --- |
| 2.1 | 侧边栏大写显示优化 | Preserve the intended casing of project labels throughout the sidebar |
| 2.2 | 更新提示改为基于对应DIJIANG版本仓库的更新提示 | Check the personal release source and compare personal build identities |
| 2.3 | 工作中显示优化：对话框显示一个呼吸效果 | Indicate live work through a subtle pulse on the conversation container |
| 2.4 | 添加新的项目优化 | Make project selection, submission and outcomes explicit |

The original wording does not specify whether 2.1 means all-uppercase labels,
or preserving uppercase characters. This design proposes preserving original
casing. Item 2.4 names a direction without a concrete pain point; its flow below
is a proposed starting point. Both choices remain visible in the decision table.

The original request also requires explicit behavior and rejects silent
fallbacks. Here that means a failed personal update check stays a failed check,
and a failed project selection does not redirect to a different path or host.

Related execution work is REL-01 for notification-only enforcement and PERF-01
for measurement methods. This proposal changes REL-01's upstream-only update
comparison policy when implemented. VIEW-01 covers dual screens and workspace
tabs and is a separate design. Original items 3.4 through 3.7, including native
menu translation, branch display and shortcut hints, remain in their original
milestone. No existing task status is advanced by this document.

## Observed starting point

These are targeted source observations from the working tree on 2026-09-22,
not runtime findings. Older line references in DEV-PLAN.md need checking during
implementation.

| Area | Evidence | Consequence |
| --- | --- | --- |
| Project labels | `packages/ui/src/components/session/sidebar/projects/sortableItems.tsx` applies `lowercase` to the label | Correct stored casing can still display incorrectly |
| Update source | `packages/web/server/lib/personal-build.js` points at community releases | Personal notifications currently identify the wrong release stream |
| Update comparison | `packages/electron/personal-updates.mjs` accepts plain upstream tags and compares against `upstreamVersion` | Changing only the repository URL would reject DIJIANG tags |
| Release identity | `packages/web/personal-build.json` currently records `3.5`; BUILD.md defines numeric `feature.fix` | Compare parsed numeric components and retain legacy identity support |
| Animation | `packages/ui/src/index.css` animates border and outline colors in `border-glow-pulse` | Reusing that animation unchanged conflicts with the current opacity/transform animation contract |
| Project addition | `DirectoryExplorerDialog.tsx` already handles selection, cloning, creation and submission errors | Refine the existing dialog instead of introducing a competing workflow |
| Runtime ownership | `useProjectsStore.ts` adds VS Code folders through the extension host | A universal local-filesystem assumption would be incorrect |

## 2.1 Sidebar label casing

### User experience

Proposed rule: render the saved project label exactly as supplied. When there
is no custom label, use the existing folder-label derivation and preserve its
casing. `OpenChamber`, `MyAPI` and `中文SDK` should look the same in the normal
project row, sticky header, Recent list and worktree grouping. Session titles
continue to preserve user-authored text.

Remove forced case transformation only at affected label sites. Keep existing
path normalization, project IDs, sorting, search matching and deduplication.
Display casing must never rename a folder or create a second project. Do not
change the shared Button's typography as a side effect of this item.

Long labels retain truncation. A tooltip or existing accessible name exposes
the full original text. Renaming updates every representation of that project
without remounting the chat or changing the selected session.

### Acceptance

- Mixed-case, uppercase-only, lowercase-only, Chinese and custom labels retain
  their text across normal, sticky, Recent and worktree representations.
- Rename, search, selection and duplicate-path behavior stay consistent.
- Long labels remain usable at narrow sidebar widths and 200% text zoom.
- The same project survives reload with the same identity and display label.

## 2.2 Personal release notifications

### Source and identity

Use the personal repository configured by the build. BUILD.md currently names
`CastleYu/openchamber`; verify it against the release workflow before wiring
the implementation. Keep repository identity and release policy in the owning
personal-build module, with shared parsing/comparison helpers where both
desktop and server consumers need them.

The current policy in BUILD.md compares only the community version. This
proposal replaces that rule for personal builds. Parse identities as
`upstream major.minor.patch` plus `DIJIANG feature.fix`. Treat a historical
single-level personal revision as `feature.0`. Build metadata does not change
ordering. Debug artifacts are not release candidates.

Proposed ordering uses the upstream numeric tuple first, then the personal
numeric tuple. Reject a candidate that would lower the installed personal
feature/fix revision even when its upstream version is newer. This prevents
an upstream advance from recommending an older personal feature set. A future
release line with different ordering needs an explicit policy revision.

| Installed | Candidate | Expected result |
| --- | --- | --- |
| `1.23.0-DIJIANG.3.5` | `1.23.0-DIJIANG.3.6` | Available |
| `1.23.0-DIJIANG.3.9` | `1.23.0-DIJIANG.3.10` | Available, numeric comparison |
| `1.23.0-DIJIANG.3.5` | `1.23.0-DIJIANG.4.0` | Available |
| `1.23.0-DIJIANG.3.5` | `1.24.0-DIJIANG.3.5` | Available |
| `1.23.0-DIJIANG.3.5` | `1.24.0-DIJIANG.2.9` | Ineligible personal downgrade |
| `1.23.0-DIJIANG.3.5` | Same identity or an older tuple | No update |
| `1.23.0-DIJIANG.1` | `1.23.0-DIJIANG.1.1` | Available |
| Personal build | Plain community tag or debug tag | Not a personal release candidate |

GitHub's ordinary latest-release selection must not define DIJIANG eligibility:
the tag format uses a SemVer prerelease suffix. Proposed discovery reads the
repository release list and selects published, non-draft DIJIANG releases that
have the expected release metadata. A GitHub prerelease flag alone does not
exclude an otherwise valid DIJIANG release. Experimental channel support is
outside this proposal.

Bound request duration and pagination. If discovery reaches its bound before
it can establish the result, report an incomplete check. Do not turn a partial
list, malformed metadata, rate limit or network failure into "up to date".
Keep release notes and the release-page link attached to the selected tag.

### Presentation and states

Reuse the existing update entry point and dialog. Show the installed full
identity, candidate identity, personal repository and last successful check.
The primary available-update action opens the matching release page. Preserve
notification-only enforcement in HTTP, IPC, CLI and package-manager paths.

| State | Visible result and action |
| --- | --- |
| Not checked | Installed identity and Check for updates |
| Checking | Quiet progress indication; repeated clicks share the pending request |
| Available | Both identities, matching notes and View release |
| Current | No newer eligible personal release, with check time |
| Failed or incomplete | Concrete error and Retry; previous result remains labelled as previous |
| No eligible release | Explain that no matching personal release was found |

Keep the existing scheduling frequency. Deduplicate notices by repository and
candidate identity; manual checks still show the result. A runtime change
invalidates the pending result so it cannot overwrite another runtime's state.
No fallback to community GitHub releases or npm occurs on personal-check failure.

### Runtime contract and acceptance

Desktop checks the installed desktop build. Web and hosted mobile show the
connected server's identity and label it as such. VS Code and Capacitor must
distinguish their installed shell from the connected server: only show a
shell-specific update when the release source actually publishes that shell.
Never describe a Windows portable executable as an extension or mobile update.

Test the identity table, malformed metadata, HTTP failures, pagination limits,
repeat checks and stale runtime responses. Verify a real packaged desktop
dialog with controlled available/current/error responses and the matching
release link. Recheck direct install guards. Live repository verification is
a separate acceptance step; no online release lookup was performed for this design.
Update BUILD.md and REL-01's contract alongside the eventual implementation.

## 2.3 Live conversation pulse

### Placement and appearance

Proposed placement is the outer conversation container, enclosing the message
area and composer. It gives one persistent signal even when the current reply
is off-screen. Use one noninteractive decorative outline layer with a fixed
theme-derived `status.info` color. Animate its opacity from 0.25 to 0.65 and
back over 2.4 seconds with ease-in-out timing. These values are visual-review
defaults, not measured performance results.

The layer follows the existing corner radius, occupies no layout space and
ignores pointer events. It must not clip text, scrollbars, selection or focus
rings. Use a static border on the layer and animate opacity only. The existing
border-color animation is therefore not reused unchanged. Existing BusyDots
can remain because it identifies the active reply within the message list.

### State ownership

Read the selected session's authoritative live status through the existing
session state contract. Subscribe only to the fields this indicator needs.
There is no polling timer, token counter or persisted "working" flag.

| Visible session condition | Treatment |
| --- | --- |
| Busy or retry, with current authoritative connection state | Pulse |
| Waiting for user approval or an answer | Static indication with the existing action prompt taking priority |
| Idle, complete, cancelled or failed | Pulse removed |
| Connection lost or activity unknown | Pulse removed; existing connection status explains uncertainty |
| Another session is busy | No pulse on the idle selected conversation |
| Hidden window or unmounted conversation | No running animation |
| Reduced motion enabled | Static outline while work is active |

Resolve waiting and disconnected states before the busy/retry check. On session
switch, derive the treatment from the new session immediately. Work continuing
on the server does not depend on the indicator's mount or visibility.

### Acceptance

Exercise idle → busy → retry → complete, approval wait, cancellation, disconnect,
reconnect and switching between busy and idle sessions. Check light/dark themes,
reduced motion, keyboard focus, narrow mobile layout and expanded composer.
Screen readers use the existing status text; the decorative layer is hidden
from accessibility APIs and does not announce each pulse.

Compare the same production streaming and switching scenarios with and without
the indicator. Record three comparable captures, frame liveness, p95 frame
time and scripting/paint cost. The indicator must add no polling requests or
JavaScript animation timers, no layout work driven by animation, and no running
animation after idle or hide. Treat performance beyond normal baseline spread
as a finding to resolve before acceptance. An opacity-only implementation is
a design choice, not proof of zero rendering cost.

## 2.4 Adding a project

### Proposed flow

The source request does not identify what currently feels wrong. The proposed
first iteration improves the existing dialog's clarity and recoverability.
Retain path entry with completion, folder browsing, multi-selection, create
directory and clone repository. Use one dialog from all supported entry points.

1. Open the dialog from the sidebar, project settings or command palette.
   Show which host's filesystem is being browsed. Local paths and remote paths
   must not look interchangeable.
2. Enter or browse to an existing directory. Show the selected full path and
   its project label before submission. Existing projects are marked as added.
3. Keep Create folder and Clone repository as explicit operations. An invalid
   existing path never silently turns into a create-directory request.
4. Submit once. Keep the selected paths visible and suppress duplicate
   submissions while the request is pending.
5. On complete success, close the dialog and activate the chosen project using
   existing selection semantics. A multi-add uses the last successful selection
   in the displayed selection order as the proposed deterministic active project.
6. On partial success, show successful and failed paths separately, retain the
   dialog and retry only failed selections. Preserve the currently active project
   until the user finishes or explicitly opens a successful result.

For an already-added single path, offer Open project rather than adding a
duplicate. Identity checks use the existing runtime path rules, including
case sensitivity on the owning filesystem. Display casing follows section 2.1.

### Error, cancellation and runtime behavior

Show path-specific errors beside the selection, retaining the user's input.
Distinguish missing directory, permission denial, unavailable host and clone
failure when the existing API provides that information. Otherwise show its
actual error without inventing a cause. A toast may supplement persistent
feedback but is not the only place the failure can be read.

Closing before submission discards only dialog input. During an operation,
describe the existing cancellation capability accurately. Dismissing a dialog
does not imply that an ongoing clone was cancelled. If cloning or folder
creation succeeds but project registration fails, show the created path and
offer to register it again. Keep the created data; retry must not blindly clone
or create a second copy.

Web, desktop, hosted mobile and Capacitor browse the connected server's
filesystem. Desktop may expose a native picker only when it refers to the
same filesystem or an explicit supported mapping exists. VS Code adds a
workspace folder through the extension host and derives projects from that
authoritative result. An unavailable capability stays visibly unavailable.

### Accessibility and acceptance

Reuse the shared dialog, input, list and button primitives. Give every path
input an accessible label. Support shared arrow-key and Ctrl+N/P navigation,
IME input, visible focus and focus restoration to the opener. Existing mobile
sheet behavior and touch targets remain usable. This design adds no Settings
page or persistent preference, so no new settings layout or search entry is
needed. Revisit settings search only if an existing searchable action moves.

Verify single and multiple additions, already-added paths, case variants,
non-Git directories, slow remote browsing, permission failure, partial success,
retry and clone-success/registration-failure. Test keyboard and touch flows.
The final visible project list must match successful registrations, and the
active project must follow the defined single or multi-add rule.

## Decisions to review

| Decision | Proposed default | Why it needs review |
| --- | --- | --- |
| Casing | Preserve original casing | The original says uppercase display optimization without an exact transform rule |
| Personal release order | Upstream tuple, then personal tuple, with personal downgrade exclusion | This replaces the documented upstream-only policy |
| Pulse placement | Whole conversation outline | The source says conversation box, without choosing container or composer |
| Add-project scope | Existing-dialog clarity and recoverable submission | The source supplies no specific pain point |
| Multi-add activation | Last successful selection in displayed order on full success | Gives a deterministic outcome but is a product choice |

These decisions do not block the design document. Resolve them before the
dependent source changes are accepted. Do not invent a release number now;
apply BUILD.md's feature boundary rule when scheduling the milestone.

## Implementation handoff

Implement the four items as separate reviewable slices. Casing can be checked
first. Release checking needs shared identity and runtime ownership settled
before UI wiring. The pulse needs live-state precedence and visual acceptance.
Project addition needs the concrete pain point confirmed before broadening
the dialog behavior. Assign execution IDs in PLAN.md when implementation starts.

Reuse the canonical module owners named above. Locate current callers and their
nearest DOCUMENTATION.md before editing. Keep runtime API access behind the
existing boundaries and keep new state/operation identifiers in the owning
shared constants or types. User-facing copy uses the repository localization
flow for every supported locale; names, paths and version strings stay literal.

Validation during implementation follows each item's acceptance criteria and
the repository's change-risk rules. Capture actual screenshots for casing,
notification states, pulse and project outcomes. Record platform gaps and
performance results in the execution evidence. This design was checked against
the local source excerpts and linked plans; it does not establish implementation,
runtime performance or a published release.
