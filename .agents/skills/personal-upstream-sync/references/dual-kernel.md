# Dual-kernel intake

Use this branch of personal upstream sync when a supported OpenCode generation differs from the upstream application's native generation. Start with the [adoption ledger](../../../../docs/maintenance/DUAL-KERNEL-ADOPTION.md) and the requested upstream delta. During first adoption, read the [interface inventory](../../../../docs/maintenance/DUAL-KERNEL-INTERFACES.md), [architecture](../../../../docs/maintenance/DUAL-KERNEL-ARCHITECTURE.md), [tasks](../../../../docs/maintenance/DUAL-KERNEL-TASKS.md), and [validation matrix](../../../../docs/maintenance/DUAL-KERNEL-VALIDATION.md). During later updates, load only changed inventory rows and their owning module references; reopen the architecture when a changed contract crosses its boundaries. The first-adoption task list is historical context, not a recurring checklist to repeat in full.

## Establish three baselines

Record the current personal source SHA, the last reviewed upstream comparison SHA, and the new upstream target SHA. Record the retained product baseline and OC1 feature-reference SHA separately. The comparison SHA advances when its full delta has dispositions in the adoption ledger, even if some entries are intentionally not adopted. A package version, a merge ancestor or the contents of a reference checkout do not prove feature adoption. A reverted upstream commit remains an ancestor.

For first adoption, preserve the existing checkout and dirty files, identify the last personal OC1-compatible commit, and create an isolated development checkout there. Keep a separate pinned latest-release upstream checkout for comparison. Retain later personal fixes and documentation only after inspecting their behavior and evidence. Restore the original published branch through reviewed new commits; preserve history and unrelated user changes.

For later updates, compare the last reviewed comparison target with the newly fetched target. Carry forward prior dispositions; reopen a deferred item when its implementation, dependencies or maintainer policy changes. The retained OC1 product baseline is not the recurring diff start. Do not repeat the first-adoption rollback or rescan the entire old product without a concrete coverage gap.

## Classify before merging

Generate the union of old and new consumed operations across UI clients, server helpers, realtime events, configuration, plugins, persisted state and VS Code bridges. Include direct requests outside the principal SDK wrapper. Identify endpoint method/path as well as payload, result, event and lifecycle semantics. A renamed route can be a migration; identical paths can carry changed contracts.

Each row records stable identity, source evidence on both sides, unchanged/changed/new/deleted/migrated classification, semantic delta, feature owner, OC1 decision, OC2 decision, implementation files and validation evidence. Deletion means confirmed removal of the old contract; absence from the client's new callsites alone is not proof of deletion from OpenCode. Keep unconsumed upstream APIs separate from the application's integration obligations.

Retain the maintainer's policy:

- Existing OC1 functionality remains available with its original behavior, including queue, scheduling, assist/goal, questions, fork, compaction, memory, skills/MCP, review/multi-run, usage statistics and DIJIANG features.
- Changed upstream behavior selects the original OC1 implementation when connected to OC1.
- Genuinely new upstream functionality is disabled for OC1 unless the maintainer separately authorizes a backport. New names, new UI presentation and new SDK method names do not establish a new feature.
- OC1 minor-version simplification is a design assumption, not evidence of actual 1.2.27 support.

## Design and split

Retain upstream owning modules and directory layout wherever possible. Put protocol differences at actual request/event/config/plugin/storage boundaries. Share established business behavior; preserve separate implementations when semantics differ. Do not copy the entire application, introduce a network gateway, or replace working upstream contracts with a general abstraction solely to reduce apparent duplication.

Before implementing, compare the proposed abstraction's current diff and future conflict surface with localized version implementations. Record the chosen tradeoff. Partition work by non-overlapping files and dependent contracts, with acceptance tests for every inventory row. Independently review task coverage before implementation.

Use the maintainer's requested delegation: Sol medium for interface inventory, task decomposition and task review; Astra medium for architecture; Luna medium for bounded implementation and test execution; Sol medium for complex implementation; Astra low for implementation review. Escalate a blocked Luna task to Sol low with its exact evidence. The primary agent owns test design and final acceptance. Delegate only independent useful work and inspect the actual changes.

## Validate and publish

Use the committed dual-kernel validation matrix. Prefer unit and HTTP/SSE contract integration tests for broad behavior; retain small real-kernel and packaged lifecycle gates for boundaries a fake service cannot prove. Require all retained OC1 feature rows and new OC2 feature rows to have an implementation and result. No empty-success fallbacks or unimplemented placeholders count as compatibility.

Check generation switching, config output format, metadata ownership, external-server process ownership, and unsupported operations at the server as well as UI. Complete shared-runtime checks across web, desktop, VS Code and mobile contracts; report unexercised platform runtime evidence accurately.

Maintain an adoption ledger of upstream changes and an OC1 behavior ledger. Record skipped/deferred upstream work with its reason; do not label the whole target adopted if required features remain unfinished. The release's upstream version must describe its actual integrated product baseline. Update bilingual Settings history and DIJIANG version under existing policy.

Follow the parent skill for dirty-file restoration, reviewed commits, promotion and publication. Existing upstream ancestry after a rollback does not satisfy integration acceptance. Reconcile reviewed source trees and commits, verify the invoking and formal release branches, and preserve the original dirty/staged split. Run the personal fork's existing CI, verify Release/tag/source/asset hashes, and report completion only after both build and publication succeed.

Completion: the target delta is fully classified; retained OC1 and adopted OC2 behavior are accounted for; the reviewed implementation reaches the invoking/formal branch; validation evidence identifies actual kernels and source; original user changes are restored; an authorized release is verified.
