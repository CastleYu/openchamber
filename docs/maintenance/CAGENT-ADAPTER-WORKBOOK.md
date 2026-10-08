# CAgent local adaptation workbook

Status: planning template, 2026-10-08. Use after CA-02 delivers the executable kit described by the [CAgent SPEC](CAGENT-INTEGRATION-SPEC.md). This document contains no guessed CAgent API paths. Every placeholder below remains unresolved until populated from local documentation and evidence.

## Packet delivered into the environment

The architecture owner must provide these artifacts together at a frozen application/contract revision. CA-02 acceptance fails if a file or executable command is merely promised.

| Artifact | Required contents |
| --- | --- |
| START-HERE | Exact offline setup and check commands, supported toolchain, kit/app digest, contract version, file allowlist and restore steps. |
| Adapter workspace | Compiling disabled-by-default skeleton, generated operation constants, typed requests/results, bounded transport/auth hooks and explicit registration point. No whole-repository editing required. |
| Contract reference | One short page per operation with required semantics, successful/failed/unsupported examples and related feature IDs. |
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

## Feature disposition and extensions

| Feature ID | Dependency rule | Support result | User-visible result | Evidence / next owner |
| --- | --- | --- | --- | --- |
| Generated existing ID | Fixed all-of/any-of rule | Unverified until evidence | Disabled with reason until accepted | Local documentation, fixture/live report |
| Generated CAgent extension ID | Versioned schemas and registered handler | Unverified until evidence | Extension panel only after acceptance | Template-compatible or requires-host-development |

The rows are templates, not findings about the real CAgent. The report must enumerate all existing consumer features and all additional CAgent features found in the provided API documentation. Where the documentation inventory is incomplete, state that limitation. Do not label unexamined features unsupported or claim exhaustive server coverage.

An extension record includes action ID, schema version, context, label/localization keys, input/output types, effect class, authorization, progress/terminal/unknown behavior, cancellation, host availability and evidence. A hypothetical extra action is used only to test the kit renderer; do not imply that CAgent offers that action.

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
