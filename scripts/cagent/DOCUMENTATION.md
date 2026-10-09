# CAgent contract reference generator

## Offline command bundle and final candidate artifact

```sh
bun scripts/cagent/bundle-kit.mjs --out /local/new-kit --json
node /local/new-kit/protected/scripts/cagent/verify-kit.mjs --kit /local/new-kit --digest <owner-digest> --json
bun scripts/cagent/finalize-adapter.mjs --workspace /local/workspace --kit-digest <workspace-digest> --node /absolute/path/to/node --out /local/new-artifact --json
```

The bundle includes seven standalone commands, 69 generated references, paired START-HERE files and project/Zod/TypeScript licenses. It bundles installed dependencies into ESM and refuses remaining imports outside Node builtins. It copies no local API inputs, credentials or candidate files. The owner supplies the validated Node and Bun executables separately. Fresh-directory tests run mapping intake, preparation, child fixtures and finalization outside the checkout without `node_modules`. These tests establish the tested Windows toolchain, not a different OS or local model.

Bundled paths preserve the worker and reference layout. The exact `protected/` inventory is covered by `control/manifest.json` outside that tree. Transfer the expected digest independently and protect the whole bundle from candidate writes. Verification cannot authenticate its own executable if the owner allows it to be replaced. Existing output is refused before building. Build failure creates no output; write failure leaves an incomplete directory and publishes no final manifest. The bundle contains the executable command workflow, not the complete CA-02 deliverable: document extraction, declarative code generation, extension templates, model calibration and target permissions still remain.

Finalization reads the protected registration, rechecks every registered packet using native persistent correction limits, and bundles captured passing bytes together. It then executes each operation's protected fixtures against that combined adapter in fresh bounded child processes. A combined-factory mismatch stops publication. The command never treats a candidate's progress report as acceptance evidence.

Fresh output contains `artifact/adapter.mjs`, `control/manifest.json` and `report.json`. The manifest covers exactly the loader's artifact tree and is published last by atomic rename. The report records kit/candidate/artifact digests and fixed fixture results. All 22 capabilities stay unverified and activation stays unavailable. Review and protect acceptance evidence independently before using the host approval writer. A write failure retains an incomplete output for inspection; choose a new directory after resolving it. Setup failures remain separate from candidate failure. No live operation is called by these commands.

```sh
CAGENT_TEST_NODE=/absolute/path/to/node bun test scripts/cagent/bundle-kit.test.mjs scripts/cagent/finalize-adapter.test.mjs
```

On Windows set `CAGENT_TEST_NODE` as a process environment variable before running Bun.

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
