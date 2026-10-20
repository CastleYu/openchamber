import type { OpenCodeGenerationDescriptor } from './compatibility.js';
import type { AgentBackendSelection } from '../agent/host.js';

export type LegacyCredential =
  | { type: 'api'; key: string }
  | { type: 'oauth'; refresh: string; access: string; expires: number; accountId?: string; enterpriseUrl?: string }
  | { type: 'wellknown'; key: string; token: string };
export type LegacyCredentials = { read(): Promise<Record<string, LegacyCredential>> };

export declare function createLegacyCredentials(input: {
  getRuntime: () => OpenCodeGenerationDescriptor;
  getNativeConfigContext: () => { id: symbol; env: NodeJS.ProcessEnv; cwd: string } | null;
  getBackendSelection?: () => AgentBackendSelection;
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
}): LegacyCredentials;
