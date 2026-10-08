export const AGENT_FAMILY = Object.freeze({ OPENCODE: 'opencode', CAGENT: 'cagent' });
export const AGENT_SUPPORT = Object.freeze({
  UNVERIFIED: 'unverified', SUPPORTED: 'supported', ADAPTED: 'adapted', UNSUPPORTED: 'unsupported',
});
export const AGENT_ERROR = Object.freeze({
  UNKNOWN_OPERATION: 'unknown-operation', UNVERIFIED: 'unverified', UNSUPPORTED: 'unsupported',
  UNACCEPTED: 'unaccepted', UNAVAILABLE: 'unavailable', UNAUTHORIZED: 'unauthorized',
  MISSING_HANDLER: 'missing-handler', CHANGED: 'backend-changed', UNKNOWN_OUTCOME: 'unknown-outcome',
  INVALID_INPUT: 'invalid-input', INVALID_RESPONSE: 'invalid-response',
  WRITE_UNAVAILABLE: 'write-unavailable', BACKEND_FAILED: 'backend-failed',
  UNKNOWN_ROUTE: 'unknown-route',
  UNSUPPORTED_RUNTIME: 'unsupported-runtime',
});
export const AGENT_ROUTE = Object.freeze({
  PREFIX: '/api/agent-backend', RUNTIME: '/api/agent-backend/runtime',
  DISPATCH: '/api/agent-backend/dispatch',
});
export const AGENT_OPERATION = Object.freeze({
  GET_SESSION: 'getSession', CREATE_SESSION: 'createSession', LIST_SESSIONS: 'listSessions',
  LIST_MESSAGES: 'listMessages', LIST_CHILDREN: 'listChildren', LIST_ACTIVE_STATUSES: 'listActiveStatuses',
  GET_SESSION_STATUS: 'getSessionStatus', LIST_PENDING_PERMISSIONS: 'listPendingPermissions',
  REPLY_PERMISSION: 'replyPermission', GET_MESSAGE: 'getMessage', ADD_SYNTHETIC: 'addSynthetic',
  SWITCH_SELECTION: 'switchSessionSelection', LIST_COMMANDS: 'listCommands',
  GET_SELECTION_CATALOG: 'getSelectionCatalog', GET_DEFAULT_MODEL: 'getDefaultModel',
  IMPORT_SESSION: 'importSession', FORK_SESSION: 'forkSession', REMOVE_SESSION: 'removeSession',
  UPDATE_SESSION: 'updateSession', SEND_PROMPT: 'sendPrompt', SEND_COMMAND: 'sendCommand',
  INTERRUPT_SESSION: 'interruptSession',
});
export const AGENT_MUTATIONS = Object.freeze([
  AGENT_OPERATION.CREATE_SESSION, AGENT_OPERATION.REPLY_PERMISSION, AGENT_OPERATION.ADD_SYNTHETIC,
  AGENT_OPERATION.SWITCH_SELECTION, AGENT_OPERATION.IMPORT_SESSION, AGENT_OPERATION.FORK_SESSION,
  AGENT_OPERATION.REMOVE_SESSION, AGENT_OPERATION.UPDATE_SESSION, AGENT_OPERATION.SEND_PROMPT,
  AGENT_OPERATION.SEND_COMMAND, AGENT_OPERATION.INTERRUPT_SESSION,
]);
