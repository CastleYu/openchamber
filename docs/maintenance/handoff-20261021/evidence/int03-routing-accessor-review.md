# Routing classifier accessor review

## Result

Restored `createRoutingRuntime().classifierEndpoint()` for the two server consumers in `packages/web/server/index.js`. The accessor resolves the current OC2 classifier through `resolveAccess()` and checks runtime identity after asynchronous credential reads. It returns `null` for OC1 and for OC2 when no selected source is usable. Enterprise mode follows the existing policy: only an administrator-pinned custom source can be effective.

The endpoint remains an internal server contract. Credentials are returned only in the endpoint headers for the existing Jev caller; the accessor does not log or persist them.

## Surfaces

- Web server: exposes the accessor to session-work/session-goal consumers. OC2 uses the selected usable source; OC1 and Off return `null`.
- Electron desktop: uses its in-process web backend, with the same runtime policy.
- Hosted and Capacitor mobile: inherit the connected host's server behavior.
- VS Code: has no OpenChamber server Auto routing path.

## Validation

- Focused routing runtime suite: 1 file, 37 tests passed.
- `node --check` passed for `runtime.js` and `runtime.test.js`.
- `bunx oxlint` passed for both changed JavaScript files.
- This does not verify an actual OC2 conversation. The parent agent owns that runtime acceptance.

## Command notes

- The first test attempt failed during Vitest config startup with `spawn EPERM` from esbuild under the default sandbox. Retrying the same focused command with targeted escalation passed.
- An initial discovery command also named a nonexistent `packages/web/server/lib/session-work/index.js`; the real consumers were found in `packages/web/server/index.js` and `lib/session-work/runtime.js`. No source change resulted from that lookup.
