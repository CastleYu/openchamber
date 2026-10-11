import type { JsonValue } from '@opencode/client';
import type { Config as LegacyConfig } from '@opencode-ai/sdk/v2';
import type { OpenCodeGenerationDescriptor } from './compatibility.js';
import type { KernelIdentity } from './kernel-operations.js';
import type { AgentBackendSelection } from '../agent/host.js';

export type LegacyMcpDefinition = NonNullable<LegacyConfig['mcp']>[string] & {
  name: string;
  scope: 'user' | 'project' | null;
  readOnly: boolean;
};

export type LegacyMcpInput = JsonValue;

export function createLegacyMcpConfig(input: {
  getNativeConfigContext: () => { id: symbol; env: NodeJS.ProcessEnv; cwd: string } | null;
  getRuntime: () => OpenCodeGenerationDescriptor;
  getBackendSelection?: () => AgentBackendSelection;
  operations: {
    getLegacyConfiguration(input?: { directory?: string }): Promise<KernelIdentity & {
      data: {
        paths: Pick<import('@opencode-ai/sdk/v2').Path, 'home' | 'config' | 'directory' | 'worktree'>;
        mcp: NonNullable<LegacyConfig['mcp']>;
      };
    } & { version: string }>;
  };
}): {
  list(directory?: string): Promise<LegacyMcpDefinition[]>;
  get(name: string, directory?: string): Promise<LegacyMcpDefinition | null>;
  create(name: string, body: LegacyMcpInput, directory?: string, scope?: 'user' | 'project'): Promise<{ saved: true }>;
  update(name: string, body: LegacyMcpInput, directory?: string): Promise<{ saved: true }>;
  remove(name: string, directory?: string): Promise<{ revealed: boolean }>;
};
