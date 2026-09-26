# Dual-kernel validation design

Owner: primary agent. Status: partially executed; final acceptance is in progress.

## Baselines and evidence

- OC1 personal source: `4ac81115c17c203c89c5b52f93a930af32ea2163`.
- OC1 official feature reference: `v1.24.2` / `614d7f7`.
- OC2 reference: `v2.0.1` / `63bd5070c8620432817e1e67de77791f801bcf3e`.
- Treat OC1 as one generation for this delivery. The maintainer explicitly authorized using the currently available OC1 runtime; 1.2.27-specific testing is deferred and is not a release gate. Record the version actually exercised.
- The real conversation gate passed with OpenCode 1.18.32 and 2.0.16 in isolated profiles `real-conversation-oc1-QgTrQN` and `real-conversation-oc2-QKBE0X`. Both runs exercised catalog recognition, prompt submission, two streamed text chunks, persistence, idle completion, interruption, event delivery and cleanup. OC1 preserved native metadata replacement; OC2 preserved sibling fields and deleted an explicitly null field. This is core conversation evidence, not acceptance of every inventory or product row.
- Browser checks confirmed both kernels render the two text chunks and interrupted partial reply. OC1 retains its old turn statistics and hides OC2-only Stats, Web search and agent notify controls. OC2 Stats showed 1 session, 2 prompts and 19 tokens; its Web search panel loaded. The timer receiver error was fixed and did not recur in the rebuilt UI. No external Web search or paid model request was made.
- Real OC2 fork checks confirmed that `before=next user` preserves the preceding assistant answer and excludes the next user; omitting it copies all 9 messages. The rebuilt browser also verified `/fork` autocomplete, creation and selection of the correctly titled fork with an empty composer. OC2 model/effort restoration uses the session record. File-backed goal inheritance and rollback are covered by UI/server contracts.
- Focused permission-scope DOM tests (2), sidebar tests (2), font tests (2) and table tests (3) passed. Descendant activity, deferred completion and runtime-source replacement have UI/server contracts. These checks are not claims of live external permission or platform-specific asset delivery.
- Every existing OC1 feature is required. First core-path tests are an implementation milestone, not a reduction of the delivery scope.
- Add a row for every inventory operation: old/new contract, owner, applicable runtime, test, result, evidence path. Unknown rows block a completeness claim.

## Automated gates

1. Establish focused OC1 baseline tests in the restored checkout using its pinned Bun. Keep upstream and personal baseline failures separate from regressions.
2. Unit tests cover generation detection, capability decisions, request and response projections, event identities, permission/question mapping, configuration serialization and plugin selection. Use independent fixtures grounded in the pinned SDK/source, not fixtures generated from the adapter under test.
3. Contract integration tests run each real adapter/client against a local HTTP/SSE test service enforcing generation-specific methods, paths, query, headers, request bodies and status/error responses. Assert that unsupported operations are rejected before dispatch.
4. Exercise full state chains without a paid model: bootstrap, create, prompt, text and tool deltas, approval/question wait and answer, completion, abort, reconnect, duplicate and out-of-order events, paging, partial failure and runtime switch. Verify no duplicated text/tool rows, premature idle, queue double-send, cross-runtime state or failure-as-empty replacement.
5. Preserve automated coverage for old fork/compaction, queue, scheduled tasks, assist/goal, memory, skills/MCP, auto-review/multi-run, existing usage and every DIJIANG contract in the maintenance checklist. Configuration tests must prove OC1 writes never produce OC2-only format. Metadata tests use each generation's actual persistence owner.
6. Run applicable web/desktop/VS Code/hosted mobile/Capacitor transport contracts. Shared UI type-check alone is insufficient for proxies and server JS. Preserve authentication, abort signals, SSE cancellation and external-server ownership.
7. Run package-script workspace type-check/lint/test and affected builds after all integration changes. Run authored-file oxlint and dead-code when import/export shape changes. Record exact source SHA, command, runner, exit code and failed cases. Broaden diagnostic reruns only for an identified failure.

## Minimal real-runtime gates

- Use isolated OC1 and OC2 config/data directories and task-owned ports/processes. Never upgrade or reconfigure the restricted environment's server to make a test pass.
- Start real pinned binaries and test health, catalog, sessions and event subscription through OpenChamber. This catches SDK/stub mismatch without paid generation.
- One compact real conversation per supported generation covers catalog activation, streamed reply, persisted history and interruption. Keep tool, permission/question and reconnect permutations in protocol/state integration tests, following the maintainer's request to move broad coverage into automated tests. Record these as contract evidence rather than live tool/provider acceptance. Use the currently available OC1 version as authorized by the maintainer. Do not claim separate 1.2.27-specific evidence.
- One packaged Windows lifecycle smoke verifies version/selected kernel, loading bundled assets, connection, notification-only update behavior and shutdown. Do not infer native/mobile/relay runtime proof from desktop tests; label remaining platform evidence explicitly.

## Publication gates

- Review every inventory/task row and all agent changes; no unresolved conflicts or unfinished compatibility placeholders.
- Protect original dirty files and preserve personal branch ancestry when promoting the reviewed implementation; never force-push.
- Increment DIJIANG feature version for this new capability under BUILD.md; upstream version reflects the actual integrated baseline, not only the reference checkout.
- Release through the existing fork personal portable workflow after local gates. Verify workflow source SHA, build and publish jobs, tag SHA, assets and hashes. A release must not advertise full OC1 support based solely on mocks.
- Stop optional repeated tests once gates pass; failures retain the exact logs and go to the responsible implementation owner.

## Remaining acceptance

The 43 interface rows and 154 product rows are tracked in the adoption and
product ledgers. The final focused runner passed 86 tests across 14 isolated
files; the final CI Web selection passed 119 tests across nine files, and the
publisher/runner Node tests passed 10 cases. The broader changed-test run passed 52 server files (760 tests, one
skip) and initially passed 186 of 191 UI/VS Code files. All five failing files
were corrected and independently rerun, alongside the final model/menu/sync
changes: eight files, 140 tests, zero failures. This is a targeted correction
run, not a second full-suite run. Frozen dependency installation, the final
workspace type-check and Web production build passed with Bun 1.4.2.

The sanitizer remains DOMPurify 3.4.15. Its unsupported Happy DOM fixture was
replaced with test-only jsdom 28.1.0 after a clean-baseline comparison; renderer
assertions and sanitizer behavior were retained.

Local portable packaging passed web staging, OC1 CLI 1.18.31 verification and
main bundling, then stopped at node-pty MSB8040 because the installed Visual
Studio lacks Spectre libraries. The CI Windows build and downloaded portable
host smoke remain publication gates. No native/mobile device or live external
OAuth, MCP or permission workflow is claimed by the contract tests. Earlier
failed attempts remain recorded as failures.
