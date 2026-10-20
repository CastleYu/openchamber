# INT-05 credential test command failures

- `bun x --no-install vitest run packages/web/server/lib/opencode/legacy-provider-config.test.js` failed before test collection: Vite could not resolve `vite/internal` from the installed `@vitejs/plugin-react`; Vite safe-path resolution also failed to spawn with `EPERM`.
- This is an environment/dependency-resolution failure, not a test assertion failure. Retry the same focused command in the permitted worker context; do not install or download dependencies.

2026-10-12 Provider source investigation: attempted pinned config/config.ts was absent. No retrieval attempted; use rg --files for retained source inventory. Provider.ts and installed SDK declarations are available.

2026-10-12 Automatic review rejected expanded provider values in the shared kernel snapshot before execution. Safer replacement returns provider IDs, environment variable names, and a plugin-presence boolean only. No expanded provider values, credentials, plugin URLs or environment values cross this new contract.

2026-10-12 Private comparison helper stopped at absent getDefaultModel declaration after its JS edit. Inspected actual declarations and resumed with the present getLegacyConfiguration anchor; exact-replacement steps are idempotent.

- 2026-10-12 continuation: guessed opencodeManager.ts and lifecycle-runtime.js paths were absent; shell rg with a literal kernel-runtime* path reported Windows os123. Use rg --files to discover paths, then search directory with -g. Actual VS Code owner is src/opencode.ts. No source download required.

- 2026-10-12: guessed new credential operation log names were absent. Subagent validation returned inline; discover retained artifact names before reading. Root reran changed-path validation with explicit logs.

- 2026-10-12 auto-review rejected replacing new private independent OAuth methods with beginOAuth closure, stating material public API change without explicit authorization. No rejected change executed/retried; source has no production callers and Legacy admission stays closed. Scoped authorization question sent; unrelated SDK save/remove/catalog work validated.
