# Agent dispatch contracts

This module starts CA-01. It is not connected to production server composition yet and does not enable CAgent. Current OpenCode runtime behavior is unchanged. The remaining migration is tracked in [the execution checkpoint](../../../../../docs/maintenance/CAGENT-EXECUTION.md).

`constants.js` owns backend-family, support, operation and refusal constants. `dispatcher.d.ts` defines runtime-neutral requests/results for the 22 effect/read operations consumed by the host inventory. Identity capture is the 23rd host operation and belongs to the dispatcher rather than the adapter. Workspace IDs are backend-owned identifiers, never implicit local directories. No SDK raw payload is required by these contracts. More detailed message/decision contracts and UI operations must be added from consumer semantics before their migration is accepted.

`createAgentDispatcher({ getBinding })` reads host authority at call time. The adapter supplies handlers and candidate support; a separate host-owned acceptance record grants access for an exact adapter and capability revision. A supported declaration without evidence and matching acceptance is refused. Unverified, unsupported, auth failure, not-ready and missing-handler outcomes remain distinct.

Dispatch captures a copy of backend identity and checks it again before entering a handler. After an identity change, reads reject stale data. Mutations that already entered the handler report an unknown outcome. This module performs no retry, fallback or cross-backend replay. Handler failures without an identity change propagate unchanged. Durable attempt storage and operation-specific wire parsing are still required before integrating mutations in production.

Host composition must supply normalized, immutable bindings. It must keep activation records and handler registration outside the environment-local agent's writable files. A manifest cannot construct this authority directly. Network/bridge inputs still require boundary parsing, and each handler parses the real server's response before returning domain data.

| Runtime | Current behavior |
| --- | --- |
| Web | Module-level contract and refusal tests only; production CAgent unavailable until composition/routes are connected. |
| Electron | Same in-process web backend; no separate protocol implementation. CAgent unavailable. |
| VS Code | Portable module intended for extension host; no bridge integration yet. CAgent unavailable. |
| Hosted mobile | Existing selected OpenChamber server behavior; CAgent unavailable. |
| Capacitor | Existing selected OpenChamber server behavior; CAgent unavailable. |

Focused validation uses the package Vitest runner on `server/lib/agent/dispatcher.test.js` and `contracts.test.ts`. Directly compile `contracts.test.ts` with the installed TypeScript compiler as well. Its compile-only calls check operation-specific results, complete operation-key coverage and rejection of missing workspace/request identity and unknown operations. The web workspace's normal type-check includes UI/src, not server declaration files. Static/module checks cannot establish host journeys or real CAgent compatibility.
