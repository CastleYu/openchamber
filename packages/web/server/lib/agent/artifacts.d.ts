export type AgentArtifactFile = Readonly<{ path: string; bytes: number; digest: string }>;
export type AgentArtifactManifest = Readonly<{
  version: 1; artifactDigest: string; files: readonly AgentArtifactFile[];
}>;
export class AgentArtifactError extends Error {
  readonly code: string;
  constructor(code: string);
}
export function agentArtifactDigest(files: readonly AgentArtifactFile[]): string;
/** Manifest ownership and filesystem permissions must be enforced by the protected host. */
export function verifyAgentArtifacts(options: {
  directory: string; manifest: AgentArtifactManifest;
}): Promise<Readonly<{ artifactDigest: string; files: number }>>;
/** The module URL contains source bytes. Never expose it through routes or logs. */
export function readAgentAdapterArtifact(options: {
  directory: string; manifest: AgentArtifactManifest;
}): Promise<Readonly<{ artifactDigest: string; moduleURL: string }>>;
