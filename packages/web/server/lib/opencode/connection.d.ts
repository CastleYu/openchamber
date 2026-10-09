import type { z } from 'zod';
export const OPENCODE_CONNECTION: Readonly<{ SETTING: 'opencodeConnection'; BACKUP: 'settings.opencode-previous.json'; ERROR: 'opencodeConnectionError'; ROUTE: '/api/config/opencode-connection'; ACTIVITY_ROUTE: '/api/config/opencode-connection/activity'; BINARY_ENV_KEYS: readonly string[] }>;
export const CONNECTION_MODE: Readonly<{ EXTERNAL: 'external'; COMMAND: 'command'; PATH: 'path'; CONFIGURED: 'configured'; BUNDLED: 'bundled' }>;
export const CONNECTION_SWITCH: Readonly<{ PREPARE_ROUTE: '/api/config/opencode-connection/prepare'; APPLY_ROUTE: '/api/config/opencode-connection/apply'; PREVIOUS_ROUTE: '/api/config/opencode-connection/previous'; CANDIDATE: 'candidate'; PREVIOUS: 'previous'; WAIT: 'wait'; STOP: 'stop'; READY: 'ready' }>;
type Common = { version: 1; confirmed: true };
export type ConnectionRecord = Common & (
  | { mode: 'external'; endpoint: string }
  | { mode: 'command'; exe: string; args: string[]; cwd: string; env: Array<{ name: string; ref: string }> }
  | { mode: 'path' }
  | { mode: 'configured'; exe: string }
  | { mode: 'bundled' }
);
export type PreparedConnection = Extract<ConnectionRecord, { mode: 'external' }> | (Exclude<ConnectionRecord, { mode: 'external' }> & { binary: string; launchSpec: { binary: string; args: string[] }; commandEnv?: NodeJS.ProcessEnv });
export class OpenCodeConnectionError extends Error { status: number; constructor(message: string, status?: number); }
export function parseOpenCodeConnection(value: z.infer<ReturnType<typeof z.json>>): ConnectionRecord | null;
export function resolveConnectionEnv(refs: Array<{ name: string; ref: string }>, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function prepareOpenCodeConnection(value: z.infer<ReturnType<typeof z.json>>, deps: { resolveBinary(record: Exclude<ConnectionRecord, { mode: 'external' }>): string; resolveLaunchSpec(binary: string): { binary: string; args: string[] }; stat(path: string): Promise<{ isDirectory(): boolean }>; env: NodeJS.ProcessEnv }): Promise<PreparedConnection>;
