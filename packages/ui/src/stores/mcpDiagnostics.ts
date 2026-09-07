import type { McpStatus } from '@opencode-ai/sdk/v2';

export type McpStatusMap = Record<string, McpStatus>;
export type McpFailureSource = 'status' | 'connect' | 'auth' | 'test';
export type McpRuntimeDiagnostic = {
  status: 'failed';
  error: string;
  /** When this failure was first observed in its current form. */
  at: number;
  /** Which observation path recorded it: status polling, connect, auth, or test. */
  source: McpFailureSource;
};
export type McpRuntimeDiagnosticMap = Record<string, McpRuntimeDiagnostic>;

/**
 * Folds an authoritative status snapshot into the in-memory failure
 * diagnostics. Diagnostics survive while the live status stays `failed` (they
 * carry the first-seen time the snapshot lacks); they are dropped once the
 * server recovers, and replaced when the failure message changes.
 */
export const mergeMcpDiagnostics = (
  previous: McpRuntimeDiagnosticMap,
  data: McpStatusMap,
  now: number,
) => {
  const next: McpRuntimeDiagnosticMap = {};
  for (const [name, diagnostic] of Object.entries(previous)) {
    if (data[name]?.status === 'failed') {
      next[name] = diagnostic;
    }
  }
  for (const [name, status] of Object.entries(data)) {
    if (status?.status !== 'failed') continue;
    const existing = next[name];
    if (existing && existing.error === status.error) continue;
    next[name] = { status: 'failed', error: status.error, at: now, source: 'status' };
  }
  return next;
};
