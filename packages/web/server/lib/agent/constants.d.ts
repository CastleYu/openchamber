export const AGENT_FAMILY: Readonly<{ OPENCODE: 'opencode'; CAGENT: 'cagent' }>;
export const AGENT_ROLE: Readonly<{ USER: 'user'; ASSISTANT: 'assistant'; SYSTEM: 'system'; SYNTHETIC: 'synthetic' }>;
export const AGENT_PART: Readonly<{ TEXT: 'text'; REASONING: 'reasoning'; TOOL: 'tool'; ATTACHMENT: 'attachment' }>;
export const AGENT_MESSAGE_STATE: Readonly<{
  PENDING: 'pending'; COMPLETE: 'complete'; FAILED: 'failed'; INTERRUPTED: 'interrupted'; UNKNOWN: 'unknown';
}>;
export const AGENT_TOOL_STATE: Readonly<{
  PENDING: 'pending'; RUNNING: 'running'; COMPLETE: 'complete'; FAILED: 'failed'; UNKNOWN: 'unknown';
}>;
export const AGENT_FINISH: Readonly<{ STOP: 'stop'; LENGTH: 'length'; INTERRUPTED: 'interrupted'; UNKNOWN: 'unknown' }>;
export const AGENT_MESSAGE_ERROR: Readonly<{
  BACKEND: 'backend'; AUTH: 'auth'; LENGTH: 'length'; CONTEXT: 'context'; INTERRUPTED: 'interrupted'; UNKNOWN: 'unknown';
}>;
export const AGENT_PERMISSION_OUTCOME: Readonly<{ ALLOW: 'allow'; DENY: 'deny' }>;
export const AGENT_PERMISSION_SCOPE: Readonly<{ ONCE: 'once'; SESSION: 'session'; PERSISTENT: 'persistent' }>;
export const AGENT_SUPPORT: Readonly<{
  UNVERIFIED: 'unverified'; SUPPORTED: 'supported'; ADAPTED: 'adapted'; UNSUPPORTED: 'unsupported';
}>;
export const AGENT_ERROR: Readonly<{
  UNKNOWN_OPERATION: 'unknown-operation'; UNVERIFIED: 'unverified'; UNSUPPORTED: 'unsupported';
  UNACCEPTED: 'unaccepted'; UNAVAILABLE: 'unavailable'; UNAUTHORIZED: 'unauthorized';
  MISSING_HANDLER: 'missing-handler'; CHANGED: 'backend-changed'; UNKNOWN_OUTCOME: 'unknown-outcome';
  INVALID_INPUT: 'invalid-input'; INVALID_RESPONSE: 'invalid-response';
  WRITE_UNAVAILABLE: 'write-unavailable'; BACKEND_FAILED: 'backend-failed';
  UNKNOWN_ROUTE: 'unknown-route'; UNSUPPORTED_RUNTIME: 'unsupported-runtime';
  ATTEMPT_EXISTS: 'attempt-exists'; ATTEMPT_STORAGE: 'attempt-storage-failed'; ATTEMPT_CORRUPT: 'attempt-corrupt';
}>;
export const AGENT_ATTEMPT: Readonly<{
  VERSION: 1; DIRECTORY: 'agent-attempts'; MAX_RECORD_BYTES: 65536;
  UNKNOWN: 'unknown'; ACCEPTED: 'accepted'; COMPLETE: 'complete'; NOT_SENT: 'not-sent';
}>;
export const AGENT_FILE_ERROR: Readonly<{ EXISTS: 'EEXIST'; MISSING: 'ENOENT' }>;
export const AGENT_HOST_OPERATION: Readonly<{
  CAPTURE_IDENTITY: 'captureIdentity'; READ_ATTEMPT: 'readAttempt'; GET_BINDING: 'getBinding';
  DESCRIBE_RUNTIME: 'describeRuntime';
}>;
export const AGENT_ROUTE: Readonly<{
  PREFIX: '/api/agent-backend'; RUNTIME: '/api/agent-backend/runtime'; DISPATCH: '/api/agent-backend/dispatch';
  ATTEMPT: '/api/agent-backend/attempt';
}>;
export const AGENT_OPERATION: Readonly<{
  GET_SESSION: 'getSession'; CREATE_SESSION: 'createSession'; LIST_SESSIONS: 'listSessions';
  LIST_MESSAGES: 'listMessages'; LIST_CHILDREN: 'listChildren'; LIST_ACTIVE_STATUSES: 'listActiveStatuses';
  GET_SESSION_STATUS: 'getSessionStatus'; LIST_PENDING_PERMISSIONS: 'listPendingPermissions';
  REPLY_PERMISSION: 'replyPermission'; GET_MESSAGE: 'getMessage'; ADD_SYNTHETIC: 'addSynthetic';
  SWITCH_SELECTION: 'switchSessionSelection'; LIST_COMMANDS: 'listCommands';
  GET_SELECTION_CATALOG: 'getSelectionCatalog'; GET_DEFAULT_MODEL: 'getDefaultModel';
  IMPORT_SESSION: 'importSession'; FORK_SESSION: 'forkSession'; REMOVE_SESSION: 'removeSession';
  UPDATE_SESSION: 'updateSession'; SEND_PROMPT: 'sendPrompt'; SEND_COMMAND: 'sendCommand';
  INTERRUPT_SESSION: 'interruptSession';
}>;
export const AGENT_MUTATIONS: readonly typeof AGENT_OPERATION[keyof typeof AGENT_OPERATION][];
