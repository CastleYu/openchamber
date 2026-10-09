import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';

export const CONNECTION = { SETTING: 'opencodeConnection', ROUTE: '/api/config/opencode-connection', RELOAD: '/api/config/reload', ITEM: 'general.opencode-connection' } as const;
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
