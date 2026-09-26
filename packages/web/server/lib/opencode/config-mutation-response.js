/**
 * Shared response shapes for OpenCode config mutations.
 *
 * Settings writes persist to disk immediately but defer the OpenCode restart
 * so the UI can accumulate pending changes and apply them once via
 * POST /api/config/reload ("Apply & Restart OpenCode").
 */

export function buildDeferredRestartResponse(message) {
  return {
    success: true,
    requiresReload: false,
    requiresRestart: true,
    restartDeferred: true,
    message,
  };
}

export function buildAppliedResponse(message, details) {
  return { success: true, message, ...(details && typeof details === 'object' ? details : {}) };
}

export function buildExternalManualRestartResponse(message) {
  return {
    success: true,
    requiresReload: false,
    requiresManualRestart: true,
    message,
  };
}
