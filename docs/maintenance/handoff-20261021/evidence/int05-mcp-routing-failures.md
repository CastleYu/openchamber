# INT-05 command corrections

- Repository file discovery must use rg --files before reads. Guessed kernel-operations.legacy.test.js, UI settings/McpPage.tsx, packages/web/server/DOCUMENTATION.md and packages/web/DOCUMENTATION.md paths did not exist. The owners are kernel-operations.test.js, components/sections/mcp/McpPage.tsx and server/lib/opencode/DOCUMENTATION.md.
- Windows rg --files emits mixed separators. Avoid slash-only path filters when locating DOCUMENTATION.md; match the filename suffix.
- VS Code type checking initially caught optional manager access in the new branch; the branch now requires ctx.manager. Recheck passed.
- A guessed src/lib/startMcpAuthorization.ts read failed after discovery; use the returned components/sections/mcp/startMcpAuthorization.ts path directly.

Evidence filename collision: persistence driver/evidence temporarily replaced earlier protocol artifacts. Moved persistence artifacts to unique int05-mcp-persistence-live names, restored original protocol driver from untouched helper, and reran protocol acceptance to regenerate genuine evidence. Historical checkpoint remains unchanged.

Root type-check uses parallel workspace execution and exhausted Node heap in web (exit 134). Use sequential workspace checks with NODE_OPTIONS=--max-old-space-size=6144; do not run concurrent full checks.

Two exploratory reads used guessed configs.js and dual-kernel-routes.test.js paths and failed with ENOENT. Use rg --files before selecting any further path. Response review restricted the added saved/revealed fields to exact Legacy; ordinary OC1 keeps its existing deferred response.

Read attempted final Web build log before that sequential step had started (file missing); future progress reads must test existence first.

Sandbox read of Win32_Process was denied during optional build progress inspection; skipped repeat because build logs were sufficient. Dead-code review found one newly unnecessary exported UI type; retained the type locally and removed its export.

Astra credential review command corrections: Windows rg does not expand wildcard path arguments (os error 123); use a concrete directory with -g filters. Two guessed UI paths were replaced with paths discovered by rg --files. No production files changed during the review.
