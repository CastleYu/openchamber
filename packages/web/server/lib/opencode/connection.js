import { z } from 'zod';
import path from 'node:path';

export const OPENCODE_CONNECTION = Object.freeze({ SETTING: 'opencodeConnection', BACKUP: 'settings.opencode-previous.json', ERROR: 'opencodeConnectionError' });
export const CONNECTION_MODE = Object.freeze({ EXTERNAL: 'external', COMMAND: 'command', PATH: 'path', CONFIGURED: 'configured', BUNDLED: 'bundled' });
const VERSION = 1;
const variable = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const absolute = z.string().trim().min(1).refine(value => path.isAbsolute(value));
const text = z.string().refine(value => !value.includes('\0'));
const endpoint = z.string().trim().transform((value, ctx) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/$/, '');
  } catch { ctx.addIssue({ code: 'custom', message: 'Invalid endpoint' }); return z.NEVER; }
});
const common = { version: z.literal(VERSION), confirmed: z.literal(true) };
const schema = z.discriminatedUnion('mode', [
  z.strictObject({ ...common, mode: z.literal(CONNECTION_MODE.EXTERNAL), endpoint }),
  z.strictObject({ ...common, mode: z.literal(CONNECTION_MODE.COMMAND), exe: absolute, args: z.array(text).min(1), cwd: absolute,
    env: z.array(z.strictObject({ name: variable, ref: variable })).default([]).refine(refs => new Set(refs.map(item => item.name.toUpperCase())).size === refs.length) }),
  z.strictObject({ ...common, mode: z.literal(CONNECTION_MODE.PATH) }),
  z.strictObject({ ...common, mode: z.literal(CONNECTION_MODE.CONFIGURED), exe: absolute }),
  z.strictObject({ ...common, mode: z.literal(CONNECTION_MODE.BUNDLED) }),
]).nullable();

export class OpenCodeConnectionError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const parseOpenCodeConnection = value => {
  const result = schema.safeParse(value);
  if (!result.success) throw new OpenCodeConnectionError('Invalid or unconfirmed OpenCode connection');
  return result.data;
};

const protectedEnv = new Set(['PATH', 'OPENCODE_PASSWORD', 'OPENCODE_SERVER_PASSWORD']);
export const resolveConnectionEnv = (refs, env) => Object.fromEntries(refs.map(item => {
  if (protectedEnv.has(item.name.toUpperCase())) throw new OpenCodeConnectionError('Command environment cannot replace host-owned values');
  const value = z.string().safeParse(env[item.ref]);
  if (!value.success) throw new OpenCodeConnectionError('Command environment reference is unavailable');
  return [item.name, value.data];
}));

export const prepareOpenCodeConnection = async (value, { resolveBinary, resolveLaunchSpec, stat, env }) => {
  const record = parseOpenCodeConnection(value);
  if (!record) throw new OpenCodeConnectionError('Confirm an OpenCode connection before starting');
  if (record.mode === CONNECTION_MODE.EXTERNAL) return record;
  const binary = resolveBinary(record);
  const launchSpec = resolveLaunchSpec(binary);
  if (record.mode !== CONNECTION_MODE.COMMAND) return { ...record, binary, launchSpec };
  let directory;
  try { directory = await stat(record.cwd); }
  catch { throw new OpenCodeConnectionError('Command working directory is unavailable'); }
  if (!directory.isDirectory()) throw new OpenCodeConnectionError('Command working directory is unavailable');
  return { ...record, binary, launchSpec, commandEnv: resolveConnectionEnv(record.env, env) };
};
