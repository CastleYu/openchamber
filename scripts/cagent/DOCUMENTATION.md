# CAgent contract reference generator

## Candidate packet preparation

```sh
node scripts/cagent/prepare-packets.mjs --catalog /local/reviewed-catalog.json --mapping /local/candidate-mapping.json --out /local/new-workspace --json
node --test scripts/cagent/packet-plan.test.mjs scripts/cagent/prepare-packets.test.mjs
```

Preparation reuses strict mapping intake and generates one packet per mapping-ready operation. Each packet contains its English goal, seven evidence dimensions, cited endpoint/document metadata, current schema and paired references. Only `candidate/<operation>/handler.mjs` belongs to the candidate's edit scope. Its generated factory refuses execution as unverified until implemented. A fixed registration inventory keeps all 22 capabilities unverified. No API route is inferred or called.

The protected snapshot lives under `protected/`. Its exact file manifest is written last to `control/manifest.json`, outside the verified tree. Candidate files are intentionally excluded from that snapshot. The manifest is a fingerprint, not acceptance or activation authority. Directory names and owner permission modes alone do not establish Windows ACL isolation; the complete kit must enforce separate candidate and host write permissions.

The command requires a fresh output directory under an existing canonical parent. Existing output is refused without modifying it. A failed write leaves a partial directory, reports `workspace-incomplete` and does not publish the final manifest; preserve it for inspection and use a fresh directory after correcting the cause. Inputs use the shared 1 MiB bounded reader. All modes are noninteractive; JSON output contains counts, digest and fixed errors without private paths or API documents. `--quiet` emits one concise result line.

The emitted check command is syntax-only metadata. Preparation does not execute candidate code or protected semantic fixtures. It does not assemble the loader's final single-file adapter, grant capabilities or implement model calibration, extension packets, offline installation or live acceptance. Those remain CA-02/CA-03 work. The final adapter must bundle helpers rather than import the candidate workspace.

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
