# R2 Legacy read-contract command notes

- Command: `node packages/web/node_modules/vitest/vitest.mjs run --config packages/web/vitest.config.ts packages/web/server/lib/opencode/legacy-contract.test.js`
- Result: config startup failed with `spawn EPERM` while esbuild tried to start its service process under the default sandbox.
- Classification: environment/process-spawn restriction; no test assertion ran.
- Next attempt: retry the exact focused command with scoped elevated execution.