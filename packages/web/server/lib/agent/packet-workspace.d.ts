import type { AgentArtifactManifest } from './artifacts.js';
import type { AgentOperation } from './dispatcher.js';
import type { AgentPacket, AgentPacketResult } from './packet-runner.js';

/** Maintainer-owned directories and checks. Candidate code cannot supply this composition. */
export function createAgentPacketWorkspace(options: {
  protectedDirectory: string;
  progressDirectory: string;
  manifest: AgentArtifactManifest;
  packets: readonly AgentPacket[];
}): Readonly<{ run(operation: AgentOperation): Promise<AgentPacketResult> }>;
