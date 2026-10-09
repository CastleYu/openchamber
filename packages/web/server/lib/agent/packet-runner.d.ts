import type { AgentArtifactManifest } from './artifacts.js';
import type { AgentOperation } from './dispatcher.js';
import type { ZodType } from 'zod';

export type AgentPacketID = AgentOperation | `cagent.${string}`;

/** Text is captured before checks. It must never be returned in reports or persisted progress. */
export type AgentPacketSource = Readonly<{ path: string; text: string }>;
export type AgentPacketCheck = Readonly<{
  id: string;
  run(files: readonly AgentPacketSource[]): boolean | Promise<boolean>;
}>;
export type AgentPacket = Readonly<{
  operation: AgentPacketID;
  directory: string;
  files: readonly string[];
  dependsOn: readonly AgentPacketID[];
  checks: readonly AgentPacketCheck[];
}>;
export type AgentPacketProgress = Readonly<{
  version: 1;
  kitDigest: string;
  operation: AgentPacketID;
  state: 'fixtures-passed' | 'fixtures-failed' | 'blocked';
  candidateDigest: string;
  failures: number;
  checks: readonly Readonly<{ id: string; passed: boolean }>[];
}>;
export type AgentPacketResult = Readonly<{
  operation: AgentPacketID;
  state: 'fixtures-passed' | 'fixtures-failed' | 'blocked';
  reason: string | null;
  candidateDigest: string | null;
  failures: number;
  checks: readonly Readonly<{ id: string; passed: boolean }>[];
}>;
export class AgentPacketError extends Error {
  readonly code: string;
  constructor(code: string);
}
export const agentPacketProgressSchema: ZodType<AgentPacketProgress>;
/** Ports and packet definitions are protected host inputs, never candidate workspace files. */
export function createAgentPacketRunner(options: {
  protectedDirectory: string;
  manifest: AgentArtifactManifest;
  packets: readonly AgentPacket[];
  readProgress(operation: AgentPacketID): Promise<AgentPacketProgress | null>;
  writeProgress(progress: AgentPacketProgress): Promise<void>;
}): Readonly<{ run(operation: AgentPacketID): Promise<AgentPacketResult> }>;
