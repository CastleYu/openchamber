import { AGENT_ERROR, AGENT_FINISH, AGENT_MESSAGE_ERROR, AGENT_MESSAGE_STATE, AGENT_OPERATION, AGENT_PART, AGENT_PERMISSION_OUTCOME, AGENT_PERMISSION_SCOPE, AGENT_ROLE, AGENT_TOOL_STATE } from './constants.js';
import type { AgentExtensionBinding } from './authority.js';

export type AgentFamily = 'opencode' | 'cagent';
export type AgentIdentity = Readonly<{
  family: AgentFamily;
  connectionID: string;
  epoch: number;
  adapterRevision: string;
  capabilityRevision: string;
  principalID?: string;
}>;
export type AgentOperation = typeof AGENT_OPERATION[keyof typeof AGENT_OPERATION];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type WorkspaceInput = { workspaceID: string };
export type SessionInput = WorkspaceInput & { sessionID: string };
export type EffectInput = { requestID: string };
export type PageInput = { cursor?: string; limit?: number };
export type Selection = { model?: string; agent?: string };
export type AgentSession = {
  id: string; workspaceID: string; title?: string; parentID?: string;
  metadata?: { [key: string]: JsonValue };
};
export type AgentMessageError = {
  kind: typeof AGENT_MESSAGE_ERROR[keyof typeof AGENT_MESSAGE_ERROR]; message: string;
};
export type AgentToolState =
  | { status: typeof AGENT_TOOL_STATE.PENDING | typeof AGENT_TOOL_STATE.RUNNING | typeof AGENT_TOOL_STATE.UNKNOWN; input?: JsonValue }
  | { status: typeof AGENT_TOOL_STATE.COMPLETE; input?: JsonValue; output: JsonValue }
  | { status: typeof AGENT_TOOL_STATE.FAILED; input?: JsonValue; error: AgentMessageError; output?: JsonValue };
export type AgentPart =
  | { id: string; type: typeof AGENT_PART.TEXT; text: string; synthetic?: boolean; ignored?: boolean }
  | { id: string; type: typeof AGENT_PART.REASONING; text: string }
  | { id: string; type: typeof AGENT_PART.TOOL; callID: string; name: string; state: AgentToolState }
  | { id: string; type: typeof AGENT_PART.ATTACHMENT; assetID: string; mime: string; filename?: string };
export type AgentMessage = {
  id: string; sessionID: string; role: typeof AGENT_ROLE[keyof typeof AGENT_ROLE]; parts: AgentPart[];
  state: typeof AGENT_MESSAGE_STATE[keyof typeof AGENT_MESSAGE_STATE];
  time?: { created?: number; completed?: number };
  parentID?: string; agent?: string; model?: { id: string; providerID?: string; variant?: string };
  summary?: boolean; finish?: typeof AGENT_FINISH[keyof typeof AGENT_FINISH]; error?: AgentMessageError;
  usage?: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number; cost?: number };
};
export type AgentStatus = { sessionID: string; state: 'idle' | 'busy' | 'waiting' | 'unknown' };
export type AgentPermission = {
  id: string; sessionID: string; description: string;
  choices: {
    id: string; label: string;
    outcome: typeof AGENT_PERMISSION_OUTCOME[keyof typeof AGENT_PERMISSION_OUTCOME];
    scope: typeof AGENT_PERMISSION_SCOPE[keyof typeof AGENT_PERMISSION_SCOPE];
  }[];
};
export type AgentCommand = { id: string; label: string; description?: string };
export type DispatchReceipt =
  | { state: 'accepted'; requestID: string }
  | { state: 'complete'; requestID: string; messageID?: string }
  | { state: 'unknown'; requestID: string; reason: string };
export type AgentPage<T> = { items: T[]; next?: string };

export interface AgentInputs {
  [AGENT_OPERATION.GET_SESSION]: SessionInput;
  [AGENT_OPERATION.CREATE_SESSION]: WorkspaceInput & EffectInput & { title?: string };
  [AGENT_OPERATION.LIST_SESSIONS]: WorkspaceInput & PageInput;
  [AGENT_OPERATION.LIST_MESSAGES]: SessionInput & PageInput;
  [AGENT_OPERATION.LIST_CHILDREN]: SessionInput & PageInput;
  [AGENT_OPERATION.LIST_ACTIVE_STATUSES]: WorkspaceInput;
  [AGENT_OPERATION.GET_SESSION_STATUS]: SessionInput;
  [AGENT_OPERATION.LIST_PENDING_PERMISSIONS]: WorkspaceInput;
  [AGENT_OPERATION.REPLY_PERMISSION]: SessionInput & EffectInput & { permissionID: string; choice: string };
  [AGENT_OPERATION.GET_MESSAGE]: SessionInput & { messageID: string };
  [AGENT_OPERATION.ADD_SYNTHETIC]: SessionInput & EffectInput & { text: string };
  [AGENT_OPERATION.SWITCH_SELECTION]: SessionInput & EffectInput & Selection;
  [AGENT_OPERATION.LIST_COMMANDS]: WorkspaceInput;
  [AGENT_OPERATION.GET_SELECTION_CATALOG]: WorkspaceInput;
  [AGENT_OPERATION.GET_DEFAULT_MODEL]: WorkspaceInput;
  [AGENT_OPERATION.IMPORT_SESSION]: WorkspaceInput & EffectInput & { session: AgentSession; messages: AgentMessage[] };
  [AGENT_OPERATION.FORK_SESSION]: SessionInput & EffectInput & { messageID?: string };
  [AGENT_OPERATION.REMOVE_SESSION]: SessionInput & EffectInput;
  [AGENT_OPERATION.UPDATE_SESSION]: SessionInput & EffectInput & { title?: string; metadata?: { [key: string]: JsonValue } };
  [AGENT_OPERATION.SEND_PROMPT]: SessionInput & Selection & { requestID: string; text: string };
  [AGENT_OPERATION.SEND_COMMAND]: SessionInput & Selection & { requestID: string; commandID: string; arguments: string };
  [AGENT_OPERATION.INTERRUPT_SESSION]: SessionInput & { requestID: string };
}
export interface AgentOutputs {
  [AGENT_OPERATION.GET_SESSION]: AgentSession;
  [AGENT_OPERATION.CREATE_SESSION]: AgentSession;
  [AGENT_OPERATION.LIST_SESSIONS]: AgentPage<AgentSession>;
  [AGENT_OPERATION.LIST_MESSAGES]: AgentPage<AgentMessage>;
  [AGENT_OPERATION.LIST_CHILDREN]: AgentPage<AgentSession>;
  [AGENT_OPERATION.LIST_ACTIVE_STATUSES]: AgentStatus[];
  [AGENT_OPERATION.GET_SESSION_STATUS]: AgentStatus;
  [AGENT_OPERATION.LIST_PENDING_PERMISSIONS]: AgentPermission[];
  [AGENT_OPERATION.REPLY_PERMISSION]: DispatchReceipt;
  [AGENT_OPERATION.GET_MESSAGE]: AgentMessage;
  [AGENT_OPERATION.ADD_SYNTHETIC]: AgentMessage;
  [AGENT_OPERATION.SWITCH_SELECTION]: Selection;
  [AGENT_OPERATION.LIST_COMMANDS]: AgentCommand[];
  [AGENT_OPERATION.GET_SELECTION_CATALOG]: { models: { id: string; label: string }[]; agents: { id: string; label: string }[] };
  [AGENT_OPERATION.GET_DEFAULT_MODEL]: { modelID: string | null };
  [AGENT_OPERATION.IMPORT_SESSION]: AgentSession;
  [AGENT_OPERATION.FORK_SESSION]: AgentSession;
  [AGENT_OPERATION.REMOVE_SESSION]: DispatchReceipt;
  [AGENT_OPERATION.UPDATE_SESSION]: AgentSession;
  [AGENT_OPERATION.SEND_PROMPT]: DispatchReceipt;
  [AGENT_OPERATION.SEND_COMMAND]: DispatchReceipt;
  [AGENT_OPERATION.INTERRUPT_SESSION]: DispatchReceipt;
}
export type AgentHandlers = Partial<{
  [K in AgentOperation]: (input: AgentInputs[K], identity: AgentIdentity) => Promise<AgentOutputs[K]>;
}>;
export type AgentCapability = Readonly<{
  state: 'unverified' | 'supported' | 'adapted' | 'unsupported';
  evidence: readonly string[];
  reason?: string;
}>;
export type AgentAcceptance = Readonly<{
  adapterRevision: string;
  capabilityRevision: string;
  operations: readonly AgentOperation[];
}>;
/** Constructed only by the trusted host after independent acceptance. */
export type AgentBinding = Readonly<{
  identity: AgentIdentity;
  ready: boolean;
  authorized: boolean;
  capabilities: Readonly<Partial<{ [K in AgentOperation]: AgentCapability }>>;
  acceptance: AgentAcceptance | null;
  handlers: AgentHandlers;
  extensions?: readonly AgentExtensionBinding[];
}>;
export type AgentResult<K extends AgentOperation> = { identity: AgentIdentity; data: AgentOutputs[K] };
export type AgentAvailability = { available: true } | {
  available: false; reason: typeof AGENT_ERROR[keyof typeof AGENT_ERROR];
};
export type AgentRuntime = { identity: AgentIdentity; operations: { [K in AgentOperation]: AgentAvailability } };
export class AgentDispatchError extends Error {
  readonly code: string;
  readonly operation: string;
  constructor(code: string, operation: string);
}
export type AgentDispatcher = {
  describeExtensions(): import('./extension-runtime.js').AgentExtensionSnapshot;
  dispatchExtension(actionID: string, input: JsonValue, identity: AgentIdentity): Promise<import('./extension-runtime.js').AgentExtensionResult>;
  forPrincipal(principalID: string): AgentDispatcher;
  captureIdentity(): AgentIdentity;
  describeRuntime(): AgentRuntime;
  readAttempt(expected: AgentIdentity, requestID: string): Promise<{
    identity: AgentIdentity; attempt: import('./attempts.js').AgentAttempt | null;
  }>;
  dispatch<K extends AgentOperation>(operation: K, input: AgentInputs[K], expected?: AgentIdentity): Promise<AgentResult<K>>;
};
export function createAgentDispatcher(options: {
  getBinding: () => AgentBinding | null;
  attempts?: import('./attempts.js').AgentAttempts;
}): AgentDispatcher;
