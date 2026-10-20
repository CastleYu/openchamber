# Provider adoption command notes

- 2026-10-12: PowerShell does not expand Bash brace paths; use explicit paths.
- Repository discovery found `bridge-system-runtime.ts`, `lib/opencode/client.ts`, and `lib/opencode/runtime.ts`; guessed bridge-handler/runtime-client/ProviderAuthDialog paths were absent.
- Windows rg cannot accept a wildcard path as a filename. Use directory searches with `-g`.
- Lifecycle is `packages/web/server/lib/opencode/lifecycle.js`; discover with `rg --files` before reading.
- Several combined reads exceeded output limits. Read focused ranges and cap result size.
- Actual implementation worktree is dijiang-next; helper cdee is only for scoped edit scripts and notes.
- Exact multiline edit anchor failed on CRLF after three single-line changes. Normalize line endings for anchor matching; stop shell execution on nonzero native exit so later checks cannot mask edit failure.
- Agent failure notes were created under helper artifacts, not actual-worktree artifacts. Read the returned helper path before copying evidence into the integration worktree.
