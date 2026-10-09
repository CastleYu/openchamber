import type { AgentIdentity, AgentOperation } from './dispatcher.js';
export type AgentAttemptState = 'unknown' | 'accepted' | 'complete' | 'not-sent';
export type AgentAttemptOperation = AgentOperation | `cagent.${string}`;
export type AgentAttempt = Readonly<{
  version: 1; identity: AgentIdentity; operation: AgentAttemptOperation; requestID: string; state: AgentAttemptState;
}>;
export interface AgentAttempts {
  begin(identity: AgentIdentity, operation: AgentAttemptOperation, requestID: string): Promise<{
    finish(state: AgentAttemptState): Promise<AgentAttempt>;
  }>;
  read(identity: AgentIdentity, requestID: string): Promise<AgentAttempt | null>;
}
export class AgentAttemptError extends Error {
  readonly code: string;
  constructor(code: string);
}
export function createAgentAttempts(options: {
  directory: string;
  fsPromises?: Pick<typeof import('node:fs/promises'), 'mkdir' | 'open'>;
}): AgentAttempts;
