import type { AgentBinding, AgentCapability, AgentFamily, AgentHandlers, AgentIdentity, AgentOperation } from './dispatcher.js';
import type { ExtensionManifest, ExtensionResult, ExtensionValues } from './extensions.js';

export type AgentExtensionHandler = (request: Readonly<{
  workspaceID?: string;
  sessionID?: string;
  requestID?: string;
  values: ExtensionValues;
}>, identity: AgentIdentity) => Promise<Readonly<{
  result: ExtensionResult;
  receipt?: Readonly<{ requestID: string; state: 'accepted' | 'complete' | 'unknown' }>;
}>>;
export type AgentExtensionRegistration = Readonly<{
  manifest: ExtensionManifest;
  capability: AgentCapability;
  handler: AgentExtensionHandler;
}>;
export type AgentExtensionBinding = AgentExtensionRegistration & Readonly<{ accepted: boolean }>;
export type AgentExtensionApproval = Readonly<{
  actionID: string;
  revision: string;
  manifestDigest: string;
  evidence: readonly string[];
}>;

export type AgentRegistration = Readonly<{
  adapterID: string;
  family: AgentFamily;
  adapterRevision: string;
  capabilityRevision: string;
  artifactDigest: string;
  capabilities: Readonly<Partial<{ [K in AgentOperation]: AgentCapability }>>;
  handlers: AgentHandlers;
  extensions?: readonly AgentExtensionRegistration[];
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
  extensions?: readonly AgentExtensionApproval[];
}>;
export function agentExtensionDigest(manifest: ExtensionManifest): string;
/** Both callbacks are trusted host ports. Adapter manifests cannot supply them. */
export function createAgentAuthority(options: {
  registrations: readonly AgentRegistration[];
  getSelection: () => AgentSelection | null;
  getAcceptance: (selection: AgentSelection) => AgentApproval | null;
}): { getBinding(): AgentBinding | null };
