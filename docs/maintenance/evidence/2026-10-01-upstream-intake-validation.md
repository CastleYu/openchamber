# Upstream intake validation checkpoints

This record describes checks during implementation. Final content adoption and branch promotion are recorded in the intake ledger after the remaining source reviews finish.

## Target and product policy

- Latest upstream fetched again during implementation: `1ac782ef6c8a718cf0fdf66306269a25718ad7c7`; latest stable tag remains `v2.0.4`.
- DIJIANG feature version remains `4.0`, with notification-only updates and the portable OC1 default retained.
- Commands use Bun `1.4.2` through a command-local PATH. No user PATH or installed OpenCode was changed.

## Actual kernel and server checks

Both real kernel runs used loopback servers and temporary data. Later runs also isolated the Windows profile and AppData directories. No model request, public tunnel or Docker container was started.

| Kernel | Actual version | Checked behavior |
| --- | --- | --- |
| OC1 | `1.18.33` | Create/read/rename a session; discover its generation; start the full OpenChamber server; query its scoped session proxy; read enterprise policy; keep Spaces absent while off; stop the server and the test-owned kernel. |
| OC2 | `2.0.18` | Create/read a session; commit and reread conditional metadata; discover its generation; start the full OpenChamber server; query its scoped session proxy; read enterprise policy; keep Spaces absent while off; stop the server and the test-owned kernel. |

Exact OC1 `1.2.27` validation remains deferred under the maintainer's compatibility instruction. These checks do not establish native UI, microphone, relay, provider, or container acceptance.

The embedded server stop exposed a missing shutdown owner: its shared global event hub and permission subscriptions survived the watcher stop. Shutdown now stops both explicitly. Nine shutdown tests passed, including repeated stop, cleanup failure isolation and HTTP connection draining.

## Build and protocol checkpoints

- First full `bun run build` completed successfully: SDK, Electron bundle, UI type build, web/PWA, VS Code extension/webview, and mobile web asset staging. Some later source edits still require the final checks.
- SDK isolated test runner: `17/17` files passed with child-process execution available.
- Kernel operations/control regression: `57` tests passed, including accepted OC2 PATCH 204 metadata, runtime retirement before write, default-model/import routes, OC1 pre-dispatch refusals, and browser control.
- Project directory/icon/auth/middleware regression: `54` tests passed.
- Proxy and Space archive tests: `28` passed; the proxy file alone passed `17/17` with real local HTTP/SSE fixtures. This covers first-page Space merge, sanitized list payloads, streaming event order and OC1 OAuth callback path rewriting.
- New catalog identity/Space host-provider fixture plus facade tests: `15` passed. The catalog default uses `ModelInfo.id`; `modelID` is the provider API name and may be shared by derived models.
- Guest catalog parser: `11` passed, including status-only extensions and invalid frame-height refusal.
- Guest asset/CSP tests: `5` passed, including OC2 editor-only assets, OC1 shared panel retention, generation switches and approved-origin policy.
- Settings search: `12` passed in a standalone Bun test process.

Broad UI/Web results, isolated fixture repairs and the non-blocking dead-code report are recorded in [the intake ledger](2026-10-01-upstream-intake.md). A partial or failed broad run is not counted as a passed suite.
