# CAgent consumer contract migration

Status: design requirement, 2026-10-09. This is a CA-01 acceptance requirement, not an implemented CAgent sync source. Read with the [architecture SPEC](CAGENT-INTEGRATION-SPEC.md) and [consumer inventory](CAGENT-BOUNDARIES.md). The [Chinese review copy](zh-CN/CAGENT-CONSUMER-CONTRACT.md) carries the same requirements.

## Why the existing projection is insufficient

Source inspection found mandatory OpenCode facts in [the UI model](../../packages/ui/src/lib/opencode/model.ts): session `projectID`, absolute `directory`, creation/update times and assistant provider/model fields. [SyncSource](../../packages/ui/src/sync/source.ts) accepts only OC1/OC2, sorts history by message time and requires OpenCode-oriented project, configuration and catalog bootstrap operations. Its existing wire tags are not a CAgent protocol contract.

The host's neutral Agent contracts and shared request client are a foundation. They do not make these consumers backend-neutral. Do not enable a host feature until its actual UI, store, sync and autonomous consumers have completed migration. A successful host handler or passing adapter fixture alone cannot meet that requirement.

## Contract ownership

The architecture owner changes the shared consumer contracts and their callers before CA-02 freezes the kit. The environment-local agent implements only generated mappings and bounded codecs against those frozen contracts. Discovering an incompatible shared requirement returns a host-development request; it does not expand the local agent's editable files.

Keep existing OC1/OC2 projection and regression coverage during incremental migration. Add explicit backend-family ownership to a neutral source, without labeling CAgent as OC1/OC2. Any separate CAgent presentation must have a recorded feature disposition and use the same identity, dispatch and availability authorities. A separate presentation is not permission to silently omit inventory rows.

## Missing facts and affected consumers

| Fact | Required consumer behavior | Evidence gate |
| --- | --- | --- |
| Workspace ID and local directory | Keep the remote opaque ID. Bind a local directory only through an explicit verified host mapping. Disable path-dependent Git, file and terminal operations without that mapping. | Two independent workspaces, including one without local filesystem access, cannot read or mutate each other's state. |
| Project identity | Make project enrichment optional for CAgent conversation bootstrap. An absent project API is not an empty authoritative project list. | Core chat starts with verified conversation/workspace binding even when optional project enrichment is unavailable. |
| Message/session timestamps | Retain missing timestamps. Display unavailable chronology and omit timestamp-dependent duration/grouping. Preserve documented page/event order with a stable local tie-breaker; local receipt time may be stored separately and labeled as such. | Missing/equal timestamps, multiple pages and overlapping history/live updates preserve order and identity. No generated timestamp is reported as server chronology. |
| Provider, model, agent and usage | Show only verified values. Disable model selection without its catalog/set operation, and omit unavailable cost/token metrics. | A message with no provider/model/usage renders and reopens without invented identifiers, zero-cost claims or changing the selected backend. |
| Tool progress/result | Preserve ordered parts and distinguish running, succeeded, failed, interrupted and unknown states. Receipt or stream closure is not tool completion. | Partial output, error and lost terminal evidence cannot render as successful completion. |
| Config, LSP and catalogs | Separate optional enrichments from the minimum bootstrap. Report unsupported, unverified or failed reads individually. | One failed enrichment does not erase successful conversation/history data or suppress the capability reason. |
| Decisions | Preserve documented choices, scope and pending state. Questions/forms need their own accepted typed contracts. | A decision-dependent mode stays disabled until both delivery and reply semantics work; no missing decision API grants approval. |
| Outcome observation | Use accepted events or a separately tested status/history polling strategy. Declare polling cost and latency. | Reconnect and late results remain bound to the current identity. An unobservable entered write remains unknown and is not automatically resubmitted. |

Derived labels may use a localized untitled-session label. This is presentation text, not a server title update. Domain identifiers and authoritative server fields keep their provenance.

## Adaptation packet rule

Each operation page distinguishes required semantics from optional enrichment and lists the consumers of every required field. Its mapping records one of: documented value, verified transformation, documented absence, or unresolved evidence. The protected runner validates this record before generating candidate code.

For example, documentation with conversation ID and ordered messages but no timestamps must produce a timestamp-free mapping and chronology limitations. It must not generate `Date.now()` into server fields, fabricate a project path, choose a default OpenCode provider or return an empty catalog to satisfy bootstrap. This is a synthetic decision example, not a claim about CAgent's API.

The runner's baseline digests, checks, expected dispositions and packet dependencies come from the maintainer-owned frozen kit outside the agent's writable files. Rehashing a modified workspace cannot establish trust. Read-only permissions and independent checks both need evidence in CA-02; a file allowlist or model-written pass report alone is insufficient. Adapter execution in the trusted host remains native code execution, not a process sandbox.

## Acceptance and sequence

CA-01 records the affected callers from the complete inventory and migrates the minimum chat/sync consumers plus all refusal paths. Tests cover a synthetic backend without OpenCode-specific enrichment, retained OC1/OC2 behavior, backend switching and direct/autonomous refusal. Every feature row names its migrated consumers or remains unavailable with a reason.

CA-02 packages the frozen consumer contracts, per-field mapping rules and protected negative examples. Its fresh-context exercise includes a missing timestamp/provider case, an absent local-directory mapping and an attempt to change a protected expectation. The runner must produce the prescribed disposition without guessing facts or allowing the model to change the test.

CA-03 validates the actual environment's semantics and user journeys. Synthetic sparse-backend tests do not establish CAgent compatibility. The urgent sequence remains INT-00, CA-00, CA-01, CA-02, CA-03, then the other INT milestones. No later Legacy or UI milestone may silently bypass the CAgent priority gate.
