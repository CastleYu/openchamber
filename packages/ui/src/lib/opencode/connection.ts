import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { OPEN_CODE_PROFILE, OPEN_CODE_SELECTION, OPEN_CODE_STATUS } from './runtime';

export const QUEUE_TARGET = { ROUTE: '/api/config/opencode-connection/queue-target', HEADER: 'x-openchamber-queue-target' } as const;

export const CONNECTION = { SETTING: 'opencodeConnection', ROUTE: '/api/config/opencode-connection', PREPARE: '/api/config/opencode-connection/prepare', APPLY: '/api/config/opencode-connection/apply', RELOAD: '/api/config/reload', ITEM: 'general.opencode-connection' } as const;
export const CONNECTION_TEST = { ROUTE: '/api/config/opencode-connection/test', CANCEL_ROUTE: '/api/config/opencode-connection/test/cancel', ITEM: 'general.opencode-connection-test' } as const;
const testResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('launch'), status: z.literal('validated'), binary: z.string().min(1) }),
  z.strictObject({ kind: z.literal('endpoint'), status: z.enum(Object.values(OPEN_CODE_STATUS)), selection: z.enum(Object.values(OPEN_CODE_SELECTION)),
    version: z.string().nullable(), profile: z.enum(Object.values(OPEN_CODE_PROFILE)).nullable() }),
]);
export type ConnectionTestResult = z.infer<typeof testResultSchema>;
export const testConnection = async (connection: ConnectionRecord, signal: AbortSignal): Promise<ConnectionTestResult> => {
  const response = await runtimeFetch(CONNECTION_TEST.ROUTE, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: crypto.randomUUID(), connection }) });
  if (!response.ok) throw new Error('Connection test failed');
  return testResultSchema.parse(await response.json());
};

export const CONNECTION_MODE = { EXTERNAL: 'external', COMMAND: 'command', PATH: 'path', CONFIGURED: 'configured', BUNDLED: 'bundled' } as const;
export const CONNECTION_ISSUE = { INVALID: 'invalid', UNAVAILABLE: 'unavailable', CONFLICT: 'conflict' } as const;
const modeSchema = z.enum(Object.values(CONNECTION_MODE));
const issueSchema = z.enum(Object.values(CONNECTION_ISSUE));
const absolute = z.string().trim().min(1).refine(value => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value));
const variable = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const endpoint = z.string().trim().transform((value, ctx) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/$/, '');
  } catch { ctx.addIssue({ code: 'custom', message: 'Invalid endpoint' }); return z.NEVER; }
});
const recordSchema = <T extends boolean>(confirmed: T) => {
  const common = { version: z.literal(1), confirmed: z.literal(confirmed) };
  return z.discriminatedUnion('mode', [
    z.strictObject({ ...common, mode: z.literal(CONNECTION_MODE.EXTERNAL), endpoint }),
    z.strictObject({ ...common, mode: z.literal(CONNECTION_MODE.COMMAND), exe: absolute,
      args: z.array(z.string().refine(value => !value.includes('\0'))).min(1), cwd: absolute,
      env: z.array(z.strictObject({ name: variable, ref: variable })).default([])
        .refine(refs => new Set(refs.map(item => item.name.toUpperCase())).size === refs.length) }),
    z.strictObject({ ...common, mode: z.literal(CONNECTION_MODE.PATH) }),
    z.strictObject({ ...common, mode: z.literal(CONNECTION_MODE.CONFIGURED), exe: absolute }),
    z.strictObject({ ...common, mode: z.literal(CONNECTION_MODE.BUNDLED) }),
  ]);
};
export const connectionSchema = recordSchema(true);
const candidateSchema = z.object({ source: z.enum(['environment', 'settings']), key: z.string().min(1),
  record: recordSchema(false).nullable(), resolved: z.string().optional(), error: issueSchema.nullable() });
const discoverySchema = z.object({ saved: connectionSchema.nullable(), error: issueSchema.nullable(),
  candidates: z.array(candidateSchema), modes: z.array(z.object({ mode: modeSchema, available: z.boolean(), resolved: z.string().optional(), error: issueSchema.optional() }))
    .refine(modes => modes.length === Object.values(CONNECTION_MODE).length && new Set(modes.map(item => item.mode)).size === modes.length),
  recommendation: z.object({ source: z.literal('bundled'), mode: z.literal(CONNECTION_MODE.BUNDLED), resolved: z.string() }).nullable() });
export type ConnectionRecord = z.infer<typeof connectionSchema>;
type ConnectionDiscovery = z.infer<typeof discoverySchema>;
type ConnectionMode = z.infer<typeof modeSchema>;
export type ConnectionDraft = { mode: ConnectionMode | null; endpoint: string; exe: string; args: string; cwd: string; env: string };

export const connectionDraft = (record: ConnectionDiscovery['candidates'][number]['record'] | ConnectionRecord = null): ConnectionDraft => ({
  mode: record?.mode ?? null, endpoint: record?.mode === CONNECTION_MODE.EXTERNAL ? record.endpoint : '',
  exe: record?.mode === CONNECTION_MODE.CONFIGURED || record?.mode === CONNECTION_MODE.COMMAND ? record.exe : '',
  args: record?.mode === CONNECTION_MODE.COMMAND ? record.args.join('\n') : '',
  cwd: record?.mode === CONNECTION_MODE.COMMAND ? record.cwd : '',
  env: record?.mode === CONNECTION_MODE.COMMAND ? record.env.map(item => item.name + '=' + item.ref).join('\n') : '',
});
export const parseConnectionDraft = (draft: ConnectionDraft) => {
  const common = { version: 1, confirmed: true, mode: draft.mode };
  switch (draft.mode) {
    case CONNECTION_MODE.EXTERNAL: return connectionSchema.safeParse({ ...common, endpoint: draft.endpoint });
    case CONNECTION_MODE.CONFIGURED: return connectionSchema.safeParse({ ...common, exe: draft.exe });
    case CONNECTION_MODE.COMMAND: return connectionSchema.safeParse({ ...common, exe: draft.exe,
      args: draft.args === '' ? [] : draft.args.split(/\r?\n/), cwd: draft.cwd,
      env: draft.env.trim() === '' ? [] : draft.env.split(/\r?\n/).map(line => {
        const [name, ref, extra] = line.trim().split('=');
        return { name: extra === undefined ? name : '', ref };
      }) });
    default: return connectionSchema.safeParse(common);
  }
};
export const readConnections = async (signal: AbortSignal): Promise<{ status: 'ready'; data: ConnectionDiscovery } | { status: 'unsupported' }> => {
  const response = await runtimeFetch(CONNECTION.ROUTE, { signal, cache: 'no-store' });
  if (response.status === 501) return { status: 'unsupported' };
  if (!response.ok) throw new Error('Connection discovery failed');
  return { status: 'ready', data: discoverySchema.parse(await response.json()) };
};

export const CONNECTION_SOURCE = { CANDIDATE: 'candidate', PREVIOUS: 'previous' } as const;
export const CONNECTION_DECISION = { WAIT: 'wait', STOP: 'stop' } as const;
export const ACTIVITY_SCOPE = { GLOBAL: 'global', DIRECTORIES: 'configured-directories' } as const;
export const ACTIVITY_STATE = { KNOWN: 'known', UNKNOWN: 'unknown' } as const;
const countSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal(ACTIVITY_STATE.KNOWN), count: z.number().int().nonnegative() }),
  z.strictObject({ state: z.literal(ACTIVITY_STATE.UNKNOWN), observedCount: z.number().int().nonnegative() }),
]);
const reviewSchema = z.strictObject({ token: z.uuid(), connection: connectionSchema,
  activity: z.strictObject({ state: z.enum(['active', 'inactive', 'transitioning']),
    scope: z.strictObject({ coverage: z.literal(ACTIVITY_SCOPE.DIRECTORIES), busy: z.enum(Object.values(ACTIVITY_SCOPE)), directories: z.array(z.string()) }),
    busy: countSchema, permissions: countSchema, questions: countSchema,
    queue: z.discriminatedUnion('state', [
      z.strictObject({ state: z.literal(ACTIVITY_STATE.KNOWN), count: z.number().int().nonnegative(), sending: z.number().int().nonnegative(), revision: z.number().int().nonnegative() }),
      z.strictObject({ state: z.literal(ACTIVITY_STATE.UNKNOWN), observedCount: z.number().int().nonnegative() }),
    ]),
    clients: z.strictObject({ state: z.literal(ACTIVITY_STATE.UNKNOWN), observedCount: z.number().int().nonnegative() }),
  }),
});
export type ConnectionReview = z.infer<typeof reviewSchema>;
export type ConnectionRequest = { source: typeof CONNECTION_SOURCE.CANDIDATE; connection: ConnectionRecord } | { source: typeof CONNECTION_SOURCE.PREVIOUS };
type ConnectionFailure = { status: 'changed' | 'unsupported' | 'failed' };
const failure = (response: Response): ConnectionFailure => ({ status: response.status === 409 ? 'changed' : response.status === 501 ? 'unsupported' : 'failed' });
export const prepareConnection = async (request: ConnectionRequest, signal: AbortSignal): Promise<{ status: 'ready'; review: ConnectionReview } | ConnectionFailure> => {
  const response = await runtimeFetch(CONNECTION.PREPARE, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!response.ok) return failure(response);
  return { status: 'ready', review: reviewSchema.parse(await response.json()) };
};
export const applyConnection = async (review: ConnectionReview, decision: typeof CONNECTION_DECISION[keyof typeof CONNECTION_DECISION], signal: AbortSignal): Promise<{ status: 'ready'; connection: ConnectionRecord } | ConnectionFailure> => {
  const response = await runtimeFetch(CONNECTION.APPLY, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: review.token, decision, acknowledgeClients: true }) });
  if (!response.ok) return failure(response);
  const result = z.strictObject({ state: z.literal('ready'), connection: connectionSchema }).parse(await response.json());
  return { status: 'ready', connection: result.connection };
};
