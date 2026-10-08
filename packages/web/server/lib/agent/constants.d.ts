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
  UNKNOWN_FEATURE: 'unknown-feature'; UNMIGRATED: 'unmigrated-consumer'; DEPENDENCY: 'missing-dependency';
  ADAPTER_FAILED: 'adapter-load-failed';
  UNKNOWN_OPERATION: 'unknown-operation'; UNVERIFIED: 'unverified'; UNSUPPORTED: 'unsupported';
  UNACCEPTED: 'unaccepted'; UNAVAILABLE: 'unavailable'; UNAUTHORIZED: 'unauthorized';
  MISSING_HANDLER: 'missing-handler'; CHANGED: 'backend-changed'; UNKNOWN_OUTCOME: 'unknown-outcome';
  INVALID_INPUT: 'invalid-input'; INVALID_RESPONSE: 'invalid-response';
  TIMEOUT: 'request-timeout'; CANCELLED: 'request-cancelled';
  WRITE_UNAVAILABLE: 'write-unavailable'; BACKEND_FAILED: 'backend-failed';
  UNKNOWN_ROUTE: 'unknown-route'; UNSUPPORTED_RUNTIME: 'unsupported-runtime';
  ATTEMPT_EXISTS: 'attempt-exists'; ATTEMPT_STORAGE: 'attempt-storage-failed'; ATTEMPT_CORRUPT: 'attempt-corrupt';
  ARTIFACT_BOUNDARY: 'artifact-boundary'; ARTIFACT_MISMATCH: 'artifact-mismatch'; ARTIFACT_UNAVAILABLE: 'artifact-unavailable';
  APPROVAL_STORAGE: 'approval-storage-failed'; APPROVAL_CORRUPT: 'approval-corrupt';
}>;
export const AGENT_FEATURE: Readonly<{
  ACQUIRE_SESSION: 'acquireSession'; SESSION_LIST: 'sessionList'; HISTORY: 'history'; MESSAGE: 'message';
  CHILDREN: 'children'; ACTIVITY: 'activity'; PROMPT: 'prompt'; COMMAND: 'command'; STOP: 'stop';
  PERMISSION: 'permission'; SELECTION: 'selection'; DEFAULT_MODEL: 'defaultModel'; SYNTHETIC: 'synthetic';
  IMPORT: 'import'; FORK: 'fork'; REMOVE: 'remove'; UPDATE: 'update';
}>;
export const AGENT_APPROVAL: Readonly<{
  VERSION: 1; DIRECTORY: 'agent-approvals'; MAX_RECORD_BYTES: 65536; TEMP_SUFFIX: '.tmp';
}>;
export const AGENT_FILE_MODE: Readonly<{ EXCLUSIVE: 'wx'; OWNER_READ_WRITE: 384 }>;
export const AGENT_ADAPTER: Readonly<{ ENTRY: 'adapter.mjs'; FACTORY: 'createAdapter' }>;
export const AGENT_SERVER_METHOD: Readonly<{ GET: 'GET'; POST: 'POST'; PUT: 'PUT'; PATCH: 'PATCH'; DELETE: 'DELETE' }>;
export const AGENT_HTTP: Readonly<{
  HTTP: 'http:'; HTTPS: 'https:'; ACCEPT: 'Accept'; CONTENT_TYPE: 'Content-Type'; JSON: 'application/json';
  REDIRECT: 'manual'; NO_CONTENT: 204; RESET_CONTENT: 205;
  TIMEOUT_MS: 30000; MAX_TIMEOUT_MS: 300000;
}>;
export const AGENT_ARTIFACT: Readonly<{
  VERSION: 1; MAX_FILES: 4096; MAX_FILE_BYTES: 16777216; MAX_TOTAL_BYTES: 134217728;
}>;
export const AGENT_ATTEMPT: Readonly<{
  VERSION: 1; DIRECTORY: 'agent-attempts'; MAX_RECORD_BYTES: 65536;
  UNKNOWN: 'unknown'; ACCEPTED: 'accepted'; COMPLETE: 'complete'; NOT_SENT: 'not-sent';
}>;
export const AGENT_FILE_ERROR: Readonly<{ EXISTS: 'EEXIST'; MISSING: 'ENOENT' }>;
export const AGENT_HOST_OPERATION: Readonly<{
  CAPTURE_IDENTITY: 'captureIdentity'; READ_ATTEMPT: 'readAttempt'; GET_BINDING: 'getBinding';
  DESCRIBE_RUNTIME: 'describeRuntime';
  DESCRIBE_FEATURES: 'describeFeatures';
}>;
export const AGENT_ROUTE: Readonly<{
  PREFIX: '/api/agent-backend'; RUNTIME: '/api/agent-backend/runtime'; DISPATCH: '/api/agent-backend/dispatch';
  ATTEMPT: '/api/agent-backend/attempt';
  FEATURES: '/api/agent-backend/features';
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
export const AGENT_PACKET: Readonly<{
  VERSION: 1; MAX_CORRECTIONS: 2; MAX_FILES: 16; MAX_FILE_BYTES: 262144; MAX_TOTAL_BYTES: 1048576; MAX_CHECKS: 64;
}>;
export const AGENT_PACKET_STATE: Readonly<{ PASSED: 'fixtures-passed'; FAILED: 'fixtures-failed'; BLOCKED: 'blocked' }>;
export const AGENT_PACKET_ERROR: Readonly<{
  INVALID: 'invalid-packet'; PROTECTED: 'protected-kit-changed'; BOUNDARY: 'candidate-boundary';
  INPUT: 'candidate-unavailable'; CHECK: 'fixture-failed'; SETUP: 'check-unavailable';
  STORAGE: 'checkpoint-unavailable'; DEPENDENCY: 'packet-dependency'; LIMIT: 'maintainer-required'; BUSY: 'runner-busy';
}>;
export const AGENT_PACKET_STORAGE: Readonly<{
  MAX_RECORD_BYTES: 65536; DIRECTORY_MODE: 448; READ: 'r'; SUFFIX: '.json'; TEMP_SUFFIX: '.tmp';
  WINDOWS: 'win32'; LINUX: 'linux'; PIPE_PREFIX: string; ABSTRACT_PREFIX: string; BUSY: 'EADDRINUSE'; ERROR: 'error';
}>;
