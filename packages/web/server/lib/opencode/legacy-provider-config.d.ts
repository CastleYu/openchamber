import type { OpenCodeGenerationDescriptor } from './compatibility.js';
import type { AgentBackendSelection } from '../agent/host.js';
import type { KernelIdentity, createKernelOperations } from './kernel-operations.js';
import type { createLegacyCredentials } from './legacy-credentials.js';

export interface LegacyProviderSource {
  path: string | null;
  scope: 'user' | 'project' | 'inline' | 'managed';
  origin: 'global' | 'explicit-config' | 'project-root' | 'dot-directory' | 'explicit-config-dir' | 'inline' | 'managed';
  order: number;
  writable: boolean;
}

export function createLegacyProviderConfig(input: {
  getNativeConfigContext(): { id: symbol; env: NodeJS.ProcessEnv; cwd: string } | null;
  getRuntime(): OpenCodeGenerationDescriptor;
  getBackendSelection(): AgentBackendSelection;
  credentials: Pick<ReturnType<typeof createLegacyCredentials>, 'read'>;
  operations: Pick<ReturnType<typeof createKernelOperations>, 'getLegacyConfiguration' | 'compareLegacyProvider'> & {
    removeLegacyCredential(input: { providerID: string; directory?: string; signal?: AbortSignal; expectedIdentity: KernelIdentity & { version: string } }): Promise<boolean>;
  };
}): {
  sources(name: string, directory?: string): Promise<{ providerId: string; layers: LegacyProviderSource[]; auth: { exists: boolean }; complete: boolean; residuals: Array<'environment' | 'remote-config' | 'plugins' | 'effective-config'>; application: { configuration: 'matches-persisted' | 'pending-restart' | 'unknown' } }>;
  disconnect(name: string, directory?: string, signal?: AbortSignal): Promise<{
    persisted: true;
    requiresRestart: true;
    removed: string[];
    credential: 'removed' | 'absent';
    application: { configuration: 'matches-persisted' | 'pending-restart' };
  }>;
  clear(freshOwner?: boolean): void;
};
