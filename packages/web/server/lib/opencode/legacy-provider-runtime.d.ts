import type { AgentBackendSelection } from '../agent/host.js';
import type { OpenCodeGenerationDescriptor } from './compatibility.js';
import type { createKernelOperations } from './kernel-operations.js';
import type { LegacyCredentialOperations } from './legacy-credential-operations.js';
import type { LegacyProviderSource } from './legacy-provider-config.js';

type NativeContext = { id: symbol; env: NodeJS.ProcessEnv; cwd: string } | null;
type ProviderOperations = Pick<ReturnType<typeof createKernelOperations>, 'getLegacyConfiguration' | 'compareLegacyProvider'>;
type OAuthRequest = Parameters<LegacyCredentialOperations['beginOAuth']>[0];
type OAuthCallback = Parameters<Awaited<ReturnType<LegacyCredentialOperations['beginOAuth']>>['callback']>[0];
export interface LegacyProviderRuntime {
  sources(name: string, directory?: string): Promise<{ providerId: string; layers: LegacyProviderSource[]; auth: { exists: boolean }; complete: boolean; residuals: Array<'environment' | 'remote-config' | 'plugins' | 'effective-config'>; application: { configuration: 'matches-persisted' | 'pending-restart' | 'unknown' } }>;
  disconnect(name: string, directory?: string, signal?: AbortSignal): Promise<{ persisted: true; requiresRestart: true; removed: string[]; credential: 'removed' | 'absent'; application: { configuration: 'matches-persisted' | 'pending-restart' } }>;
  methods: LegacyCredentialOperations['methods'];
  save: LegacyCredentialOperations['save'];
  beginOAuth(caller: string, request: OAuthRequest): Promise<{ attemptId: string }>;
  authorizeOAuth(caller: string, attemptId: string): Promise<{ url: string; method: 'auto' | 'code'; instructions: string }>;
  callbackOAuth(caller: string, attemptId: string, request?: OAuthCallback): Promise<true>;
  cancelOAuth(caller: string, attemptId: string): void;
  dispose(): void;
}
export declare function createLegacyProviderRuntime(input: {
  getRuntime: () => OpenCodeGenerationDescriptor;
  getNativeConfigContext: () => NativeContext;
  getBackendSelection: () => AgentBackendSelection;
  getHeaders: () => HeadersInit;
  subscribeCredentialOwner: (listener: () => void) => () => void;
  kernelOperations: ProviderOperations;
  fetchImpl?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
}): LegacyProviderRuntime;
