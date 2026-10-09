import type { JsonValue } from './openchamberSessionState';
import type { OpenCodeGenerationDescriptor } from '../../web/server/lib/opencode/compatibility.js';
import type { ConnectionRecord, PreparedConnection } from '../../web/server/lib/opencode/connection.js';
export const CONNECTION_BRIDGE: 'api:opencode/connection';
type Selection = { family: 'opencode' };
export type ConnectionTransaction = { resolve(): Promise<PreparedConnection>; beforeRetire(): Promise<void>; commit(): Promise<Selection> };
export function createVSCodeConnectionRuntime(deps: {
  resolveBinary(record: Exclude<ConnectionRecord, { mode: 'external' }>): string;
  resolveLaunchSpec(binary: string): { binary: string; args: string[] };
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  getEnv(): NodeJS.ProcessEnv;
  getRuntime(): OpenCodeGenerationDescriptor;
  getHeaders(): HeadersInit;
  getDirectories(): string[];
  getState(): { ready: boolean; transitioning: boolean; external: boolean };
  getOwner(): OpenCodeGenerationDescriptor & { revision: number };
  readSettings(): { [key: string]: import('./openchamberSessionState').JsonValue };
  readPrevious(): Promise<ConnectionRecord | null>;
  saveConnection(record: ConnectionRecord): Promise<void>;
  getConfigured(): Array<{ source: 'settings'; key: string; value: string; mode: 'external' | 'configured' }>;
  replace(transaction: ConnectionTransaction): Promise<void>;
}): {
  prepareConnection(value: JsonValue): Promise<PreparedConnection>;
  request(raw: JsonValue): Promise<{ status: number; body: unknown }>;
};
