export type McpFailureClass =
  | 'windowsCmdShim'
  | 'commandNotFound'
  | 'connectionRefused'
  | 'processClosed'
  | 'timeout'
  | 'authRejected'
  | 'oauthRegistration'
  | 'certificate'
  | 'wrongAddress';

export type McpFailureHintKey =
  | `settings.mcp.page.failure.${McpFailureClass}.cause`
  | `settings.mcp.page.failureHint.${McpFailureClass}`;

export interface McpFailureHint {
  causeKey: McpFailureHintKey;
  hintKey: McpFailureHintKey;
}

type FailureRule = {
  class: McpFailureClass;
  pattern: RegExp;
};

// Ordered: the first match wins, so Windows' "not recognized" phrasing must be
// classified before the generic command-not-found rule, and oauth markers
// before the wider 401/403 rule.
const FAILURE_RULES: readonly FailureRule[] = [
  { class: 'windowsCmdShim', pattern: /not recognized as an internal or external command|'\S+\.cmd'/i },
  { class: 'commandNotFound', pattern: /\benoent\b|\bspawn\b|command not found|is not recognized|no such file or directory|program not found/i },
  { class: 'connectionRefused', pattern: /\beconnrefused\b|connection refused|\benotfound\b|\beai_again\b|getaddrinfo|no address associated/i },
  { class: 'processClosed', pattern: /\beconnreset\b|connection (closed|reset)|socket hang up|premature close|process (exited|terminated)|exited with code/i },
  { class: 'timeout', pattern: /\btimeout\b|timed? ?out|\betimedout\b|\bdeadline\b/i },
  { class: 'oauthRegistration', pattern: /invalid_client|unauthorized_client|client registration|access_denied/i },
  { class: 'authRejected', pattern: /\b40[13]\b|unauthorized|forbidden|invalid[ _-]?api[ _-]?key|invalid[ _-]?token|authentication (failed|required)|missing credentials/i },
  { class: 'certificate', pattern: /\bcert(ificate)?\b|self-?signed|\bssl\b|\btls\b|err_cert/i },
  { class: 'wrongAddress', pattern: /\b404\b|\bnot found\b/i },
];

const CAUSE_KEY_PREFIX = 'settings.mcp.page.failure';
const HINT_KEY_PREFIX = 'settings.mcp.page.failureHint';

/**
 * Classifies an OpenCode-reported MCP failure string into a known failure
 * class and the i18n keys for its likely cause and suggested action.
 * Returns null for unknown errors — callers keep showing the raw text.
 */
export const describeMcpFailure = (rawError: string | null | undefined): McpFailureHint | null => {
  const raw = (rawError ?? '').trim();
  if (!raw) return null;

  for (const rule of FAILURE_RULES) {
    if (rule.pattern.test(raw)) {
      return {
        causeKey: `${CAUSE_KEY_PREFIX}.${rule.class}.cause`,
        hintKey: `${HINT_KEY_PREFIX}.${rule.class}`,
      };
    }
  }
  return null;
};
