import { z } from 'zod';
import { runtimeFetch } from './runtime-fetch';

export const CONNECTION_MODE = { EXTERNAL: 'external', COMMAND: 'command', PATH: 'path', BUNDLED: 'bundled', ACP: 'acp', ACP_SERVER: 'acp-server' } as const;
export const ACP_TRANSPORT = { WEBSOCKET: 'websocket', HTTP: 'http' } as const;
const absoluteDirectorySchema = z.string().trim().min(1).refine((value) =>
  [...value].every((char) => char.charCodeAt(0) >= 32) && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(value)));
const projectMappingsSchema = z.array(z.object({
  directory: absoluteDirectorySchema,
  cwd: absoluteDirectorySchema,
})).superRefine((values, ctx) => {
  const directories = new Set<string>();
  values.forEach((value, index) => {
    if (directories.has(value.directory)) ctx.addIssue({ code: 'custom', message: 'Each ACP project directory needs one mapping', path: [index, 'directory'] });
    directories.add(value.directory);
  });
});
const serverSchema = z.object({
  mode: z.literal(CONNECTION_MODE.ACP_SERVER),
  transport: z.enum([ACP_TRANSPORT.WEBSOCKET, ACP_TRANSPORT.HTTP]),
  url: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return !url.username && !url.password && !url.hash;
  }),
  cwd: absoluteDirectorySchema,
  projectMappings: projectMappingsSchema.optional(),
}).refine(({ transport, url }) => URL.canParse(url) && (transport === ACP_TRANSPORT.WEBSOCKET ? ['ws:', 'wss:'] : ['http:', 'https:']).includes(new URL(url).protocol));
export const agentConnectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal(CONNECTION_MODE.EXTERNAL), url: z.string() }),
  z.object({ mode: z.literal(CONNECTION_MODE.COMMAND), command: z.string(), args: z.array(z.string()) }),
  z.object({ mode: z.literal(CONNECTION_MODE.PATH) }),
  z.object({ mode: z.literal(CONNECTION_MODE.BUNDLED) }),
  z.object({ mode: z.literal(CONNECTION_MODE.ACP), command: z.string(), args: z.array(z.string()), cwd: z.string().optional() }),
  serverSchema,
]);
const snapshotSchema = z.object({
  config: agentConnectionSchema.nullable(),
  status: z.enum(['unconfigured', 'starting', 'ready', 'failed']),
  error: z.string().nullable(),
  prefill: z.object({ url: z.string().optional(), command: z.string().optional(), cwd: z.string().optional() }),
});
export type AgentConnection = z.infer<typeof agentConnectionSchema>;
export type AcpProjectMapping = NonNullable<Extract<AgentConnection, { mode: typeof CONNECTION_MODE.ACP_SERVER }>['projectMappings']>[number];
export type ConnectionSnapshot = z.infer<typeof snapshotSchema>;
export const loadAgentConnection = async (): Promise<ConnectionSnapshot> => {
  const response = await runtimeFetch('/api/agent/connection');
  if (!response.ok) throw new Error(`Agent connection settings: HTTP ${response.status}`);
  return snapshotSchema.parse(await response.json());
};
export const applyAgentConnection = async (config: AgentConnection): Promise<ConnectionSnapshot> => {
  const parsed = agentConnectionSchema.parse(config);
  const response = await runtimeFetch('/api/agent/connection', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed),
  });
  const snapshot = snapshotSchema.parse(await response.json());
  if (!response.ok) throw new Error(snapshot.error || `Agent connection: HTTP ${response.status}`);
  return snapshot;
};
