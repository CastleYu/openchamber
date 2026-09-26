# Context Obligatory Messages

Messages explicitly pinned by the user are stored under
`session.metadata.openchamber.context_obligatory_messages` as `{ id, createdAt,
role }`. The UI uses a fresh-read metadata merge when pinning or unpinning.

The server runtime listens for OpenCode's dedicated `session.compacted` event.
It fetches every pinned message by ID, keeps non-empty text parts, sorts them
by the stored creation time, and immediately sends one synthetic user part
through `prompt_async`. OpenCode's session runner serializes this with its own
post-compaction continuation. Missing individual messages are skipped without
discarding the remaining context. Ordinary idle events perform no work and
make no requests.

With the injected `kernelOperations`, OC2 reads the paged message view and
recognizes a completed `compaction` message. It fetches each pinned message
through the OC2 message route, inserts one synthetic message with `resume:
false`, then merge-patches the cursor in session metadata. OC1 keeps its
`prompt_async` continuation. Both paths reject work whose captured endpoint
or epoch changes before a later write.

After a successful send, the runtime merge-writes
`context_obligatory_last_compaction_message_id`. This cursor prevents a
replayed compaction event from reinjecting the same summary. The runtime is
owned by the OpenChamber web backend and therefore is not available in
extension-only VS Code mode.
