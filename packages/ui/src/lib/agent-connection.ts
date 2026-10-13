import { z } from 'zod';
import { runtimeFetch } from './runtime-fetch';

export const CONNECTION_MODE = { EXTERNAL: 'external', COMMAND: 'command', PATH: 'path', BUNDLED: 'bundled', ACP: 'acp' } as const;
const connectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal(CONNECTION_MODE.EXTERNAL), url: z.string() }),
  z.object({ mode: z.literal(CONNECTION_MODE.COMMAND), command: z.string(), args: z.array(z.string()) }),
  z.object({ mode: z.literal(CONNECTION_MODE.PATH) }),
  z.object({ mode: z.literal(CONNECTION_MODE.BUNDLED) }),
  z.object({ mode: z.literal(CONNECTION_MODE.ACP), command: z.string(), args: z.array(z.string()), cwd: z.string().optional() }),
]);
const snapshotSchema = z.object({
  config: connectionSchema.nullable(),
  status: z.enum(['unconfigured', 'starting', 'ready', 'failed']),
  error: z.string().nullable(),
  prefill: z.object({ url: z.string().optional(), command: z.string().optional(), cwd: z.string().optional() }),
});
export type AgentConnection = z.infer<typeof connectionSchema>;
export type ConnectionSnapshot = z.infer<typeof snapshotSchema>;
export const loadAgentConnection = async (): Promise<ConnectionSnapshot> => {
  const response = await runtimeFetch('/api/agent/connection');
  if (!response.ok) throw new Error(`Agent connection settings: HTTP ${response.status}`);
  return snapshotSchema.parse(await response.json());
};
export const applyAgentConnection = async (config: AgentConnection): Promise<ConnectionSnapshot> => {
  const response = await runtimeFetch('/api/agent/connection', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
  });
  const snapshot = snapshotSchema.parse(await response.json());
  if (!response.ok) throw new Error(snapshot.error || `Agent connection: HTTP ${response.status}`);
  return snapshot;
};
