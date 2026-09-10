# Process performance

`GET /api/system/performance` uses the existing server authentication boundary.
It returns numeric process metrics and executable names, never command lines or paths.
Sampling is demand-driven, shared for five seconds and serialized across clients.
Failures return 503, never an empty successful total.

The root is the active OpenChamber server PID. Desktop hosts the server in its
main process, so descendants include renderers, GPU helpers, managed OpenCode,
MCP servers and terminals. Observed descendants remain tracked after reparenting
only while their PID and creation time match. Processes detached before the first
sample cannot be recovered. External OpenCode services and browser clients are
outside this scope. A remote connection reports the remote server tree.

Windows uses CIM working sets and cumulative kernel/user CPU time. Unix uses ps
RSS and cumulative CPU time. Memory totals can count shared pages more than once;
they are not unique physical memory. CPU is normalized by logical processor count
and needs two samples for each process. The UI keeps 30 samples, cancels requests
when hidden, and clears history on endpoint changes. Pause stops requests.

VS Code does not mount this control because it has no OpenChamber server tree.
Web and mobile clients report their connected server, not their browser process.

## Verification on 2026-09-10

The existing collector tests pass for descendant totals, reparenting, PID reuse,
shared requests and failure recovery. Windows native sampling returned a null CPU
baseline followed by a numeric CPU value. The isolated browser fixture in
`Temp/performance-preview.mjs` uses the real collector route and shared component.
Hover totals, CPU selection, pause/resume and a 390px viewport passed. Pausing
produced zero requests over 5.5 seconds. This verifies the server process tree in
the fixture, not a packaged Electron/OpenCode/MCP workload. UI type checking,
focused Oxlint and the web production build passed. Desktop packaging and macOS /
Linux native sampling were not run in this verification.
