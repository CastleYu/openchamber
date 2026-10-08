# CAgent local adaptation workbook

Status: planning template, 2026-10-08. Use after CA-02 delivers the executable kit described by the [CAgent SPEC](CAGENT-INTEGRATION-SPEC.md). This document contains no guessed CAgent API paths. Every placeholder below remains unresolved until populated from local documentation and evidence.

## Packet delivered into the environment

The [operation references](cagent-contracts/README.md) and [reference generator](../../scripts/cagent/DOCUMENTATION.md) are available now. Their checked schemas and bilingual examples are one kit component. CA-02 still must supply the complete executable bundle, protected packets, mapping/extension templates and isolated acceptance commands below.

The architecture owner must provide these artifacts together at a frozen application/contract revision. CA-02 acceptance fails if a file or executable command is merely promised.

| Artifact | Required contents |
| --- | --- |
| START-HERE | Exact offline setup and check commands, supported toolchain, kit/app digest, contract version, file allowlist and restore steps. |
| Adapter workspace | Compiling disabled-by-default skeleton, generated operation constants, typed requests/results, bounded transport/auth hooks and explicit registration point. No whole-repository editing required. |
| Contract reference | One short page per operation with required semantics, successful/failed/unsupported examples and related feature IDs. Separate required fields from optional enrichment under the [consumer contract](CAGENT-CONSUMER-CONTRACT.md). |
| Mapping and capability templates | Schema-validated records from the tables below, generated coverage report and reasons for blocked features. |
| Extension template | Fixed form/result vocabulary, namespaced action constants, handler stub and negative tests. |
| Verification kit | Protected reference fixtures and tests, sample adapters, offline fixture runner, isolated live-check runner, changed-file and feature-dependency checks. |
| Task packets and report | One operation per packet, ordered by dependencies; resumable result records, local evidence report and artifact manifest. |

The kit commands must return nonzero for failed required checks and produce a concise machine-readable result with operation ID, expected/actual outcome, evidence reference and next action. Keep raw secrets and user payloads out of output. The local agent receives the relevant packet and contract page, not all repository instructions as one large prompt.

## API evidence intake

The local maintainer supplies endpoint/auth references and the API documentation within the environment. The agent records the document revision, server build when known, and exact section for each mapping. Keep source documents and samples local; no external upload is required. An external handoff may contain only an approved sanitized coverage summary.

| Mapping field | Fill rule |
| --- | --- |
| Operation ID / consumers | Select generated constants and the fixed feature registry; never invent a core operation ID. |
| Evidence | Local document revision and section, sanitized fixture IDs, server identity and test result. |
| Transport | Documented method/path, path/query/body fields, auth reference, timeout and cancellation. Do not infer routes from OpenCode. |
| Scope and IDs | Session/workspace mapping, pagination, opaque ID stability, remote versus local path meaning. |
| Success and failure | Response parser, status/error mapping, absent/null/empty distinction, validation failures and side effects. |
| Async behavior | Acceptance response, status/event source, terminal evidence, decision requests, reconnect and unknown-outcome handling. |
| Support | `unverified`, `supported`, `adapted` or `unsupported`, with limitation and evidence; runtime availability is separate. |
| Implementation | Generated handler/codec files allowed by the packet, fixture and live-check references. |

Blank fields required by an operation block its support claim. Mark a documented missing operation unsupported with its source. If the documentation is silent, mark it unverified and record a precise question. An auth error is not proof of absence.

## Documentation-to-adapter decisions

The kit converts supplied API documentation into a local endpoint inventory before generating implementation packets. Each endpoint row retains a document section, method, path, request/response definitions and effect classification. OpenAPI input can populate structural fields deterministically. Prose input produces candidate rows with source excerpts; the local maintainer checks those rows before they authorize calls. Examples alone do not establish error, pagination or completion semantics.

Compare that inventory with the frozen shared operations in both directions. Every shared operation receives a mapping or a specific evidence gap. Every documented CAgent endpoint receives a shared-operation mapping, a namespaced extension disposition or a reason it is outside the current product scope. Multiple endpoints may implement one operation, and one endpoint may serve several operations; endpoint counts do not prove feature coverage.

| Mapping result | Work given to the local agent | Activation gate |
| --- | --- | --- |
| Same semantics, different method/path/field names | Fill declarative mappings; the kit generates the handler and constants. | Request matching, response validation and real operation acceptance. |
| Verified semantic difference | Implement one bounded typed codec in its packet, with the documented difference and fixed examples. | Negative fixtures and live checks prove required semantics are preserved. |
| Documented absence or incompatible required semantics | Record unsupported with the cited section and affected feature IDs. | Host and UI refuse the dependent feature; no substitute success is fabricated. |
| Silent, conflicting or incomplete documentation | Record unverified and a precise question; retain the incomplete mapping. | The maintainer supplies evidence before implementation or activation of that operation. |
| Additional CAgent capability | Use a shared operation if equivalent, otherwise the fixed extension template. | Extension acceptance, or `requires-host-development` when the template cannot express the interaction. |

The weak agent must not choose protocol architecture, synthesize undocumented routes, or change feature dependency rules to make a mapping fit. Accepted packets remain available when another packet stops. A resumed packet loads its mapping, current generated stub, smallest failing fixture and previous result record. It does not need to reconstruct decisions from conversation history.

CA-02 tests this intake with supplied sample documentation containing a renamed field, a semantic difference, a documented missing operation, a conflicting definition and a new capability. The expected dispositions are protected reference data. The kit must reject a guessed route or an enabled capability without its acceptance evidence. These are sample-kit checks, not findings about the real CAgent API.

## Operation-sized work sequence

1. Run the untouched kit baseline. Record its revision and check output. Stop for setup defects; do not repair shared contracts or dependencies inside the adapter task.
2. Bind one explicitly selected CAgent endpoint and an existing secret reference. Complete the read-only identity/workspace packet. Use an isolated test workspace and keep the adapter disabled for ordinary users.
3. Fill the relevant mapping row from documentation before editing code. Generate the stub and use the supplied transport helpers. A fixture request must match method, path, headers, body and scope, not merely return a matching response.
4. Implement one parser/operation and run the fixed packet tests, including absent fields and failure cases. If the packet fails twice for unclear semantics, stop that packet with the smallest failing sample and question; keep unrelated accepted packets intact.
5. Deliver the minimum interactive path: conversation binding/creation, dispatch, observable completion and reopen/history if supported. Add decisions before enabling any server mode that can demand them. Add attachments, cancellation and other features only through their own gates.
6. Complete the remaining feature inventory. Run capability dependency checks and direct host-dispatch tests with the UI closed. Each unsupported or unverified dependency must produce a disabled feature and preserve existing queued intent.
7. Inventory every CAgent API feature absent from the shared operation list. Map equivalent semantics to a shared operation; use the extension template for supported form/action/result interactions; otherwise record `requires-host-development` with a concrete interaction example.
8. Run local live checks and host journeys. Record adapter/server versions and evidence for all enabled features. A local maintainer reviews the report and explicitly enables the accepted adapter revision. Keep the last accepted revision for restoration.

The generated task packet has these fixed fields: operation ID, goal, documentation excerpt references, required input/output semantics, allowed files, fixture IDs, exact check command, success criteria and stop conditions. The architecture owner freezes the packet format; the local agent fills only the implementation and result fields.

## Weak-agent packet execution

The protected runner selects the next packet from satisfied dependencies. The local agent receives only that packet's contract page, cited API excerpts, allowed files and smallest failing example. The runner generates names, imports and registrations. The agent fills documented mappings or one bounded codec; an unresolved semantic question returns to the maintainer before code generation continues.

Keep packet progress separate from capability support and production activation:

| Packet checkpoint | Required evidence | Next action |
| --- | --- | --- |
| Mapping ready | Required fields cite local documentation and preserve the contract semantics. | Generate the allowed stub and fixtures. |
| Fixture checks passed | Protected checks validate request construction, result/error parsing and semantic failure cases. | Submit the candidate for isolated live checks. |
| Live evidence reviewed | The maintainer reviews real operation results and dependent feature behavior at the recorded revisions. | Include the operation in an explicitly accepted adapter revision. |
| Blocked | A missing section, conflicting definition or reproducible failing case is saved. | Request the specific evidence or host change; continue independent packets. |

These are workflow checkpoints, not additional runtime capability states. The runner records checkpoint results; model-written success text cannot advance them. Its failure output names the operation, check ID, sanitized expected/actual difference and one next action. It uses fixed file paths and commands, so the agent does not choose a test runner or repair repository setup.

The packet result file retains the documentation references, candidate files, checks and unresolved question. Resume from those artifacts in a fresh context. After two unsuccessful correction attempts, return the smallest remaining failure to the maintainer; the candidate remains disabled. Fixture passage alone never authorizes a real mutation or activates a capability.

CA-02 must rehearse this workflow from a fresh offline context: complete a structural mapping packet, stop a conflicting-documentation packet, and resume an interrupted packet using only saved artifacts. Record the actual executor/model when one is used and distinguish a scripted runner test from a model trial. CA-03 additionally records a trial with the environment's actual local agent; failed packets remain disabled and can be completed by a maintainer without weakening acceptance checks.

## Local model calibration and task assignment

Before real API implementation, the protected runner supplies three small tasks with known answers: fill a structural mapping, implement one documented semantic conversion, and report a deliberately missing required semantic without guessing. Each uses the normal packet limits and protected checks. Record the actual model/build, prompt language, input size, correction count and observed boundary violations. These samples assess authoring workload; they establish no CAgent capability.

Assign work from the observed results rather than a model name or its claimed confidence:

| Observed result | Allowed authoring work | Owner of remaining work |
| --- | --- | --- |
| Mapping and evidence-gap checks pass; semantic conversion fails | Fill schema-validated declarative mappings. The generator produces code. | Maintainer implements custom codecs. |
| All three checks pass within packet limits | Fill mappings and attempt one bounded codec per packet. | Maintainer resolves API ambiguity and reviews live acceptance. |
| Mapping, evidence-gap or editing-boundary checks fail | Candidate output stays outside the accepted workspace. Use a maintainer-assisted mapping workflow. | Maintainer supplies mappings/code; the same protected checks apply. |

A calibration pass grants permission to attempt a packet, not permission to enable its operation. Repeated failures reduce subsequent task scope; they never relax contract checks or expand correction budgets automatically. Run calibration again after changing the local model or its execution setup. An unsupported model does not block the kit's maintainer-only path.

CA-02 delivers runnable calibration samples and demonstrates each assignment outcome with controlled candidate submissions. CA-03 runs them with the actual environment-local agent and records the chosen workflow before real mapping begins. The environment maintainer retains API documents, raw samples and model transcripts locally; exported handoff evidence contains sanitized outcomes and references only.

## Local agent prompt template

CA-02 generates the following prompt from a maintainer-checked mapping and the protected packet manifest. Substitute exact local references and commands from the delivered kit. This is a template, not an executable kit or an approved CAgent mapping.

```text
Implement operation <generated operation ID> at checkpoint <packet ID>.
Read <one contract page> and <approved API sections>.
Use <generated stub> and <host transport helper>.
Edit only <packet allowlist>. Required behavior: <packet semantics>.
Run <protected packet command>. The runner determines pass or failure.
Return candidate file paths and the runner result reference.
If a required semantic lacks evidence, return its contract field,
the conflicting or missing API section, and one question. Stop this packet.
If implementation checks fail, use the supplied smallest failure;
stop after the packet's remaining correction budget is consumed.
Keep the candidate disabled until maintainer acceptance.
```

The runner validates each referenced input before invoking the agent. Missing files, oversized input or an unresolved mapping are preparation failures and do not consume a model correction attempt. A model response is a candidate submission or an evidence-gap record; it never changes packet status, capability support or activation directly. Supply the prompt in a language the actual local model follows reliably, while retaining generated IDs, paths and commands exactly. CA-03 records that choice and its observed instruction-following failures.

## Local model workload budget

Use deterministic generation for symbols, imports, registration, structural field mappings and test commands. The local model is a build-time author of a candidate adapter. Production dispatch executes accepted code and never asks that model to interpret documentation, choose endpoints or translate requests dynamically.

The kit supplies these initial packet limits. A maintainer may revise them after measuring the actual local model; save the revised limits with the kit revision.

| Budget | Initial limit | When exceeded |
| --- | --- | --- |
| Semantic scope | One operation and at most one custom codec | Split at a documented dependency or return an architecture question. |
| Writable implementation files | At most four generated files | Generator handles shared changes; the architecture owner handles changes outside the adapter boundary. |
| Model input | At most 8,000 tokens, including instructions, excerpts, code and failure output | Split the packet or have the maintainer select the required excerpts. Never truncate required semantics silently. |
| Model output | At most 2,000 tokens per attempt | Reduce the generated stub's remaining work or split the codec. |
| Corrections | At most two correction attempts after the initial candidate | Save the smallest remaining failure and return it to the maintainer. |

Count tokens with the supplied offline tokenizer where available. If the model tokenizer is unavailable, record that gap and use a maintainer-approved measured input-size bound; do not report a byte or character count as an exact token count. These limits bound work and cost, not semantic correctness.

The runner separates setup failures, missing or conflicting API evidence, implementation failures and failed live acceptance. Only an implementation failure consumes a model correction attempt. A setup defect returns to the kit owner; an evidence gap returns to the local maintainer. Neither asks the weak model to repair shared infrastructure or guess API behavior.

For CA-02 rehearsals and the CA-03 local-model trial, record packets attempted, protected checks passed, correction attempts, maintainer interventions and elapsed time. Record input size and its counting method. Retain each failed packet's evidence gap. No minimum model success percentage replaces the per-operation activation gate; the report shows whether the supplied workload is practical for that environment.

## Feature disposition and extensions

The protected runner generates existing feature rows from the frozen consumer registry and additional CAgent capability rows from the documented endpoint inventory. The local agent fills evidence and candidate mappings; the runner computes dependencies and availability. Missing rows fail report validation.

| Required column | Fill rule |
| --- | --- |
| Feature ID and owner | Generated existing ID or registered CAgent extension ID, owning host and actual callers. |
| Required semantics | Fixed all-of/any-of operation dependencies and required outcome, decision, cancellation or workspace semantics. |
| Documentation disposition | Shared semantics, bounded conversion, documented incompatibility, evidence gap, or CAgent-only capability. |
| Evidence and implementation | Document sections, mapping/codec revision, protected checks and separate real-server evidence IDs. |
| Host disposition | Implemented on the named host, or `requires-host-development` with the missing interaction or privilege. |
| Effective availability | Runner-computed result with a fixed reason for every unmet prerequisite; UI and direct callers receive the same result. |
| Follow-up owner | Local mapping/codec task, maintainer evidence question, or architecture-owner host task. |

An evidence gap keeps a feature disabled pending verification. Documented incompatibility keeps it disabled until an implementation preserves the required semantics. Only the latter establishes unsupported behavior. A CAgent-only capability uses the finite extension contract; an interaction that contract cannot express becomes an architecture-owner task. The local agent cannot change dependencies or rename a failed check as a limitation to enable a feature.

CA-02 supplies protected report examples for each disposition and verifies missing-row rejection. CA-03 replaces sample evidence with local documentation and live results. Endpoint counts and model confidence never establish support.

The rows are templates, not findings about the real CAgent. The report must enumerate all existing consumer features and all additional CAgent features found in the provided API documentation. Where the documentation inventory is incomplete, state that limitation. Do not label unexamined features unsupported or claim exhaustive server coverage.

An extension record includes action ID, schema version, context, label/localization keys, input/output types, effect class, authorization, progress/terminal/unknown behavior, cancellation, host availability and evidence. A hypothetical extra action is used only to test the kit renderer; do not imply that CAgent offers that action.

## Feature decision examples

The following cases are protected kit examples, not observations about CAgent. The runner applies the frozen dependency registry to the local evidence; the agent cannot select a more permissive outcome.

| Documented condition | Required disposition |
| --- | --- |
| No event stream, but authoritative status and history are available | Attempt the tested polling alternative. Enable only its accepted features and declare refresh latency; a prompt receipt alone is insufficient. |
| Dispatch exists, but completion cannot be observed | Keep chat and its autonomous callers disabled. Accept independently verified read-only features separately. |
| The server may request permission or an answer, but has no usable reply operation | Disable the affected chat mode. Escalate the missing semantics rather than auto-accepting decisions. |
| Cancellation is absent | Disable Stop and workflows requiring cancellation. Interactive chat needs the explicit mode and completion evidence required by the SPEC. |
| OpenCode configuration, MCP or plugin semantics have no CAgent equivalent | Disable those backend operations individually. Preserve independently available OpenChamber-owned functions. |
| A documented new action fits the finite form/action/result contract | Generate a typed `cagent` extension record and bounded handler; validate its authorization, result and unknown-outcome behavior before acceptance. |
| A new action needs an interaction outside that contract | Record `requires-host-development` with a concrete input/result example. Keep it disabled while the architecture owner supplies the interaction. |

## Documentation changes and reacceptance

The local maintainer freezes a document inventory with section references and local content digests alongside each accepted adapter revision. A digest detects changed material; it does not prove that the documentation is correct. Keep private excerpts and digests inside the environment unless their export is approved.

The protected runner links every operation and extension to its cited sections. On a documentation, schema or server-contract change, mark the affected mappings pending review and suspend their dependent capabilities until the maintainer accepts replacement evidence. Preserve unrelated accepted operations only when the recorded contract remains applicable. If the changed scope cannot be determined, suspend the adapter's backend-dependent capabilities pending contract review.

Rebuild affected packets from the new evidence, rerun their protected checks and live journeys, then issue a new accepted adapter revision. Retire stale in-flight client results at activation, preserve unknown request identities for outcome resolution, and never replay them automatically. Rollback requires a revision accepted for the current server contract; an old adapter is not a compatibility guarantee for a changed server.

CA-02 rehearses a changed field, an unrelated unchanged operation and an unscoped contract change. Protected checks verify dependency suspension and prohibit candidate self-reactivation. CA-03 records the actual local documentation/server revision and maintenance procedure in its handoff.

## Required negative checks

- An unsupported operation is refused by the host dispatcher before any request or file write, including direct callers and shortcuts.
- A feature marked supported without accepted evidence, a missing dependency, an unknown schema version or an unregistered extension handler fails validation.
- Wrong auth, malformed responses and disconnected streams preserve authoritative state and do not become empty success or permanent unsupported.
- A submitted request whose acknowledgement is lost remains unknown; retry follows proven CAgent semantics, not timestamp/text matching.
- Switching backend with pending work rejects stale results and does not send an OpenCode request, plugin, config write or queued intent to CAgent.
- An extension mutation cannot bypass authorization, schema validation or declared context by invoking its handler directly.
- Edits to shared source, protected tests or dependency rules fail the packet's changed-file check. Restoring those files restores the kit baseline.
- The maintainer-owned runner rejects a protected artifact digest mismatch even when the adapter's own report claims success. Its checks run independently of commands supplied by the local agent.

## Acceptance report and rollback

Record application/kit/adapter revisions, server identity provenance, API document revision, enabled feature list, unsupported list, unverified list, native extension list, requires-host-development list, test results, host coverage and maintainer decision. Keep fixture-only and live results separate. CA-03 requires a real usable minimum chat path; if the API cannot provide it, escalate the documented gap rather than accepting an empty capability set.

Include an observed failed/unknown dispatch case and one disabled-feature direct-call rejection. Run every host claimed supported. Untested hosts stay unavailable for CAgent; they retain their existing OpenCode behavior. Restoring the last accepted adapter revision must preserve configuration and queued intent without automatic cross-backend dispatch. If no accepted revision exists, disable CAgent and return to connection setup.
