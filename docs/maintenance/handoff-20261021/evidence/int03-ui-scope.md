# R2 shared UI conversation scope

Baseline be235054f. Exact Legacy 1.2.27 remains the only admitted Legacy version.
Web: reuse the OC1 SDK, bounded host HTTP admission and host-owned supplementary metadata.
Electron: reuse the in-process web host, without native changes.
VS Code: retain explicit refusal until its host proxy/SSE/metadata journey is integrated and verified.
Hosted mobile: reuse the selected host, shared SDK and existing event transports.
Capacitor mobile: reuse the selected host and current SSE path.

Bootstrap reads, session/history, prompt/attachments, decisions and stop belong to this phase. Advanced mutations and autonomous callers remain with R3. Preserve SDK wire fields, query/auth/abort and runtime retirement. Actual UI/host journeys and OC1/OC2 regressions are required before R2 acceptance. Finite transport admission is enforced by the host; client operation checks cannot replace it. Metadata remains outside the 1.2.27 upstream schema.
