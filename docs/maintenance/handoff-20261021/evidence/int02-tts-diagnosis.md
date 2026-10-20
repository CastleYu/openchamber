# TTS regression diagnosis

- Date: 2026-10-11
- Requested focused command: `C:\nvm4w\nodejs\node.exe packages/web/node_modules/vitest/vitest.mjs run --config packages/web/vitest.config.ts packages/web/server/lib/tts/service.test.js --reporter=verbose`
- Result: exit 0; 1 test file passed, 2 tests passed; duration 1.05s. The case logged its local mock URL and completed in 300ms.
- The interrupted host log ended immediately after the same TTS case logged `Generating speech`, without a test completion line. This does not establish a TTS defect: the isolated test passes quickly in this worktree.
- `service.test.js` runs an in-process loopback HTTP server, consumes request body, responds with audio bytes, and closes all connections in `afterEach`. Production service awaits `client.audio.speech.create()` and then response `arrayBuffer()`. Focused pass exercises this full mock request/response path.
- Process inventory via `Get-CimInstance Win32_Process` failed with Access Denied; recorded separately. There was no resumable job handle. Cannot establish whether the old host invocation stalled, was interrupted during ordinary await, or suffered cross-test interference.
- No source changes. No minimal fix supported by current evidence. Parent should treat TTS as non-reproduced and continue with host-level interaction/isolation if needed.
