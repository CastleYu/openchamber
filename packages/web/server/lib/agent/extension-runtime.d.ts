import type { ZodType } from 'zod';
import type { AgentBinding, AgentIdentity, AgentAvailability, JsonValue } from './dispatcher.js';
import type { AgentAttempts } from './attempts.js';
import type { ExtensionManifest, ExtensionResult } from './extensions.js';
export interface AgentExtensionRequest { actionID: string; identity: AgentIdentity; input: JsonValue }
export interface AgentExtensionInput {
  workspaceID?: string; sessionID?: string; requestID?: string; values: JsonValue;
}
export interface AgentExtensionReceipt { requestID: string; state: 'accepted' | 'complete' | 'unknown' }
export interface AgentExtensionResult {
  identity: AgentIdentity; result: ExtensionResult;
  receipt?: AgentExtensionReceipt;
}
export interface AgentExtensionSnapshot {
  identity: AgentIdentity; actions: { manifest: ExtensionManifest; availability: AgentAvailability }[];
}
export const agentExtensionRequestSchema: ZodType<AgentExtensionRequest>;
export function createAgentExtensionRuntime(options: {
  getBinding(): AgentBinding | null; attempts?: AgentAttempts;
}): {
  describe(identity: AgentIdentity): AgentExtensionSnapshot;
  dispatch(actionID: string, input: JsonValue, identity: AgentIdentity): Promise<AgentExtensionResult>;
};
