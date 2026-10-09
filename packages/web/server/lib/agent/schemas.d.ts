import type { ZodType } from 'zod';
import type { AgentApproval, AgentRegistration, AgentSelection } from './authority.js';
import type { AgentFeatureSnapshot } from './features.js';
import type { AgentBackendSelection, AgentHostConnection } from './host.js';
import type { AgentAdapterProfile, AgentRequestControl, AgentServerRequest, AgentServerResponse } from './loader.js';
import type { AgentIdentity, AgentInputs, AgentOperation, AgentOutputs, AgentRuntime, JsonValue } from './dispatcher.js';
import type { AgentAttempt, AgentAttemptState } from './attempts.js';
import { AGENT_ERROR } from './constants.js';
import type { AgentConnection } from './transport.js';
import type { AgentAdapter } from './loader.js';
import type { AgentExtensionInput, AgentExtensionReceipt, AgentExtensionSnapshot } from './extension-runtime.js';

export const agentIdentitySchema: ZodType<AgentIdentity>;
export const agentPrincipalSchema: ZodType<string>;
export const agentBackendSelectionSchema: ZodType<AgentBackendSelection>;
export const agentOperationSchema: ZodType<AgentOperation>;
export const agentDispatchRequestSchema: ZodType<{ operation: AgentOperation; identity: AgentIdentity; input: JsonValue }>;
export const agentAttemptRequestSchema: ZodType<{ identity: AgentIdentity; requestID: string }>;
export const agentAttemptStateSchema: ZodType<AgentAttemptState>;
export const agentAttemptSchema: ZodType<AgentAttempt>;
export const agentAttemptResultSchema: ZodType<{ identity: AgentIdentity; attempt: AgentAttempt | null }>;
export const agentFailureSchema: ZodType<{ error: typeof AGENT_ERROR[keyof typeof AGENT_ERROR] }>;
export const agentRequestControlSchema: ZodType<AgentRequestControl>;
export const agentServerRequestSchema: ZodType<AgentServerRequest>;
export const agentServerResponseSchema: ZodType<AgentServerResponse>;
export const agentAdapterSchema: ZodType<AgentAdapter>;
export const agentRegistrationSchema: ZodType<AgentRegistration>;
export const agentSelectionSchema: ZodType<AgentSelection>;
export const agentAdapterProfileSchema: ZodType<AgentAdapterProfile>;
export const agentConnectionSchema: ZodType<AgentConnection>;
export const agentHostConnectionSchema: ZodType<AgentHostConnection>;
export const agentApprovalSchema: ZodType<AgentApproval>;
export const agentRuntimeSchema: ZodType<AgentRuntime>;
export const agentFeatureSnapshotSchema: ZodType<AgentFeatureSnapshot>;
export const agentExtensionInputSchema: ZodType<AgentExtensionInput>;
export const agentExtensionResponseSchema: ZodType<{ result: JsonValue; receipt?: AgentExtensionReceipt }>;
export const agentExtensionResultSchema: ZodType<{ identity: AgentIdentity; result: JsonValue; receipt?: AgentExtensionReceipt }>;
export const agentExtensionSnapshotSchema: ZodType<AgentExtensionSnapshot>;

export const AGENT_INPUT_SCHEMAS: Readonly<{
  [K in AgentOperation]: ZodType<AgentInputs[K]>;
}>;
export const AGENT_OUTPUT_SCHEMAS: Readonly<{
  [K in AgentOperation]: ZodType<AgentOutputs[K]>;
}>;
