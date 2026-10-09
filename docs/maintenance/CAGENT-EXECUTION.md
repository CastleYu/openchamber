# CAgent execution checkpoint

Updated 2026-10-09. English is the implementation handoff; the [Chinese copy](zh-CN/CAGENT-EXECUTION.md) remains synchronized. Earlier checkpoint history is preserved in Git.

## Delivered scope

The independent branch is `codex/cagent-integration`. Web and Electron support a maintainer-owned CAgent startup descriptor, bounded typed dispatch, exact independent approvals and revocation, durable mutation outcomes, and finite additional actions. Unknown or unsupported operations stay unavailable. Generic OpenCode proxy/event routes and scheduled tasks refuse CAgent before upstream work or persisted task claims. VS Code CAgent remains unavailable; mobile uses the selected host without a local CAgent process.

The offline kit includes eleven commands and 95 protected files. The [workbook](CAGENT-ADAPTER-WORKBOOK.md#minimum-first-delivery) starts with four existing-session chat operations. The maintainer prepares reviewed evidence and fixtures; the weak agent edits one handler per packet. Other operations retain explicit unverified or documented unsupported dispositions. New actions use the fixed manifest/form/result vocabulary; actions requiring different host interactions remain disabled pending host development. No real API path is guessed.

## Verified evidence

- Existing OC1/OC2 UI contracts: 87 passing tests across 14 isolated files.
- Web proxy, kernel operations/runtime, scheduler and startup: 124 passing tests across 6 files using native Node Vitest.
- Electron packaged UI, notification-only personal updates and version build: 9 passing tests.
- Locale dictionaries: 4 passing tests; UI package type-check passes. The incorrect CAgent page title was corrected across all 13 locales.
- Earlier workspace type-check/lint and generated contracts passed; lint retained five existing warnings. Earlier authored anti-slop had no diagnostics; inherited proxy/scheduler diagnostics remain unchanged.
- Actual portable and HMR development journeys pass login, existing-session acquisition, exactly one synthetic prompt, rendered history, approval revocation and clean application exit. These use a synthetic loopback server, rather than the inaccessible CAgent API. Portable extraction succeeded with an isolated TEMP on a volume with enough space; the system TEMP volume had about 676 MB free during the initial failure.

## Release and remaining work

The preview identity is `2.0.4-DIJIANG.5.0-DEBUG`, with notification-only updates. Rebuild the corrected title from the frozen source commit and repeat the portable journey before publishing. Deliver the portable EXE, offline kit, build metadata and checksums through a prerelease on the independent branch; do not alter `codex/personal` or the parallel DIJIANG 4.1 build.

The maintainer explicitly set the order: architecture/documentation, existing-feature regression, build/Release, then remaining INT development. CA-03 is environment-local adaptation and acceptance, not a prerequisite to publish this kit. Real API mappings, local-model calibration, target permission setup and real workflow quality remain unverified here. This preview does not claim full CAgent consumer migration, Legacy 1.2.27 support or completion of remaining INT work. Follow the [milestone queue](OPENCODE-INTEGRATION-MILESTONES.md).
