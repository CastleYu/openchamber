import type { AgentRegistration } from './authority.js';
import type { AgentArtifactManifest } from './artifacts.js';
import type { AgentIdentity, JsonValue } from './dispatcher.js';
import { AGENT_SERVER_METHOD } from './constants.js';

export type AgentAdapterProfile = Readonly<{
  adapterID: string; family: 'cagent'; adapterRevision: string; capabilityRevision: string;
}>;
export type AgentServerRequest = {
  method: typeof AGENT_SERVER_METHOD[keyof typeof AGENT_SERVER_METHOD];
  path: string; query?: { [key: string]: string }; body?: JsonValue;
};
export type AgentServerResponse = { status: number; body: JsonValue };
export type AgentRequestControl = Readonly<{ signal?: AbortSignal }>;
export type AgentServerTransport = Readonly<{
  request(input: AgentServerRequest, identity: AgentIdentity, control?: AgentRequestControl): Promise<AgentServerResponse>;
}>;
export type AgentAdapter = Pick<AgentRegistration, 'capabilities' | 'handlers'>;
export type AgentAdapterFactory = (context: AgentServerTransport) => AgentAdapter | Promise<AgentAdapter>;
export class AgentAdapterError extends Error {
  readonly code: string;
  constructor(code: string);
}
/** The host supplies a reviewed manifest/profile and owns endpoint, auth and transport. */
export function loadAgentAdapter(options: {
  directory: string; manifest: AgentArtifactManifest; profile: AgentAdapterProfile; transport: AgentServerTransport;
}): Promise<AgentRegistration>;
