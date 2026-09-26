# OpenChamber session routes

`routes.js` owns the `/api/openchamber/sessions` create, send, fork, archive, unarchive, and metadata routes. Server-side OpenCode calls go through `kernelOperations`. A request captures its generation, endpoint, and epoch before deferred work. A changed runtime rejects the request before another mutation.

## Generation behavior

- OC1 keeps the existing create, fork, prompt, command, model selection, and archive responses. Archive writes `session.update` with `time.archived` through `kernelOperations`; one failed ID goes in `failedIds` and does not stop the batch.
- OC2 uses OpenCode's session and message operations. It stores archive state locally because OpenCode 2.x has no archive write route. `/api/openchamber/sessions/unarchive` and the metadata routes are available only on OC2.
- Before an OC2 `/fork` route dispatches its prompt, `fork-inheritance.js`
  removes source-owned BTW/review links, pauses an active inherited goal, and
  copies a file-backed goal objective to the fork's session ID. A file write
  failure inlines the objective in metadata. A metadata failure cleans the
  copied file. The route then removes only the new OC2 fork before returning
  the inheritance error. If rollback fails or the runtime changes, it reports
  the fork as partial and never deletes against a newer runtime. OC1 keeps its
  existing fork response and does not read OC2 goal
  files. Every await is checked against the captured kernel identity.
- OC2 session metadata lives on the OpenCode record. `kernelOperations.updateSession` owns the read, RFC 7386 merge, and per-session serialization for routes and autonomous writers. The metadata store handles only older OC2 `sessions-metadata.json` entries; it must never process an OC1 file. Before an OC2 session read or ordinary metadata write, the kernel calls `prepareSessionMetadata` for that session. It pushes a legacy entry with the replacement path, retires that entry on disk, then lets the read or patch continue. The replacement path skips preparation to avoid calling itself.

## Storage ownership

Each storage scope has one cached archive store and metadata store. Cold callers
recheck that cache after resolving the scope directory, so concurrent first
requests share the stores' transaction queues and in-memory state.

`storage-scope.js` assigns existing root `sessions-archive.json` and `sessions-metadata.json` files to the first valid OC2 storage scope. It records that owner in `sessions-storage-owner.json`. The owner keeps using the root files; another OC2 scope gets `session-scopes/<sha256(scope)>/`. The managed scope is the stable string `managed`, independent of the managed server's changing port. External scopes include their endpoint. No OC1 request reads, migrates, or writes these files.

The proxy obtains archive and unmigrated metadata overlays from `getArchivedSessions()` and `getStoredSessionMetadata()`. Both return `null` on OC1. A failed store read throws so the proxy cannot mistake an unknown overlay for an empty one. Unmigrated entries stay visible until their first session access. A failed file retirement leaves its entry pending and blocks ordinary writes to that session until retirement succeeds; unrelated sessions continue. `migrateStoredSessionMetadata()` remains available for an optional OC2 sweep.
