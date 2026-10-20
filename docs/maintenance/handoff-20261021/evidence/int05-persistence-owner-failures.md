# int05 Legacy MCP persistence owner command failures

- Command: `bun x --no-install vitest run server/lib/opencode/legacy-mcp-config.test.js server/lib/opencode/legacy-config-layers.test.js`
- Result: Vitest could not load its configuration because esbuild child-process startup failed with `spawn EPERM`.
- Classification: environment/process-spawn restriction; no test assertions ran.
- Recovery: rerun the exact focused suite in an execution context that permits esbuild's child process.
