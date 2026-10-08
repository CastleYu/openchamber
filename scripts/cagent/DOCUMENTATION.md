# CAgent contract reference generator

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

The architecture owner regenerates and reviews these files. A local weak Agent receives only its assigned operation page, that operation's schema, reviewed API excerpts and an allowed candidate packet. Reference files remain outside candidate write permissions. Schema validation and reference freshness do not implement packet generation, mapping intake, model calibration, extension templates, executable bundle installation or isolated live checks; those remain CA-02 work.

Web, Electron, hosted mobile and Capacitor can use the same neutral contract after host acceptance. This generator changes no runtime behavior or feature availability. VS Code keeps its unsupported Agent namespace. No OpenCode/Legacy code path or release artifact is changed by reference generation.
