# R1 acceptance review

Reviewed 2026-10-11 against candidate 7be9a791b548f7b89115291abedf94bff79a0a41. R1 remains open. This review supplements the [milestones](OPENCODE-INTEGRATION-MILESTONES.md); it does not change their gates.

| Requirement | Evidence inspected | Assessment |
| --- | --- | --- |
| Identity, selection and profile retirement | compatibility, kernel operation and SDK retirement contracts; int02-r1-sdk-evidence.json | Contract evidence exists. Latest host run passes 366 tests with one skip across 12 files. |
| Five modes, migration and persistence | int02-r1-current-modes-evidence.json | 40 real Windows OC2 checks at baseline 805881f73. Historical host evidence, not a model conversation. |
| Owned processes, failed cleanup and external preservation | int02-queue-evidence-native-evidence.json; occupied-port and console-window evidence | Real Windows evidence exists. Keep its recorded source scope. |
| Pending activity, queue intent and previous-target recovery | int02-pending-host-evidence.json; int02-queue-target-final-evidence.json; peer-browser-cleanup.json | Production-host, synthetic activity and real IDE checks have separate evidence. Browser closure is not directly covered by the inspected queue test names. |
| Actual connection Test/Cancel and session discovery | int02-r1-zero-evidence.json and int02-r1-native-evidence.json | 44 actual VS Code checks pass with real OC2. No model conversation. |
| Direct SDK consumers | int02-r1-consumer-evidence.json and CAGENT-BOUNDARIES.md | Six retained getter consumers have documented guards or migration ownership. Current fingerprints are recorded in int02-r1-clause-audit.json. |
| Dynamic HTTP and generated/host consumers | SPEC 3.1 and the route-owner trace below | Open. The existing inventory contains tentative classifications and does not prove every retained escape is guarded. |
| Existing-feature regression | int02-r1-zero-evidence.json | UI checks and Web/VS Code builds pass. Sync passes 81/82 files; the retention test still exceeds its default timeout. Its 22-test suite passes with a 30-second timeout. |

## Image message boundary correction

At baseline 7be9a791b, the Markdown image grant route used a hardcoded OC1 message URL before host filesystem authorization. It lacked family/profile admission and retired-result checks. The correction reads a projected message through kernelOperations.getMessageView and checks both kernel identity and backend family/revision after asynchronous work. CAgent and unaccepted Legacy are refused before directory, backend or filesystem work. The VS Code filesystem bridge retains its deliberate 501 response.

Exact-source matching, code-fence exclusion, file signatures, workspace/temp-root restrictions and per-image failures are preserved. Focused tests cover both real SDK routes against a loopback fixture, missing-message 404, upstream-failure 503, admission refusal and retirement during directory validation, message reading and file inspection. These fixtures establish the route contract, not live upstream or packaged-runtime acceptance. No transport, cache or retry layer was added. Verification and final source fingerprints are recorded in artifacts/int02-r1-image-evidence.json.

Runtime scope: Web and Electron use the shared host route; hosted and Capacitor mobile use their selected host; VS Code retains its explicit unsupported response. Real CAgent mapping remains CA-03. Neutral consumer migration remains R6, but an unguarded existing escape is not accepted merely because migration is later.

The host event stream /api/openchamber/events is owned by scheduled-tasks/routes.js. /api/notifications/stream is owned by notifications/routes.js and invokes the session watcher before streaming host notifications, so backend observation still needs its guarded owner. Config routes mix host settings with OpenCode entity writers; config-entity-routes.js uses the existing family guard. These traces classify ownership; they do not constitute runtime acceptance of all callers. Next inspect profile admission in global-hub.js and watcher.js, and family/revision admission for the direct OC2 worktree disposer in git/routes.js. Existing family-retirement tests do not establish Legacy stream refusal. Generated managed-plugin and bridge callers still need reconciliation.

Detailed test references and source fingerprints are in artifacts/int02-r1-clause-audit.json. Preserve historical evidence without rewriting its old status. Accept this correction and reconcile the remaining route/plugin/bridge rows before declaring R1 complete. Packaged runtime acceptance stays R7 and exact 1.2.27 conversation stays R2.
