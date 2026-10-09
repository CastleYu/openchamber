import type { createAgentHost } from './host.js';
import type { AgentIdentity } from './dispatcher.js';

type AgentHost = ReturnType<typeof createAgentHost>;
export type AgentStartupSelection = Readonly<{ family: 'opencode' }> | Readonly<{
  family: 'cagent'; candidate: Parameters<AgentHost['select']>[0];
}>;
/** Maintainer-owned selection; candidate code and public requests cannot supply it. */
export function selectAgentStartup(host: AgentHost, input?: AgentStartupSelection, file?: string): Promise<AgentIdentity | null>;
export function startOpenCodeConsumers(options: {
  host: Pick<AgentHost, 'getSelection' | 'getSelectionSignal'>;
  startPermissions(): () => void;
  startQueue(): () => void;
}): () => void;
