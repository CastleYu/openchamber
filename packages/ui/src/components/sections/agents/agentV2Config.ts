import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { opencodeClient } from '@/lib/opencode/client';
import { OpenCodeRuntimeChangedError, OpenCodeRuntimeError, type OpenCodeRuntime } from '@/lib/opencode/runtime';
import { invalidateAgentsLoadCache, useAgentsStore } from '@/stores/useAgentsStore';

const ruleSchema = z.object({
  action: z.string(),
  resource: z.string(),
  effect: z.enum(['allow', 'ask', 'deny']),
});
const bodySchema = z.looseObject({ temperature: z.number().optional(), top_p: z.number().optional() });
const requestSchema = z.looseObject({
  headers: z.record(z.string(), z.string()).optional(),
  body: bodySchema.optional(),
});
const entitySchema = z.looseObject({
  description: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  system: z.string().nullable().optional(),
  mode: z.enum(['primary', 'subagent', 'all']).optional(),
  hidden: z.boolean().optional(),
  color: z.string().nullable().optional(),
  steps: z.number().nullable().optional(),
  disabled: z.boolean().optional(),
  request: requestSchema.nullable().optional(),
  permissions: z.array(ruleSchema).nullable().optional(),
});
const envelopeSchema = z.object({
  source: z.enum(['md', 'json', 'none']),
  scope: z.enum(['user', 'project']).nullable(),
  path: z.string().nullable(),
  legacy: z.boolean(),
  config: entitySchema,
});
const permissionsSchema = z.object({
  global: z.array(ruleSchema),
  agent: z.array(ruleSchema),
  effective: z.array(ruleSchema.extend({ source: z.enum(['global', 'agent']) })),
  source: z.enum(['md', 'json', 'none']),
  path: z.string().nullable(),
});
const mutationSchema = z.object({ success: z.literal(true), requiresManualRestart: z.boolean().optional() });

export type AgentV2Entity = z.infer<typeof entitySchema>;
export type AgentV2Config = AgentV2Entity & { name: string; scope?: 'user' | 'project' };
export type AgentV2Envelope = z.infer<typeof envelopeSchema>;
export type AgentV2Permissions = z.infer<typeof permissionsSchema>;
export type AgentV2Rule = z.infer<typeof ruleSchema>;
export type AgentV2Effect = AgentV2Rule['effect'];

const endpoint = (name: string, directory?: string | null, resource?: string): string => {
  const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
  return `/api/config/agents/${encodeURIComponent(name)}${resource ? `/${resource}` : ''}${query}`;
};

const assertV2 = (): OpenCodeRuntime => {
  const runtime = opencodeClient.getBoundRuntime();
  if (runtime?.generation !== 'oc2') throw new OpenCodeRuntimeError(runtime?.generation ?? 'unknown', 'OC2 agent settings');
  return runtime;
};

const assertSameRuntime = (runtime: OpenCodeRuntime): void => {
  const current = opencodeClient.getBoundRuntime();
  if (current?.endpoint !== runtime.endpoint || current.epoch !== runtime.epoch || current.generation !== runtime.generation) {
    throw new OpenCodeRuntimeChangedError();
  }
};

const read = async (name: string, directory: string | null | undefined, resource: 'config' | 'permissions') => {
  const runtime = assertV2();
  const response = await runtimeFetch(endpoint(name, directory, resource), {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) throw new Error(`Agent ${resource} read failed (${response.status})`);
  const payload = await response.json();
  assertSameRuntime(runtime);
  return payload;
};

export const fetchAgentV2Entity = async (name: string, directory?: string | null): Promise<AgentV2Envelope> =>
  envelopeSchema.parse(await read(name, directory, 'config'));

export const fetchAgentV2Permissions = async (name: string, directory?: string | null): Promise<AgentV2Permissions> =>
  permissionsSchema.parse(await read(name, directory, 'permissions'));

export const writeAgentV2 = async (
  method: 'POST' | 'PATCH',
  name: string,
  config: Partial<AgentV2Entity> | AgentV2Config,
  directory?: string | null,
): Promise<void> => {
  const runtime = assertV2();
  const response = await runtimeFetch(endpoint(name, directory), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(await response.json().catch(() => null));
    throw new Error(error.success ? error.data.error : `Agent write failed (${response.status})`);
  }
  mutationSchema.parse(await response.json());
  assertSameRuntime(runtime);
  invalidateAgentsLoadCache(directory ?? null);
  await useAgentsStore.getState().loadAgents(directory);
  assertSameRuntime(runtime);
};
