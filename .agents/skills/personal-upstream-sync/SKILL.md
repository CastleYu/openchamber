---
name: personal-upstream-sync
description: Sync this repository's personal maintenance branch with the latest community upstream, resolve merge conflicts while preserving personal behavior, validate the integration, and push to the personal fork when requested. Use for upstream intake or conflicts encountered during that intake, not for upgrading an installed app.
---

# Personal upstream sync

Deliver a reviewed merge that retains the personal commit history and behavior. Work on source branches; application update/download mechanisms are not part of this workflow.

## Establish the target

Read root `AGENTS.md`, [branch contracts](../../../docs/maintenance/BRANCHES.md), [personal build policy](../../../docs/maintenance/BUILD.md), and the latest applicable validation record. The historical SHAs in those documents are evidence, not the current upstream target.

Default topology is `codex/personal` for personal maintenance, `upstream/main` for community intake and `origin/codex/personal` for personal publication. Verify it from Git before using it:

```sh
git status --short --branch
git branch -vv
git remote -v
git worktree list
git log -5 --oneline
```

Verify both fetch and push destinations. `origin` should be the user's fork, currently `CastleYu/openchamber`; `upstream` should be community `openchamber/openchamber`. Follow an explicit user-selected branch/remote instead of replacing their configuration. Resolve a genuinely ambiguous destination before a remote write.

An upstream-sync request authorizes the necessary local Git integration. Push only when the user requests publication or has already authorized it in this task. Do not request the same permission twice. A request to write or edit this skill does not itself request an upstream merge.

If another merge, rebase or cherry-pick is already in progress, inspect its ownership and intent. Resume it only when it is the requested integration; do not abort someone else's operation. Record the personal base SHA, remote destinations, dirty paths and any staged changes before continuing.

## Fetch and isolate

Fetch the verified community branch and fork before comparing commits. A failed fetch means the latest upstream is unknown; do not substitute an old remote-tracking ref and call it current. Record the fetched upstream SHA and time. Pin that SHA for this integration so an advancing remote does not move the target during conflict resolution.

Compare the personal branch with both the fetched upstream and the fork's personal branch, if it exists. Use `git rev-list --left-right --count`, `git log --left-right --cherry-pick --oneline`, and `git merge-base --is-ancestor` as appropriate. Rewritten equivalent patches can produce large ahead/behind counts; do not treat that as permission to force-push or replay every commit. If the fork has new personal commits, reconcile them in the integration branch before community intake. Keep both sides' non-equivalent changes.

Create a uniquely named backup ref at the personal base and a temporary `codex/sync-...` integration branch from that base. Prefer a separate worktree under `.worktrees/` so the user's working tree stays untouched. Record its absolute path and branch. Preserve the original branch, backup, and any pre-existing stashes.

If updating the original checkout later requires parking dirty changes, use a uniquely named stash with untracked files included and record its exact object ID. Preserve the original staged/unstaged split. Do not use a moving `stash@{0}` reference to identify that backup after other operations. Ignored files are not captured by `stash -u`; use the isolated worktree whenever those files would otherwise be at risk.

If the pinned upstream is already an ancestor and the fork adds no missing personal work, there is no merge to create. Report the checked SHAs; perform only an independently authorized outstanding push.

## Merge and resolve

Before changing conflicted code, load the applicable implementation skills and nearest owning documentation required by `AGENTS.md`. Merge the pinned upstream SHA into the integration branch with `--no-ff --no-commit`. Check the result immediately. Do not let a failed merge flow into an unconditional commit or push.

For each conflict:

1. Read the common ancestor, personal side, upstream side and actual callers. `git show :1:path`, `:2:path`, and `:3:path` expose conflict stages where they exist. Account explicitly for additions, deletions and renames, where a stage may be absent.
2. State the user-visible personal contract and what upstream changed. Implement the combined behavior at its owning layer. A personal requirement wins on product policy, but its old implementation may need adaptation to the new upstream architecture.
3. Update callers, tests and owning documentation when a contract changed. Stage only the resolved paths and inspect their staged diff. Avoid whole-file `ours`/`theirs` decisions unless every discarded change has been accounted for.

Treat these files as coupled decisions:

- Workspace manifests, SDK pins and `bun.lock`: retain upstream dependency evolution while preserving the personal build entrypoint. If regeneration is required after resolving manifests, use the repository's pinned package manager; do not hand-splice generated lockfile conflicts. Unrelated new dependencies still need explicit authorization under root rules.
- `personal-build.json`, desktop update handlers, Web/CLI install gates and update UI: preserve independent personal versioning and notification-only enforcement, including direct calls. An upstream version bump alone does not reset or increment the personal feature version.
- Build scripts and workflows: preserve portable as the personal default, artifact-only CI and protection against publishing upstream installer/update feeds from the fork. Read existing workflow triggers before an authorized push.
- Session/sync/performance code: use the personal feature checklist in the branch document. Retain demand-scoped loading, authoritative live state and lifecycle cleanup through the new upstream structure, not just matching setting names.
- Locale dictionaries: retain complete keys in every supported language while preserving unrelated user edits.
- Upstream-generated release files: carry upstream changes as part of the merge. Do not author personal changelog entries or regenerate release files unless requested.

A conflict-free merge still needs review for semantic regressions. If a conflict requires a new product decision, record the competing behaviors and ask that specific question while continuing independent resolutions. Do not silently drop the personal feature or invent a broader redesign.

## Maintain the Settings update history

Every upstream integration updates `packages/ui/src/content/update-history.md`,
and its complete Simplified Chinese counterpart `update-history.zh-CN.md`,
the durable sources bundled by Settings → Update history. Read its scope and the
`updateHistory.ts` parser contract first. It is independent of
`changelog/unreleased.md` and survives release-note promotion and reset.

Compare pinned upstream release notes, commits and merged PR descriptions with
the history. Preserve prior official and personal entries; fold follow-ups into
the affected behavior without losing user-visible outcomes. Use
`Official <version> / ...` and `Personal / ...` prefixes under the existing
App/VS Code and New/Improvements/Fixes/Misc headings. Retain contributor credits
and distinguish superseded historical behavior from current behavior.

Change `not merged` labels only when those changes are in the validated merge.
Update the scope/version paragraph and retained or adapted personal behavior.
Check the VS Code surface map before assigning extension entries. Record remaining
coverage gaps; release titles alone are not sufficient evidence. Translate each
new or changed entry into Simplified Chinese in the same integration. Keep entry
order, platform/group/source, versions, credits, links and not-merged labels aligned
with English. Verify the body changes with the interface language while filters
stay selected; translated controls alone do not complete history localization.

Run the update-history and Settings-search tests, check that no authored bullet
was lost, and verify the Settings page. Changelog authoring and generated files
still follow the explicit-request gate in `update-changelog`; this required
history update does not authorize regeneration.

## Validate and promote

Require `git diff --name-only --diff-filter=U` to be empty and inspect `git diff --cached --check`. Review the full integration diff against the personal base, including automatic resolutions. Apply the validation rules from `openchamber-change-discipline` and each affected module; derive commands from current package scripts.

Run affected upstream and personal regression tests. When manifests/lockfiles change, reconcile with `bun install --frozen-lockfile` after producing a valid lockfile. Shared contracts require workspace checks. Packaging/update changes require the personal policy tests and applicable build/runtime checks, including an isolated launch for native behavior. Docs-only intake needs only relevant document validation. Do not infer measured performance gains or native correctness from type-check.

Compare failures with the recorded base or a reproducible clean-base run. New failures or unverified personal behavior in a touched area block promotion. Report reproducibly pre-existing failures separately; neither suppress them nor present the run as fully green. Put unresolved work and its evidence in the maintenance task queue.

Commit the resolved integration with the repository's commit convention and a Chinese main description. Verify that both the original personal base and the pinned upstream SHA are ancestors of the integration tip. Record the resulting SHA, conflict decisions, checks and limits in a dated file under `docs/maintenance/evidence/`. Commit that record as a docs-only follow-up before promotion; it identifies the validated merge SHA rather than attempting to contain its own commit SHA.

Before promoting, confirm the personal branch still equals the recorded base. If another actor advanced it, integrate that work and revalidate the affected result rather than resetting it. Fast-forward the personal branch to the reviewed integration tip. If its checkout is dirty, preserve it as described above before the fast-forward. Apply the exact recorded stash with `--index` when needed, verify tracked/untracked content and the original staging split, and keep the backup until restoration is confirmed. A stash-apply conflict is a separate unresolved user-change restoration, not a successful sync.

## Publish when authorized

Use an explicit remote and refspec, such as `git push origin codex/personal:refs/heads/codex/personal`, after rechecking the verified fork destination. Preserve the existing upstream-tracking setup; avoid `push -u` changing it from community intake to fork publication.

Push only the personal branch requested, not all branches, tags, fork `main`, or community `upstream`. A non-fast-forward rejection means someone advanced the fork. Fetch, reconcile and revalidate; never bypass it with force. If network/auth fails, report the local commit and failure without changing credentials or remotes. Verify the remote tip with `git ls-remote` after success.

The personal workflow starts on the verified fork's personal-branch push. It
builds and automatically publishes a new DIJIANG version after source and asset
verification. Published versions are skipped; another release requires a deliberate
version increment. Read `docs/maintenance/BUILD.md` before pushing so publication
intent covers that consequence. Report build and publication separately, including
the release URL and matching source SHA when complete.

## Recovery and handoff

Before promotion, an unsalvageable merge can be aborted in the task-owned integration worktree. Keep evidence and the backup; leave the personal branch and original dirty work intact. After publication, use a reviewed revert rather than rewriting shared history. Delete only task-owned, verified-clean worktrees when they are no longer needed; do not prune unrelated branches, stashes or worktrees.

Report the personal before/after SHAs, fetched upstream SHA, conflict decisions, preservation/restoration outcome, checks and failures, remote tip if pushed, and remaining backup/evidence paths. Distinguish completed local integration, restored user edits, remote publication and CI acceptance. Record environmental command failures in the project failure notes and use the documented fallback instead of repeating the same failed command.
