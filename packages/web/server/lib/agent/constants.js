export const AGENT_FAMILY = Object.freeze({ OPENCODE: 'opencode', CAGENT: 'cagent' });
export const AGENT_ROLE = Object.freeze({ USER: 'user', ASSISTANT: 'assistant', SYSTEM: 'system', SYNTHETIC: 'synthetic' });
export const AGENT_PART = Object.freeze({ TEXT: 'text', REASONING: 'reasoning', TOOL: 'tool', ATTACHMENT: 'attachment' });
export const AGENT_MESSAGE_STATE = Object.freeze({
  PENDING: 'pending', COMPLETE: 'complete', FAILED: 'failed', INTERRUPTED: 'interrupted', UNKNOWN: 'unknown',
});
export const AGENT_TOOL_STATE = Object.freeze({
  PENDING: 'pending', RUNNING: 'running', COMPLETE: 'complete', FAILED: 'failed', UNKNOWN: 'unknown',
});
export const AGENT_FINISH = Object.freeze({ STOP: 'stop', LENGTH: 'length', INTERRUPTED: 'interrupted', UNKNOWN: 'unknown' });
export const AGENT_MESSAGE_ERROR = Object.freeze({
  BACKEND: 'backend', AUTH: 'auth', LENGTH: 'length', CONTEXT: 'context', INTERRUPTED: 'interrupted', UNKNOWN: 'unknown',
});
export const AGENT_PERMISSION_OUTCOME = Object.freeze({ ALLOW: 'allow', DENY: 'deny' });
export const AGENT_PERMISSION_SCOPE = Object.freeze({ ONCE: 'once', SESSION: 'session', PERSISTENT: 'persistent' });
export const AGENT_SUPPORT = Object.freeze({
  UNVERIFIED: 'unverified', SUPPORTED: 'supported', ADAPTED: 'adapted', UNSUPPORTED: 'unsupported',
});
export const AGENT_ERROR = Object.freeze({
  UNKNOWN_FEATURE: 'unknown-feature', UNMIGRATED: 'unmigrated-consumer', DEPENDENCY: 'missing-dependency',
  UNKNOWN_OPERATION: 'unknown-operation', UNVERIFIED: 'unverified', UNSUPPORTED: 'unsupported',
  UNACCEPTED: 'unaccepted', UNAVAILABLE: 'unavailable', UNAUTHORIZED: 'unauthorized',
  MISSING_HANDLER: 'missing-handler', CHANGED: 'backend-changed', UNKNOWN_OUTCOME: 'unknown-outcome',
  INVALID_INPUT: 'invalid-input', INVALID_RESPONSE: 'invalid-response',
  WRITE_UNAVAILABLE: 'write-unavailable', BACKEND_FAILED: 'backend-failed',
  UNKNOWN_ROUTE: 'unknown-route',
  UNSUPPORTED_RUNTIME: 'unsupported-runtime',
  ATTEMPT_EXISTS: 'attempt-exists', ATTEMPT_STORAGE: 'attempt-storage-failed',
  ATTEMPT_CORRUPT: 'attempt-corrupt',
  ARTIFACT_BOUNDARY: 'artifact-boundary', ARTIFACT_MISMATCH: 'artifact-mismatch', ARTIFACT_UNAVAILABLE: 'artifact-unavailable',
  APPROVAL_STORAGE: 'approval-storage-failed', APPROVAL_CORRUPT: 'approval-corrupt',
});
export const AGENT_FEATURE = Object.freeze({
  ACQUIRE_SESSION: 'acquireSession', SESSION_LIST: 'sessionList', HISTORY: 'history', MESSAGE: 'message',
  CHILDREN: 'children', ACTIVITY: 'activity', PROMPT: 'prompt', COMMAND: 'command', STOP: 'stop',
  PERMISSION: 'permission', SELECTION: 'selection', DEFAULT_MODEL: 'defaultModel', SYNTHETIC: 'synthetic',
  IMPORT: 'import', FORK: 'fork', REMOVE: 'remove', UPDATE: 'update',
});
export const AGENT_APPROVAL = Object.freeze({ VERSION: 1, DIRECTORY: 'agent-approvals', MAX_RECORD_BYTES: 65536 });
export const AGENT_ARTIFACT = Object.freeze({
  VERSION: 1, MAX_FILES: 4096, MAX_FILE_BYTES: 16777216, MAX_TOTAL_BYTES: 134217728,
});
export const AGENT_ATTEMPT = Object.freeze({
  VERSION: 1, DIRECTORY: 'agent-attempts', MAX_RECORD_BYTES: 65536,
  UNKNOWN: 'unknown', ACCEPTED: 'accepted', COMPLETE: 'complete', NOT_SENT: 'not-sent',
});
export const AGENT_FILE_ERROR = Object.freeze({ EXISTS: 'EEXIST', MISSING: 'ENOENT' });
export const AGENT_HOST_OPERATION = Object.freeze({
  CAPTURE_IDENTITY: 'captureIdentity', READ_ATTEMPT: 'readAttempt', GET_BINDING: 'getBinding',
  DESCRIBE_RUNTIME: 'describeRuntime',
  DESCRIBE_FEATURES: 'describeFeatures',
});
export const AGENT_ROUTE = Object.freeze({
  PREFIX: '/api/agent-backend', RUNTIME: '/api/agent-backend/runtime',
  DISPATCH: '/api/agent-backend/dispatch',
  ATTEMPT: '/api/agent-backend/attempt',
  FEATURES: '/api/agent-backend/features',
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
