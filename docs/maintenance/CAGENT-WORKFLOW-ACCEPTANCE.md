# CAgent workflow acceptance

Status: requirement, 2026-10-09. No real CAgent model or workflow has been evaluated. This document owns task-quality admission under the [CAgent architecture](CAGENT-INTEGRATION-SPEC.md). The [adapter workbook](CAGENT-ADAPTER-WORKBOOK.md) owns authoring-model calibration and protocol adaptation. [Chinese review copy](zh-CN/CAGENT-WORKFLOW-ACCEPTANCE.md).

## Two independent decisions

An accepted adapter proves documented requests, normalized results and operation semantics. It does not prove that the backend model follows instructions or produces correct work. The environment-local authoring model's calibration also says nothing about the runtime CAgent model's quality.

Keep operation support and workflow admission separate. An accepted operation can remain available for interactive use while an unattended workflow using it remains unavailable. A workflow-quality failure must not relabel the API operation `unsupported`. Preserve the observed reason in the capability summary and enforce workflow admission in the owning host caller before dispatch.

## Admission record

The architecture owner defines the finite workflow IDs from the current autonomous callers. The local maintainer supplies and reviews the evidence; the adaptation agent cannot approve it. Keep this record outside the writable adapter workspace.

| Field | Required meaning |
| --- | --- |
| Workflow and callers | Stable workflow ID and all UI, direct and browser-closed callers governed by it. |
| Scope | Accepted adapter revision, server contract, workspace policy, runtime model/configuration provenance and workflow instruction revision. Unknown provenance is recorded explicitly. |
| Protocol prerequisites | Operation support, authorization, readiness, observable outcome, required decisions and cancellation from the existing dependency registry. |
| Quality evidence | Locally frozen task IDs, expected observable results, actual results, instruction violations and maintainer interventions. |
| Admission | `unverified`, `interactive-only` or `unattended-approved`, with reason and approving maintainer. Interactive availability still requires the minimum chat and operation gates. |
| Change handling | Facts whose change invalidates the decision, and how unknown in-flight outcomes are preserved. |

This is a workflow record, not an adapter-controlled capability declaration. Add named constants and a typed contract in the owning host during implementation. The host computes effective workflow availability from this record and the existing capability checks. A quality approval cannot override a missing protocol prerequisite.

## Local acceptance sequence

1. The maintainer freezes a small, representative task set for the specific workflow before running the runtime model. Include a normal task, an ambiguous input that requires clarification, missing information, and a failure or interruption relevant to that workflow. Define expected observable outcomes and permitted effects for every task.
2. Run against an isolated workspace using the actual application caller and accepted adapter. Record incorrect results, ignored instructions, unexpected effects, failed decisions and any human intervention. Keep raw documents and model output inside the environment; export sanitized result references only.
3. Review results per workflow. An average score or successful HTTP response cannot waive a failed required case. Approve unattended execution only when every required case and protocol prerequisite passes without human intervention. Otherwise keep that workflow unavailable for unattended use and retain independently accepted interactive/read-only functions.
4. Recheck after a runtime model/configuration, workflow instruction or relevant server-contract change. If the accepted scope cannot be established, suspend unattended admission. Preserve queued intent and unknown request outcomes; do not replay them to another model or backend automatically.

Tests characterize the recorded scope; they do not guarantee arbitrary future answers. Keep the existing bounded effect, authorization and outcome checks active after admission. This requirement does not add a model router, automated prompt optimizer or fallback model.

## Feature report and extension consequences

The feature disposition report links backend-dependent autonomous features to their workflow admission record. A disabled reason distinguishes missing API semantics, incomplete host implementation and insufficient task-quality evidence. The same reason applies to UI and direct callers.

A new CAgent action still follows the finite typed extension contract. API validation and live acceptance establish that action's behavior. If an autonomous workflow uses it, that workflow additionally needs task-quality admission. A new interaction requiring host development remains disabled until its owning host implementation passes acceptance.

## Milestone evidence

CA-01 implements admission checks in the affected host callers and proves direct-call refusal with a synthetic quality rejection. CA-02 supplies protected examples for independent protocol success and workflow failure; these examples cannot authorize a real workflow. CA-03 records the real workflow dispositions and local maintainer decisions. A usable interactive CAgent path can complete CA-03 with unattended features explicitly disabled; approving every autonomous feature is not a prerequisite.
