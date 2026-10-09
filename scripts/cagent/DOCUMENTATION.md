# CAgent contract reference generator

## Offline command bundle and final candidate artifact

```sh
bun scripts/cagent/bundle-kit.mjs --out /local/new-kit --json
node /local/new-kit/protected/scripts/cagent/verify-kit.mjs --kit /local/new-kit --digest <owner-digest> --json
bun scripts/cagent/finalize-adapter.mjs --workspace /local/workspace --kit-digest <workspace-digest> --node /absolute/path/to/node --out /local/new-artifact --json
```

The bundle includes eleven standalone commands, 69 generated references, paired START-HERE files and project/Zod/TypeScript licenses. It bundles installed dependencies into ESM and refuses remaining imports outside Node builtins. It copies no local API inputs, credentials or candidate files. The owner supplies the validated Node and Bun executables separately. Fresh-directory tests run OpenAPI import, extension structure checks, calibration, mapping intake, preparation, child fixtures, finalization and maintainer approval/revocation outside the checkout without `node_modules`. These tests establish the tested Windows toolchain, not a different OS or local model.

Bundled paths preserve the worker and reference layout. The exact `protected/` inventory is covered by `control/manifest.json` outside that tree. Transfer the expected digest independently and protect the whole bundle from candidate writes. Verification cannot authenticate its own executable if the owner allows it to be replaced. Existing output is refused before building. Build failure creates no output; write failure leaves an incomplete directory and publishes no final manifest. The bundle includes reviewed source-section extraction, constrained declarative generation, finite extension templates, executable authoring calibration and the independent maintainer approval command below. Actual local-model trials and target permissions remain CA-02 work.

### Maintainer approval and revocation

```sh
node scripts/cagent/maintain-approval.mjs --approve --review /local/maintainer-review.json --artifact /local/output/artifact --manifest /local/output/control/manifest.json --digest <independent-artifact-digest> --directory /local/host-data/agent-approvals --json
node scripts/cagent/maintain-approval.mjs --revoke --connection <connection-id> --directory /local/host-data/agent-approvals --json
```

The independent maintainer runs this after real operation acceptance. `--review` contains the host's strict `agentApprovalSchema`: CAgent family, connection/adapter/server revisions, exact artifact digest and reviewed operation/extension rows. Every row must explicitly declare supported/adapted and nonempty evidence. At least one row is required. Extension rows also carry action revision and canonical manifest digest. Keep this file, command and existing approval directory outside candidate write authority. Directory creation, OS permissions and maintenance serialization belong to the maintainer. Use the directory read by the configured host.

Approval verifies the manifest, independently supplied digest and entire artifact tree without importing candidate code, then uses the host's atomic writer. It does not inspect evidence meaning, call the real API or select a backend. Invalid input or artifact verification failure preserves the existing record. Revocation touches only the named CAgent connection and reports whether a record existed. Output contains fixed errors or counts, not paths, documents or credentials. Human, quiet, JSON and noninteractive modes share the same required flags and checks; no prompts run. Host authority and migrated-consumer gates still determine availability.

### Finite extension packets

Pass `prepare-packets --extensions /local/extensions.json` with a strict `{ manifests, fixtures }` object. `manifests` contains up to 64 unique finite action contracts. `fixtures` maps each action ID to exactly one `{ version: 1, actionID, manifest, cases }` definition; its manifest must equal the reviewed contract. The endpoint mapping must account for every finite action and action requiring host development. The latter remain disabled inventory entries without candidate packets. Include `--fixtures` for mapped core operations; an extension-only mapping can omit it.

Each case has `id`, `input`, `identity`, `exchanges` and `expected`. Input is the handler envelope `{ values, workspaceID?, sessionID?, requestID? }`, with context presence matching the manifest and a request ID only for mutations. Successful expectations use `{ kind: 'result', result: { result: <finite value>, receipt?: { requestID, state } } }`; failures use `{ kind: 'failure', error: <Agent error> }`. Reads cannot return receipts. Observed mutations require matching complete receipts; accepted-only mutations permit accepted or complete receipts. Unknown outcomes cannot count as successful fixtures. Exchanges must match identity, request and order exactly.

Preparation binds the manifest, mapping, document identity, supplied cited excerpts, bilingual instructions and fixtures into the protected digest. Each candidate owns only `candidate/<actionID>/handler.mjs`, exporting `createExtension(context)`. `check-packet --operation <actionID>` reuses the bounded correction ledger and native permission worker. Extension handlers receive input and identity; their fixture request port accepts empty control, without the core operation abort-control argument.

Finalization captures passed sources, assembles core and finite actions together, and rechecks every packet against the combined module before publishing the artifact manifest. Extension-only artifacts are allowed. Generated capabilities remain unverified and activation unavailable. Loading executes native code. Actual server semantics, independent maintainer review, target permissions, model trials and runtime acceptance remain release gates.

### Finite extension templates

`templates/extension/` contains a synthetic manifest, input, result, constants and a refusal handler. `schemas/extension-manifest.json` describes the finite vocabulary. Run `node scripts/cagent/check-extension.mjs --manifest templates/extension/manifest.json --input templates/extension/input.json --result templates/extension/result.json --json` from the protected bundle to validate structure. Runtime parsers additionally enforce bounded values and cross-field rules. The result always reports `structural-only` and activation `unavailable`.

Inputs support text, numbers, booleans, choices and bounded scalar lists; outputs support text, fields and tables. Manifests carry context, effects, current-principal authorization, cancellation, outcome and document references. They carry no activation authority or executable UI. The sample handler refuses before transport. Host registration, effect/permission checks, rendering, switching and live acceptance must pass before any extension is usable on web, Electron, VS Code or either mobile runtime.

For complete additional-action coverage, use `node scripts/cagent/check-extension.mjs --catalog <catalog> --mapping <mapping> --manifests <manifest-array> --json`. Supply a JSON array containing exactly one finite manifest per action classified `form-action-result`. Actions classified `requires-host-development` remain in the report and have no finite manifest. An action spanning multiple endpoints retains every endpoint and is a mutation if any endpoint mutates. Conflicting interaction classifications, missing/duplicate/extra actions, weakened effects or missing cited sections fail. The result is bound to the reviewed mapping digest and always reports unavailable activation. This checks documented extension inventory, not all existing consumer migration or live capability support.

Finalization reads the protected registration, rechecks every registered packet using native persistent correction limits, and bundles captured passing bytes together. It then executes each operation's protected fixtures against that combined adapter in fresh bounded child processes. A combined-factory mismatch stops publication. The command never treats a candidate's progress report as acceptance evidence.

Fresh output contains `artifact/adapter.mjs`, `control/manifest.json` and `report.json`. The manifest covers exactly the loader's artifact tree and is published last by atomic rename. The report records kit/candidate/artifact digests and fixed fixture results. All 22 capabilities stay unverified and activation stays unavailable. Review and protect acceptance evidence independently before using the host approval writer. A write failure retains an incomplete output for inspection; choose a new directory after resolving it. Setup failures remain separate from candidate failure. No live operation is called by these commands.

```sh
CAGENT_TEST_NODE=/absolute/path/to/node bun test scripts/cagent/bundle-kit.test.mjs scripts/cagent/finalize-adapter.test.mjs
```

On Windows set `CAGENT_TEST_NODE` as a process environment variable before running Bun.

## OpenAPI structural inventory

```sh
node scripts/cagent/import-openapi.mjs --source /local/source.json --review /local/review.json --out /local/new-intake --json
```

`schemas/openapi-source.json` describes the version-1 source record with `id`, `revision` and exact OpenAPI JSON in `text`. `schemas/openapi-review.json` describes the owner record with catalog `revision`, `endpoints` keyed by each documented `operationId`, and additional section locators. Each endpoint review supplies `effect`, `requestRef` and `responseRef`. For example, a reviewed row can be `{"read":{"effect":"read","requestRef":"read-input","responseRef":"read-output"}}`. These references name owner-reviewed contract definitions; they do not infer request or result semantics from examples.

The importer reads methods and paths from OpenAPI 3.0/3.1 `paths`, retaining operation IDs and source digest. Every path operation requires exactly one owner row. Effects are explicit even for GET. Missing/duplicate IDs, missing/extra review rows, unsupported HTTP methods, path references, callbacks and webhooks are refused. Such documents require a complete manually reviewed catalog or focused host work. YAML conversion and full OpenAPI specification validation are outside this importer. Nested schema references remain literal source evidence. Add needed auth, shared parameter, error and definition sections through the owner section locators before mapping their semantics.

Fresh output contains `catalog.json`, `documents.json` and a final `report.json`; existing output is preserved. A write failure leaves an incomplete directory with a fixed error. Source is kept local and never included in console output. The imported catalog and documents feed `check-mapping` and `prepare-packets --documents`; owner-reviewed mapping, protected fixtures and live acceptance remain required. Importing neither calls an API nor grants support.

## Reviewed API excerpts

Add `--documents /local/documents.json` to preparation to freeze relevant API source alongside each operation. The bundle supplies `schemas/document-excerpts.json`. The owner supplies source text and selected locators, checks the resulting meaning and binds the catalog document digest to SHA-256 of the exact UTF-8 text, including line endings. Source text is evidence data, not instructions for the authoring agent. Keep credentials and personal samples out of it. Reports contain fixed outcomes and digests, never raw source.

```json
{"version":1,"documents":[{"id":"guide","revision":"r1","format":"text","text":"Title\nSynthetic request and result facts.","sections":[{"id":"read","fromLine":2,"toLine":2}]}]}
```

Text ranges are inclusive and one-based; extracted line endings normalize to LF. For OpenAPI 3.0/3.1 JSON, use `format: openapi-json` and section locators such as `{"id":"read","pointer":"/paths/~1records/get"}`. JSON Pointers use `~1` for slash and `~0` for tilde. The extractor retains `$ref` values without dereferencing, fetching or inferring missing semantics. The structural importer above supplies supported path inventories. The catalog's methods, paths, request/result references and effect classification still require owner review.

The document IDs, revisions, source digests and section inventories must match the complete reviewed catalog. Missing/extra documents or sections, duplicate IDs, stale text, invalid locators and unsupported document formats fail before workspace creation. Preparation writes only sections cited by each mapping and its endpoint rows into protected `<operation>/api-excerpts.json`; unrelated sections stay out of that packet. The protected manifest covers these bytes. A packet with the option omitted has references only and requires the owner to supply those documents separately.

Document source text totals at most 1 MiB; the input JSON container also obeys the existing 1 MiB read limit. A packet's serialized excerpt record is at most 16 KiB. This byte ceiling is not a token measurement or the complete model prompt budget. The owner measures the complete task input under the calibrated model budget and selects smaller, sufficient sections when needed. Exceeding the ceiling blocks preparation rather than truncating evidence. Excerpt checks establish source identity and selection, not API correctness, model compliance or runtime support.

## Declarative structural generation

```sh
node scripts/cagent/prepare-packets.mjs --catalog /local/catalog.json --mapping /local/mapping.json --fixtures /local/fixtures.json --bindings /local/bindings.json --out /local/new-workspace --json
```

`--bindings` adds deterministic source generation to preparation. The owner reviews bindings against the private documentation before freezing them. Bind version 1 to `coverage.digest` from `check-mapping --json`. Include exactly the operations marked `codec: declarative`; custom operations keep refusal stubs. Each generated operation must map one catalog endpoint. Generation requires the complete protected fixtures for all mapping-ready operations, writes each recipe into protected `<operation>/bindings.json`, and marks the candidate awaiting-validation. It runs no candidate or API call and grants no support.

The bundle provides `schemas/declarative-bindings.json`. This structural schema does not encode cross-document matching, projection-depth limits or all runtime refinements; preparation remains the authoritative validator. The following is a synthetic recipe for a catalog route `/records/{record}`, not a CAgent endpoint. Replace the digest with the actual checked mapping digest.

```json
{"version":1,"mappingDigest":"<coverage.digest>","operations":{"getSession":{"endpointID":"read","successStatuses":[200],"path":{"record":{"kind":"field","from":"input","path":["sessionID"]}},"query":{"space":{"kind":"field","from":"input","path":["workspaceID"]}},"result":{"kind":"object","fields":{"id":{"kind":"field","from":"response","path":["body","record"]},"workspaceID":{"kind":"field","from":"input","path":["workspaceID"]},"title":{"kind":"field","from":"response","path":["body","label"],"optional":true}}}}}}
```

The finite projection nodes are `field`, primitive `literal`, `object` and `list`. Fields use own-property paths from input or response; list items add an `item` scope. Result lists preserve order; optional absent fields are omitted without defaults. Request fields read input or items from input-derived lists. Path/query values are scalar strings, numbers or booleans; query values serialize to strings. Path placeholders require exact bindings, encode values and refuse empty, dot or slash segments before transport. GET bodies are rejected. Identity/control and transport failures pass through unchanged. Only explicitly listed successful 2xx statuses reach result projection; other statuses produce backend-failed. Documentation requiring distinct HTTP-error classification uses a custom codec.

Projection nesting is at most eight nodes with at most 256 nodes per tree. Unknown node kinds, executable expressions, unsafe property keys, unbound placeholders, stale/missing/extra bindings and response-dependent requests fail preparation. Equivalent object key ordering produces identical source. The generator uses no eval, imports or direct networking in candidate source. It supplies no enum conversion, semantic coercion, multi-call orchestration or semantic inference. Use a bounded custom codec when those are required. Protected fixtures and actual host/live acceptance still decide semantics, scope and availability.

## Authoring-model calibration

```sh
bun scripts/cagent/calibrate.mjs --prepare --model-record /local/model.json --out /local/new-calibration --json
bun scripts/cagent/calibrate.mjs --check --workspace /local/new-calibration --kit-digest <prepare-digest> --node /absolute/path/to/node --trial-record /local/trial.json --json
```

The maintainer supplies these records; keep the trial outside the entire calibration workspace. Replace the synthetic identity and measurements with the actual model/build, chosen prompt language, counting method, measured input counts, authoring time and interventions. No tokenizer or model invocation is provided. Byte counts are not token counts. Token budgets may not exceed 8000; the tool validates the declared counts, not their independent accuracy.

```json
{"version":1,"id":"synthetic","build":"r1","language":"en","execution":"scripted","inputBudget":{"unit":"bytes","limit":8000,"method":"utf8"}}
```

```json
{"version":1,"modelID":"synthetic","modelBuild":"r1","language":"en","input":{"mapping":400,"codec":600,"gap":400},"elapsedMs":0,"interventions":0}
```

Preparation freezes bilingual synthetic tasks, the model record and five codec fixtures. The candidate fills mapping/gap `answer.json` files and one codec `handler.mjs`. Owner checks require the exact structural mapping, four status conversions, preservation of transport failure and a structured evidence-gap answer. The question's meaning still needs maintainer review; no language-quality judge is implemented. Protected input changes invalidate the digest. Native progress retains the initial submission plus two corrections across command invocations.

All checks passing assigns `bounded-codec`. Passing mapping/gap with a failed codec assigns `declarative-only`. A failed mapping/gap or file-boundary violation assigns `maintainer-assisted`. Limited outcomes return nonzero; setup failures do not grant an assignment or consume a candidate correction. Every report retains activation unavailable and identifies maintainer-provided measurements separately from checker elapsed time. Reprepare in a fresh workspace after changing model/build/language or execution setup. These synthetic authoring checks do not establish actual model performance, live API support or [runtime workflow quality](../../docs/maintenance/CAGENT-WORKFLOW-ACCEPTANCE.md).

## Protected fixture checks and adapter assembly

`fixture-checks.mjs` validates a host-owned version-1 fixture definition with an operation ID and unique cases. Each case supplies canonical input, identity, ordered request/response or transport-failure exchanges, and an expected neutral result or fixed failure. It checks input/output with the application's runtime parsers before execution. The host supplies the factory-loading port; this port receives captured candidate sources from the packet runner.

Each check creates a fresh handler and compares every transport request, identity and forwarded abort signal. Wrong or extra requests remain a failure even when the candidate catches the exception. Every expected exchange must be consumed. Matching schemas alone cannot pass a cross-scope result because the expected projection is also compared exactly. A documented backend failure must stay a failure. Fixture construction/loading failures are setup errors, not a failed operation's semantic evidence. Case IDs are local owner-reviewed report identifiers.

`adapter-assembly.mjs` uses the installed Bun builder and TypeScript parser to bundle captured single-file operation modules in memory. It reads no candidate paths and executes no candidate factories while building. Source count/bytes use packet limits, duplicate and unknown operations fail, and input order is canonicalized. Each module must export only `createOperation`; parsed imports and `require`/`eval` identifiers are refused. The bundler resolves only its generated virtual module inventory. Comments are parsed as comments. This dependency restriction is not a JavaScript sandbox and cannot establish that arbitrary candidate code is safe.

The output contains one asynchronous `createAdapter` factory that creates fresh handlers and keeps all capabilities unverified. It can be loaded through the existing artifact loader after the host creates an exact artifact manifest. Assembly returns source bytes and a digest, without changing runtime selection, evidence or approval.

```sh
node --test scripts/cagent/fixture-checks.test.mjs
bun test scripts/cagent/adapter-assembly.test.mjs scripts/cagent/fixture-workspace.test.mjs
```

The combination test uses actual temporary files, bundling, protected snapshot verification and native checkpoint persistence. It fails a candidate returning plausible data without a request, accepts the corrected projection, resumes from disk, preserves the three-failure ceiling and refuses protected fixture tampering. These synthetic tests do not prove the real CAgent API. The complete kit still needs enforced environment permissions, document intake, frozen executable host composition, extension templates, calibration and live acceptance.

## Bounded packet check command

The owner supplies reviewed version-1 fixture definitions as an object keyed by operation ID. `--fixtures` requires exactly the mapping-ready operations, validates canonical inputs and expected outputs, and freezes each definition in the protected snapshot. Without this flag, preparation retains its syntax-only packet metadata.

```sh
node scripts/cagent/prepare-packets.mjs --catalog /local/reviewed-catalog.json --mapping /local/candidate-mapping.json --fixtures /local/reviewed-fixtures.json --out /local/new-workspace --json
bun scripts/cagent/check-packet.mjs --workspace /local/new-workspace --operation getSession --node /absolute/path/to/node --kit-digest <owner-recorded-digest> --json
node --test scripts/cagent/fixture-process.test.mjs
```

Replace the operation with an ID from the generated packet. The explicit Node executable must support `--permission`; the tested executable is Node 24.9.0. Bun runs the host command and assembler. The host obtains the kit digest from preparation and stores it outside candidate write authority. A candidate's manifest or report does not supply approval.

The command verifies the protected inventory, captures the one allowed handler, assembles it without executing its factory, and runs fixtures in a fresh child process. The child receives only `SystemRoot` and `WINDIR` on Windows and an empty environment elsewhere. Filesystem writes, child processes and worker threads are denied. Reads include this checkout and its resolved dependencies. The default deadline is 5 seconds, configurable with `--timeout` between 10 and 30000 milliseconds. Input is bounded to 1 MiB and combined output to 64 KiB. Timeout or excessive output triggers forced termination; the host waits for process closure before reporting.

A startup handshake distinguishes missing permission support or setup failure from candidate failure. Setup failures do not consume a correction attempt. Candidate assembly failure, failed fixture, timeout, malformed output or abnormal exit after startup counts as failure. Native progress retains the three-failure ceiling across command restarts. JSON reports fixed check and case IDs without raw candidate exceptions or API documents. Passing grants no capability or activation.

The permission model reduces accidental process access; it does not establish network isolation or a hostile-code sandbox. See the [Node permission model](https://nodejs.org/download/release/v24.21.0/docs/api/permissions.html). The target owner still must enforce read-only protected files, independent progress/approval authority and the required execution/network policy. Fixture expectations must be reviewed against local API documentation; schema validation cannot establish those semantics.

## Candidate packet preparation

```sh
node scripts/cagent/prepare-packets.mjs --catalog /local/reviewed-catalog.json --mapping /local/candidate-mapping.json --out /local/new-workspace --json
node --test scripts/cagent/packet-plan.test.mjs scripts/cagent/prepare-packets.test.mjs
```

Preparation reuses strict mapping intake and generates one packet per mapping-ready operation. Each packet contains its English goal, seven evidence dimensions, cited endpoint/document metadata, current schema and paired references. Only `candidate/<operation>/handler.mjs` belongs to the candidate's edit scope. Its generated factory refuses execution as unverified until implemented. A fixed registration inventory keeps all 22 capabilities unverified. No API route is inferred or called.

The protected snapshot lives under `protected/`. Its exact file manifest is written last to `control/manifest.json`, outside the verified tree. Candidate files are intentionally excluded from that snapshot. The manifest is a fingerprint, not acceptance or activation authority. Directory names and owner permission modes alone do not establish Windows ACL isolation; the complete kit must enforce separate candidate and host write permissions.

The command requires a fresh output directory under an existing canonical parent. Existing output is refused without modifying it. A failed write leaves a partial directory, reports `workspace-incomplete` and does not publish the final manifest; preserve it for inspection and use a fresh directory after correcting the cause. Inputs use the shared 1 MiB bounded reader. All modes are noninteractive; JSON output contains counts, digest and fixed errors without private paths or API documents. `--quiet` emits one concise result line.

The emitted check command is syntax-only metadata by default, or the bounded semantic command when reviewed fixtures are supplied. Preparation itself executes no candidate code. The check command assembles an ephemeral single-operation adapter for fixture execution; it does not publish the final multi-operation artifact, grant capabilities or implement model calibration, extension packets, offline installation or live acceptance. Those remain CA-02/CA-03 work. The final adapter must bundle helpers rather than import the candidate workspace.

## Mapping intake

`mapping-intake.mjs` compares a maintainer-reviewed local endpoint catalog with operation mappings supplied by the weak Agent. The inputs are separate: the catalog belongs outside the candidate's writable workspace. A schema check cannot establish that a route is documented or that the maintainer actually reviewed it. The local owner must verify the catalog against API documentation before using this tool.

```sh
node scripts/cagent/check-mapping.mjs --catalog /local/reviewed-catalog.json --mapping /local/candidate-mapping.json --json
node --test scripts/cagent/mapping-intake.test.mjs scripts/cagent/check-mapping.test.mjs
```

The read-only command requires both paths, accepts `--quiet` and returns one JSON object with `--json`. It never prompts or writes files. Inputs are bounded to 1 MiB each. Setup, parse and consistency errors return fixed codes with a nonzero exit. Reports exclude source paths, API definitions, free-text questions and raw exception messages. Coverage still includes operation, endpoint and action IDs; a local owner must review a report before exporting it from a private environment.

Mapping failures include a fixed check ID and next action, plus a canonical operation ID when it can be identified safely. Feature rows list the missing required operations and alternative dependency branches. A fully unresolved inventory may pass structural intake while every feature stays blocked; a zero exit here never establishes a usable adapter.

The version-1 catalog records its revision, document IDs/revisions/digests/section IDs, and endpoint IDs with documented method/path, request/response references, effect and citations. Endpoints contain relative API paths, not server origins or credentials. The version-1 mapping binds both the catalog revision and its canonical digest. Each of the 22 operation rows is a mapping, a cited documented absence/incompatibility, or an unresolved question. Mapped operations name reviewed endpoints, a declarative/custom codec choice and citations for transport, authentication, scope, result, failure, completion and cancellation. Every endpoint also receives a shared-operation, extension or out-of-scope disposition. Shared references must agree in both directions.

The compiler rejects missing rows, unknown IDs, uncited sections, stale catalog content, contradictory references and mismatched read/mutation effects. It derives candidate feature readiness from the application-owned dependency rules. All feature and extension availability remains false. `mapping-ready` and `candidate-ready` are workflow results, never runtime support or acceptance. A form/action/result extension requires a separate candidate and acceptance; other interactions require host development.

The catalog fingerprint uses parsed JSON with recursively sorted object keys and ordered arrays. A content change requires the mapping to be reviewed and rebound, even when the revision label is unchanged. This component does not extract OpenAPI/prose documentation, generate handlers, implement codecs, run live checks or suspend an already active adapter. Those responsibilities remain in the complete CA-02 kit and host activation flow.

## Operation references

The [Chinese review copy](../../docs/maintenance/zh-CN/CAGENT-CONTRACT-GENERATOR.md) stays synchronized until final handoff.

This maintainer tool produces one English and one Chinese page per neutral operation, one machine-readable schema/example file per operation, two indexes and a reference manifest. It imports current operation constants, input/output parsers and action dependency rules. `operation-reference.mjs` owns the reviewed bilingual semantic requirements and synthetic examples. It contains no real CAgent API mapping.

Use the checkout's installed dependencies and Node.js 22 or newer. These commands require no network or server. They are a working reference-generation step, not a self-contained offline kit installer.

```sh
node scripts/cagent/build-contracts.mjs --write --json
node scripts/cagent/build-contracts.mjs --check --json
node --test scripts/cagent/contract-pages.test.mjs
```

The default command checks existing references. `--write` regenerates fixed repository paths under `docs/maintenance/cagent-contracts` and `docs/maintenance/zh-CN/cagent-contracts`. It does not delete unexpected files. Remove obsolete references through a reviewed source change; their presence makes both write/check commands fail. `--check` and `--write` are mutually exclusive. Unknown flags and positional arguments fail before writing.

Every mode is noninteractive. Default and `--quiet` output one concise result line. `--json` outputs exactly one JSON result, including failures. Missing or changed files and unexpected entries return nonzero with `reference-stale`; other setup/generation failures return nonzero with `reference-generation-failed`. Reports contain counts, a reference digest and fixed codes, without API documents, credentials or raw exception text. Write failure may leave partially regenerated references; rerun generation and require a passing check before handing them off.

Generated pages list required/optional top-level inputs, operation-specific semantics, valid input/result examples, a rejected result and related action IDs. The JSON files retain the full structural schema. Runtime refinements, such as unique permission choice and message-part IDs, are not fully expressible in these generated schemas. Protected acceptance checks must still use the runtime parsers and verify scope, request construction and documented semantics. Fixture validity never establishes real CAgent support.

The manifest hashes the exact UTF-8 contents of the other 68 generated files. Its aggregate digest hashes the ordered file/hash list. It is a reference fingerprint, not the adapter artifact manifest, an application revision, independent evidence, an approval record or an activation grant. A completed CA-02 bundle must freeze the application, toolchain, packet definitions, protected fixtures and reference digest together.

The architecture owner regenerates and reviews these files. A local weak Agent receives only its assigned operation page, that operation's schema, reviewed API excerpts and an allowed candidate packet. Reference files remain outside candidate write permissions. Reference generation and the separate mapping intake command do not implement packet generation, model calibration, extension templates, executable bundle installation or isolated live checks; those remain CA-02 work.

Web, Electron, hosted mobile and Capacitor can use the same neutral contract after host acceptance. This generator changes no runtime behavior or feature availability. VS Code keeps its unsupported Agent namespace. No OpenCode/Legacy code path or release artifact is changed by reference generation.
