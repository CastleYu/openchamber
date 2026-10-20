import type { OpenCodeGenerationDescriptor } from './compatibility.js';
import type { AgentBackendSelection } from '../agent/host.js';
import type { KernelIdentity } from './kernel-operations.js';

export type LegacyCredentialIdentity = KernelIdentity & { version: string };
export interface LegacyOAuthFlow {
  authorize(): Promise<{ url: string; method: 'auto' | 'code'; instructions: string }>;
  callback(input?: { code?: string }): Promise<true>;
  cancel(): void;
}
export interface LegacyCredentialOperations {
  methods(input?: { directory?: string; signal?: AbortSignal }): Promise<Record<string, Array<{ type: 'api' | 'oauth'; label: string; prompts?: Array<{ type: string; key: string; message: string }> }>>>;
  save(input: { providerID: string; key: string; directory?: string; signal?: AbortSignal; expectedIdentity?: LegacyCredentialIdentity }): Promise<true>;
  remove(input: { providerID: string; directory?: string; signal?: AbortSignal; expectedIdentity: LegacyCredentialIdentity }): Promise<true>;
  beginOAuth(input: { providerID: string; method: number; directory?: string; signal?: AbortSignal }): Promise<LegacyOAuthFlow>;
}
export declare function createLegacyCredentialOperations(input: {
  getRuntime: () => OpenCodeGenerationDescriptor;
  getNativeConfigContext: () => { id: symbol; env: NodeJS.ProcessEnv; cwd: string } | null;
  getBackendSelection: () => AgentBackendSelection;
  getHeaders: () => HeadersInit;
  subscribe: (listener: () => void) => () => void;
  fetchImpl?: typeof fetch;
}): LegacyCredentialOperations;

