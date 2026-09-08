# Hosting adapter migration guide

This is a design and task input, not an implemented generic provider API. HOST-01 in [PLAN.md](PLAN.md) owns the inventory and final contract review.

## Current starting points

GitHub server code is under `packages/web/server/lib/github/`; its `DOCUMENTATION.md` describes auth, Octokit, repository resolution and PR lookup. The web adapter is `packages/web/src/api/github.ts`. Shared runtime contracts live in `packages/ui/src/lib/api/types.ts`. Shared GitHub status state lives in `useGitHubPrStatusStore.ts`. Electron normally consumes the web runtime; VS Code has its own bridge/API composition.

Do not treat every network client as the same adapter. Local Git operations, code hosting APIs, Linear issue tracking, OpenCode/model providers, release metadata, skills catalogs and relay/tunnel transport have different identities and lifecycles.

## Proposed boundary

Application operations consume platform-neutral repository, issue, change-request, review and check records. A hosting adapter owns endpoint selection, authentication, pagination, rate limits, payload conversion and platform-specific actions. Transport owns HTTP, cancellation, proxy/TLS behavior and request tracing. GitHub-specific fields stay inside its adapter unless an explicit capability requires them.

Define host instance identity using provider kind plus canonical base URL, and repository identity using that host plus the provider's repository identifier. Include account/runtime identity where permissions differ. Owner/name alone is insufficient for multiple internal hosts. Group operation IDs and policy constants in the owning contract module, using existing TypeScript conventions rather than a global bag of unrelated constants.

Start with supported operations from real callers: resolve repository, list/read issues and change requests, read checks/reviews, create/update change requests, and perform explicitly authorized mutations. Expose capabilities per adapter. Unsupported operations are explicit errors; an empty array means a successful empty response. Preserve abort, pagination completeness, stale-response rejection and rate-limit/reset information.

## Replacement steps

1. Inventory all direct SDK, HTTP, `gh` CLI, GitHub URL and credential assumptions. Record the actual caller and owning runtime, including release checks and skills downloads as separate adapters.
2. Propose small contracts from these operations. Review identity, permissions, error semantics and capability differences before implementation.
3. Wrap the existing GitHub implementation and migrate a repository/PR read path through shared UI, web and VS Code. Preserve old persisted GitHub account/repository settings through explicit normalization.
4. Move write/auth operations behind the same boundary with contract tests. Test expired credentials, multiple accounts, host switching and partial failures.
5. Implement the chosen internal platform using its documented API. Configure a host URL and credential source, including private CA/proxy requirements. Keep tokens outside URLs and logs. Validate allowed protocols and prevent server-side requests from reaching unintended hosts through user-controlled URLs.
6. Run one shared adapter conformance suite against deterministic fixtures for both platforms. Then verify real read and authorized write operations on a disposable test repository. Record unsupported capabilities and migration/rollback steps.

## Delivery requirements

Every adapter ships a configuration example without credentials, an operation/capability table, endpoint/auth setup instructions, typed records, error mapping, pagination/cancellation tests and one real integration acceptance record. Document how to add a third provider without editing feature components. Mark internal-platform network validation blocked until the user supplies the platform and test access; fixture success is offline evidence only.
