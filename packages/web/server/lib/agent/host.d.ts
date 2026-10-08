import type { AgentApproval, AgentSelection } from './authority.js';
import type { AgentArtifactManifest } from './artifacts.js';
import type { AgentAttempts } from './attempts.js';
import type { AgentIdentity, createAgentDispatcher } from './dispatcher.js';
import type { AgentHostSupport, createAgentFeatures } from './features.js';
import type { AgentAdapterProfile } from './loader.js';

export type AgentHostConnection = Readonly<{
  connectionID: string; serverRevision: string; baseURL: string;
  headers: Readonly<{ [name: string]: string }>; ready: boolean; authorized: boolean;
}>;
export type AgentBackendSelection = Readonly<{ family: 'opencode' | 'cagent'; revision: number }>;
/** Only the maintainer-owned composition may supply selection and acceptance. */
export function createAgentHost(options: {
  getAcceptance(selection: AgentSelection): AgentApproval | null;
  attempts?: AgentAttempts;
  getHostSupport?: () => AgentHostSupport | null;
}): Readonly<{
  select(input: {
    directory: string; manifest: AgentArtifactManifest; profile: AgentAdapterProfile; connection: AgentHostConnection;
  }): Promise<AgentIdentity>;
  clear(): void;
  /** Explicitly retire CAgent selection. OpenCode must resolve its own descriptor again. */
  selectOpenCode(): void;
  getSelection(): AgentBackendSelection;
  dispatcher: ReturnType<typeof createAgentDispatcher>;
  features: ReturnType<typeof createAgentFeatures>;
}>;
