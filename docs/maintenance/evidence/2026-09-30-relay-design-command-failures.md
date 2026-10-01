# Relay design discovery failures

- Searches against `packages/web/server/routes` and `packages/electron/lib/ssh*` failed because those paths do not exist. Discover paths with `rg --files` first. The SSH implementation is `packages/electron/ssh-manager.mjs`.
- The relay source references `.opencode/plans/private-relay/01-protocol-spec.md`, but `.opencode/plans` is absent in this checkout. Use the current relay module documentation and executable protocol implementations as evidence; do not treat the missing specification as reviewed.
- Large combined reads were truncated. Use focused file ranges for evidence and do not infer content from omitted output.
- A follow-up search guessed `packages/web/server/lib/api/routes/core-routes.js`, which is also absent. Resolve `core-routes` with `rg --files packages/web` before reading it.
