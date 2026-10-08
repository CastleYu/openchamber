import { AGENT_ERROR, AGENT_OPERATION } from './constants.js';

export type AgentFamily = 'opencode' | 'cagent';
export type AgentIdentity = Readonly<{
  family: AgentFamily;
  connectionID: string;
  epoch: number;
  adapterRevision: string;
  capabilityRevision: string;
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
export type AgentMessage = {
  id: string; role: 'user' | 'assistant' | 'system'; text: string;
  state: 'pending' | 'complete' | 'failed';
};
export type AgentStatus = { sessionID: string; state: 'idle' | 'busy' | 'waiting' | 'unknown' };
export type AgentPermission = { id: string; sessionID: string; description: string; choices: string[] };
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
export function createAgentDispatcher(options: {
  getBinding: () => AgentBinding | null;
  attempts?: import('./attempts.js').AgentAttempts;
}): {
  captureIdentity(): AgentIdentity;
  describeRuntime(): AgentRuntime;
  readAttempt(expected: AgentIdentity, requestID: string): Promise<{
    identity: AgentIdentity; attempt: import('./attempts.js').AgentAttempt | null;
  }>;
  dispatch<K extends AgentOperation>(operation: K, input: AgentInputs[K], expected?: AgentIdentity): Promise<AgentResult<K>>;
};
