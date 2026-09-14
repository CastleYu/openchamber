# Process performance

`GET /api/system/performance` uses the existing server authentication boundary.
It returns numeric process metrics and executable names, never command lines or paths.
Sampling is demand-driven, shared for five seconds and serialized across clients.
Failures return 503, never an empty successful total.

## Failure reports

Normal desktop builds write `[performance]` failures to the existing rotating
Electron `main.log`. Records contain a diagnostic UUID, query/JSON/schema/root/
aggregation stage, native operation and numeric error code, duration, retry
count and runtime version. They omit commands, paths, credentials and raw stderr.
Identical failures reuse the UUID and log at most once per minute; recovery logs
the same UUID and accumulated failure count. A 503 includes that UUID.

The performance panel's Export diagnostics button saves the latest 100 client
failure/recovery records as `openchamber-performance.json`. Export before closing
or reloading the window. It distinguishes transport, HTTP, JSON and schema errors
and preserves the server UUID. Send this file, the matching `[performance]` lines
from `main.log` (and `main.old.log` when rotated), the approximate failure time,
and whether the window was visible, minimized or in the tray. The exported client
file contains no session content, project paths or endpoint credentials.

The root is the active OpenChamber server PID. Desktop hosts the server in its
main process, so descendants include renderers, GPU helpers, managed OpenCode,
MCP servers and terminals. Observed descendants remain tracked after reparenting
only while their PID and creation time match. Processes detached before the first
sample cannot be recovered. External OpenCode services and browser clients are
outside this scope. A remote connection reports the remote server tree.

Windows uses one Toolhelp process snapshot to discover the tree, then native
process handles for working sets, creation times and cumulative kernel/user CPU
time. It requests only limited query access. A hidden PowerShell process compiles
the embedded interop code for each sample; neither WMI nor an installed helper is
required. The sampling process is excluded. Unavailable metrics fail the sample
instead of returning an authoritative partial total. Unix uses ps
RSS and cumulative CPU time. Memory totals can count shared pages more than once;
they are not unique physical memory. CPU is normalized by logical processor count
and needs two samples for each process. The UI keeps 30 samples, cancels requests
when hidden, and clears history on endpoint changes. Pause stops requests.

VS Code does not mount this control because it has no OpenChamber server tree.
Web and mobile clients report their connected server, not their browser process.

## Debug snapshots

Desktop versions ending in `-DEBUG` enable `GET /api/system/performance/debug`.
Other desktop builds return 404. Standalone web development can opt in with
`OPENCHAMBER_PERFORMANCE_DEBUG=1`. The route uses the same authentication gate
as the panel, and does not provide access to commands, paths or credentials.

Schema version 2 returns the panel's timestamp and aggregate totals in `sample`,
including `processCount`, from the same five-second cache and in-flight query.
`topProcesses` contains at most ten included processes ranked by memory, and
`omittedProcesses` reports the omitted count. Totals still cover the entire tree.
The ordinary panel endpoint retains its full process list.

`collection.durationMs` reports sampler cost. `runtime` contains the server PID,
desktop version, uptime and Node memory usage. `system` reports physical memory
totals and availability. Memory values are bytes, CPU is a percentage of all
logical cores, and an unavailable baseline remains null. Raw queried rows,
creation identities, cumulative CPU, duplicate memory counters, dependency
versions and V8 heap-space dumps are no longer returned or retained as debug
data. Only the latest summary is retained. VS Code has no local implementation.

## Windows sampler verification on 2026-09-11

Five alternating samples on the same running OpenCode tree each reported 227
processes. The previous CIM reader took 1164 ms median and 1311 ms maximum;
the native reader took 448 ms median and 483 ms maximum. These are collector
latencies, not a measurement of total system CPU improvement. Native tests cover
descendant metrics, sampler exclusion and a detached child surviving its parent.

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
