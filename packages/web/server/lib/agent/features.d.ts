import type { AgentAvailability, AgentIdentity, AgentOperation, AgentRuntime } from './dispatcher.js';
import { AGENT_FEATURE } from './constants.js';

export type AgentFeature = typeof AGENT_FEATURE[keyof typeof AGENT_FEATURE];
export const AGENT_CONVERSATION_FEATURES: readonly AgentFeature[];
export type AgentHostSupport = Readonly<{ identity: AgentIdentity; implemented: readonly AgentFeature[] }>;
export type AgentFeatureSnapshot = Readonly<{
  identity: AgentIdentity; features: Readonly<{ [K in AgentFeature]: AgentAvailability }>;
}>;
export const AGENT_FEATURE_RULES: Readonly<{ [K in AgentFeature]: Readonly<{
  all: readonly AgentOperation[]; any: readonly (readonly AgentOperation[])[];
}> }>;
export class AgentFeatureError extends Error {
  readonly code: string;
  readonly feature: string;
  constructor(code: string, feature: string);
}
export function createAgentFeatures(options: {
  getRuntime: () => AgentRuntime;
  getHostSupport?: () => AgentHostSupport | null;
}): {
  describe(): AgentFeatureSnapshot;
  requireFeature(feature: AgentFeature, expected: AgentIdentity): AgentIdentity;
};
