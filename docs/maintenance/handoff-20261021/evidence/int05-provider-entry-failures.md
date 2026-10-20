# Provider entry integration command notes

- Windows `rg` rejects wildcard file paths such as `lib/runtime-switch*`. Search the existing directory with `-g` filters instead.
- `packages/mobile/src` does not exist in this checkout. Discover package paths before searching them; shared mobile application code lives under `packages/ui/src/apps`.
- The interface inventory has no `zh-CN/DUAL-KERNEL-INTERFACES.md` counterpart. Use discovered paths only.
- The active implementation is in `dijiang-next/openchamber`; `cdee/openchamber` is only the writable helper checkout. Do not read implementation files relative to the helper.
- Combined file reads exceeded output limits. Read one relevant range at a time with enough output budget.

- Additional guessed route module paths were absent. Registration imports in feature-routes-runtime.js identify the owning runtime.js and core-routes.js files.

- First full feature registration fixture lacked createFsSearchRuntime required by project-icon registration. Supply the real filesystem search factory and spawn dependency, without executing searches or children.

- Full feature fixture must supply precomposed session/control service objects like production, rather than triggering the unrelated fallback session constructor.

- 2026-10-12: rg received a Windows wildcard as a positional path (packages/ui/src/test*), producing OS error 123. Use discovered explicit paths or a directory plus -g; do not pass unexpanded wildcard paths. Continued with explicit existing test files.
- 2026-10-12: A Node -e validation command received duplicated double quotes through PowerShell and failed to parse. Replaced it with native ConvertFrom-Json and Test-Path; all checkpoint references passed. Use a saved CJS file or native PowerShell rather than nested inline quoting.

- UI primary review: summary locale path used locales/providers.i18n.ts, but the discovered file is messages/providers.i18n.ts; continued with rg-confirmed path. A StrictMode lookup included a nonexistent index.tsx; main.tsx confirms StrictMode. Use discovered paths only.

- Component test harness: Base UI imported before browser globals caused manual OAuth Dialog to stay unmounted. Install bootstrap DOM before dynamic component imports; final component run passed 10/10. UI type-check also caught a fixture models object where the store requires an array; corrected the fixture.

- Workspace parallel type-check exhausted native memory in the Web compiler. Retry package checks sequentially using the existing Bun workspace scripts; no dependency or system changes. Polling the earlier process returned an unknown session after termination; the authoritative log captured the out-of-memory failure.

- Confirmed cached Knip 5.80.0 package and bin, so automatic review allowed direct local Node execution without package manager. That cache lacked a transitive module and failed ERR_MODULE_NOT_FOUND. Dead-code is not yet validated; no installation performed. A prior service-test command used an incorrect relative log path; rerun with an absolute path passed 10/10.

- Localized dictionary verification initially treated Dutch Project as an English placeholder. Project is the correct Dutch noun; verifier now permits only this explicit cognate. Actual exports passed 13 locales / 60 keys. The first locale integration task produced no changes; replacement task stayed pending_init and was interrupted, so the primary generated and merged translations directly. Knip ultimately ran successfully from the complete pre-existing bunx cache, without download.
- 2026-10-12: Focused Bun test from the specified `dijiang-next/openchamber` worktree failed with EPERM reading test and package files under the restricted shell sandbox. Retry only the focused test with explicit elevated approval; do not change the test command or scope.

- 2026-10-12: rg with a wildcard in a Windows path reported error 123. Use a directory argument with -g instead.

- 2026-10-12: bounded edit helper stopped on an unmatched DesktopHostSwitcher import after writing runtime-switch. Corrected exact import and normalized CRLF before applying remaining edits; did not rerun completed edits. A second rg path wildcard produced Windows error 123; directory + -g used next.

- 2026-10-13: validation orchestration JavaScript had an extra closing parenthesis; corrected before any command started. Existing runtimeConfig test stub returned void after switchRuntimeEndpoint became awaitable; updated that existing stub to return Promise<void>, without changing production behavior.
