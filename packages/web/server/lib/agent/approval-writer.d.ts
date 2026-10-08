import type { AgentApproval } from './authority.js';
import type { AgentFamily } from './dispatcher.js';

/** The maintainer creates/protects the directory and independently reviews every approval. */
export function createAgentApprovalWriter(options: { directory: string }): Readonly<{
  write(approval: AgentApproval): void;
  revoke(identity: { family: AgentFamily; connectionID: string }): boolean;
}>;
