# Command environment notes

## 2026-09-07

- `git fetch origin` could not write `.git/FETCH_HEAD` under the workspace sandbox. The approved retry of the same Git command succeeded. Use scoped Git escalation for repository metadata writes; ordinary source edits remain sandboxed.
- `Get-Content packages/ui/README.md` found no file. Check optional package documentation with `Test-Path` before reading it.
- Ripgrep paths containing shell-style wildcards did not resolve on Windows. Pass existing directories and use `-g` filters instead.
- Node test isolation and Vite/esbuild child-process creation failed with `spawn EPERM` in the sandbox. Run individual Node test files directly when isolation is unnecessary; use scoped escalation for the actual packaging/test process tree.
- The first portable build reached Electron Builder but found a stale local dependency tree, missing `@opencode-ai/sdk@1.18.29` for `@openchamber/web`. Reconcile installed dependencies with `bun install --frozen-lockfile` after an upstream merge before retrying packaging.
- Optional output logs may not exist while their preceding command is still running. Check `Test-Path` before reading them.
- `Get-CimInstance Win32_Process` was denied in the sandbox. Use scoped read-only escalation when native process ownership must be inspected.
- A first portable smoke launch exposed no CDP renderer. The test environment had set `ELECTRON_RUN_AS_NODE` to an empty value; remove the variable entirely for Electron GUI launches and record early process exits before waiting for CDP.
- `--background` startup can intentionally create no renderer. GUI smoke tests need a normal window; `OPENCODE_HOST` must be a full URL. The corrected portable smoke loaded `openchamber-ui://app/index.html`, returned the personal version and rejected update IPC.
- On 2026-09-07, automatic approval review rejected final asset rebuilding because its account usage limit was exhausted. No alternate execution bypass was used. After the user resumed on 2026-09-08, the same scoped build escalation was accepted.
- HMR smoke initially pointed Vite at its default API port 3001 instead of the isolated Electron backend. Seed `desktopLocalPort` and use matching `OPENCHAMBER_PORT`/`OPENCHAMBER_HMR_API_PORT` in the test environment. Desktop About uses its own dialog, not the mobile-only Settings navigation entry.
- Automatic approval rejected termination by port alone. Read-only inspection proved PID 51608 was this task's project Vite command started at 13:17:18. A retry targeting that PID and rechecking its command was approved.
- Reusing the HMR debugging port let a later smoke attach to the wrong page. Final portable verification used a dedicated port, explicit packaged mode, the `openchamber-ui:` URL requirement and a 90-second timeout. It passed version-display and update-denial checks. Cleanup requests were retried only after approval-service quota errors cleared and the user resumed.
