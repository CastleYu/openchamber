import type { AgentIdentity } from './dispatcher.js';
import type { AgentServerTransport } from './loader.js';

export type AgentConnection = Readonly<{
  identity: AgentIdentity & { family: 'cagent' };
  baseURL: string; headers: { [name: string]: string }; ready: boolean; authorized: boolean;
}>;
export class AgentTransportError extends Error {
  readonly code: string;
  constructor(code: string);
}
/** Protected host state owns endpoint/auth and advances epoch whenever either changes. */
export function createAgentTransport(options: {
  getConnection(): AgentConnection | null;
}): AgentServerTransport;
