import type { z } from 'zod';
import type { OpenCodeSelection, OpenCodeProfile, OpenCodeProfileAdmission } from './compatibility.js';
import type { PreparedConnection } from './connection.js';
export const CONNECTION_TEST: Readonly<{ ROUTE: '/api/config/opencode-connection/test'; CANCEL_ROUTE: '/api/config/opencode-connection/test/cancel'; TIMEOUT_MS: 15000 }>;
type Json = z.infer<ReturnType<typeof z.json>>;
type Context = { family: string; owner: string; endpoint: string | null; selection: OpenCodeSelection; headersForGeneration(generation: 'oc1' | 'oc2'): HeadersInit };
export type ConnectionTestResult = { kind: 'launch'; status: 'validated'; binary: string }
  | { kind: 'endpoint'; status: OpenCodeProfileAdmission['status']; selection: OpenCodeSelection; version: string | null; profile: OpenCodeProfile | null };
export function createConnectionTest(deps: { prepareConnection(value: Json): Promise<PreparedConnection>; getContext(): Context | Promise<Context> }): {
  test(raw: Json, signal?: AbortSignal): Promise<ConnectionTestResult>;
  cancel(raw: Json): { cancelled: true };
};
