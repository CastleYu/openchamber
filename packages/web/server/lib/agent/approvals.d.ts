import type { AgentApproval, AgentSelection } from './authority.js';
import type { AgentFamily } from './dispatcher.js';

export class AgentApprovalError extends Error {
  readonly code: string;
  constructor(code: string);
}
export function agentApprovalName(identity: { family: AgentFamily; connectionID: string }): string;
/** Host-owned, read-only store. The runner must protect the directory against adapter writes. */
export function createAgentApprovals(options: { directory: string }): {
  read(selection: AgentSelection): AgentApproval | null;
};
