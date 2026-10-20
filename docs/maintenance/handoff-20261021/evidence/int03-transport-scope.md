# R2 transport integration scope

Baseline: 3ea7d2d12a32b9f89fd6d5dff84d1104ced03594. Weekly quota: 83 percent remaining.

| Runtime | Behavior |
| --- | --- |
| Web | Admit exact-1.2.27 GET event SSE, directory WS bridge and shared global hub operations; session metadata stays in the host-owned Legacy store. |
| Electron | Reuse the in-process web host; no native privilege or packaging changes. |
| VS Code | Dedicated forwarding remains refused until its separate R2 integration and verification. |
| Hosted mobile | Reuse the selected web host and existing HTTP/event transport. |
| Capacitor mobile | Reuse selected host and existing SSE transport; no local process or new transport. |

The kernel owns session metadata and captured connection identity. The proxy owns request admission and preserves event GET method, directory, headers and abort behavior; generic Legacy SDK HTTP operations remain gated. The global hub owns live stream/replay and rejects retired profile/endpoint/epoch/family events. The autonomous watcher stays refused for Legacy until its later acceptance gate.

Only exact OC1 Legacy 1.2.27 is admitted. Unknown routes, advanced writes and mismatched descriptors remain unavailable before upstream work. This phase does not declare R2 accepted: actual shared UI/host conversation and VS Code remain required.

Performance contract: retain one shared global upstream reader and existing bounded replay/coalescing; no new polling, per-event metadata reads, caches, scans or codecs. Repeated-event and retirement tests cover ordering and work counts. Native/relay acceptance is reported only if exercised.
