import type { AgentBinding, AgentCapability, AgentFamily, AgentHandlers, AgentIdentity, AgentOperation } from './dispatcher.js';

export type AgentRegistration = Readonly<{
  adapterID: string;
  family: AgentFamily;
  adapterRevision: string;
  capabilityRevision: string;
  artifactDigest: string;
  capabilities: Readonly<Partial<{ [K in AgentOperation]: AgentCapability }>>;
  handlers: AgentHandlers;
}>;
export type AgentSelection = AgentIdentity & Readonly<{
  adapterID: string;
  serverRevision: string;
  ready: boolean;
  authorized: boolean;
}>;
export type AgentApproval = Readonly<{
  family: AgentFamily;
  connectionID: string;
  adapterID: string;
  adapterRevision: string;
  capabilityRevision: string;
  serverRevision: string;
  artifactDigest: string;
  operations: readonly Readonly<{ operation: AgentOperation; evidence: readonly string[] }>[];
}>;
/** Both callbacks are trusted host ports. Adapter manifests cannot supply them. */
export function createAgentAuthority(options: {
  registrations: readonly AgentRegistration[];
  getSelection: () => AgentSelection | null;
  getAcceptance: (selection: AgentSelection) => AgentApproval | null;
}): { getBinding(): AgentBinding | null };
