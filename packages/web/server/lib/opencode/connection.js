import { z } from 'zod';
import path from 'node:path';
import { OPENCODE_SETTING } from './compatibility.js';

export const OPENCODE_CONNECTION = Object.freeze({ SETTING: OPENCODE_SETTING.CONNECTION, BACKUP: 'settings.opencode-previous.json', ERROR: 'opencodeConnectionError', ROUTE: '/api/config/opencode-connection', ACTIVITY_ROUTE: '/api/config/opencode-connection/activity', BINARY_ENV_KEYS: Object.freeze(['OPENCODE_BINARY', 'OPENCODE_PATH', 'OPENCHAMBER_OPENCODE_PATH', 'OPENCHAMBER_OPENCODE_BIN']) });
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

const SOURCE = Object.freeze({ ENV: 'environment', SETTINGS: 'settings', BUNDLE: 'bundled' });
const ISSUE = Object.freeze({ INVALID: 'invalid', UNAVAILABLE: 'unavailable', CONFLICT: 'conflict' });
const INPUT = Object.freeze({ HOST: 'OPENCODE_HOST', BINARY: 'opencodeBinary', SKIP: Object.freeze(['OPENCODE_SKIP_START', 'OPENCHAMBER_SKIP_OPENCODE_START']) });
const valueSchema = z.string().trim().min(1);
const candidateValue = value => valueSchema.safeParse(value);

/** Filesystem discovery only: no probe, launch, write or legacy resolver mutation. */
export const describeOpenCodeConnections = ({ settings, env, resolveBinary }) => {
  const candidates = [];
  const modes = Object.values(CONNECTION_MODE).map(mode => {
    if (mode !== CONNECTION_MODE.PATH && mode !== CONNECTION_MODE.BUNDLED) return { mode, available: true };
    try { return { mode, available: true, resolved: resolveBinary({ mode }) }; }
    catch { return { mode, available: false, error: ISSUE.UNAVAILABLE }; }
  });
  let saved = null;
  let error = null;
  try { saved = parseOpenCodeConnection(settings[OPENCODE_CONNECTION.SETTING] ?? null); }
  catch { error = ISSUE.INVALID; }
  if (saved) return { saved, error, candidates, modes, recommendation: null };
  const add = (source, key, raw, mode) => {
    if (raw === undefined || raw === null || raw === '') return;
    const value = candidateValue(raw);
    if (!value.success) { candidates.push({ source, key, record: null, error: ISSUE.INVALID }); return; }
    let record;
    try {
      record = parseOpenCodeConnection({ version: VERSION, confirmed: true, mode,
        ...(mode === CONNECTION_MODE.EXTERNAL ? { endpoint: value.data } : { exe: value.data.replace(/^"([^"\n]+)"$/, '$1') }) });
    } catch { candidates.push({ source, key, record: null, error: ISSUE.INVALID }); return; }
    try {
      const resolved = mode === CONNECTION_MODE.EXTERNAL ? record.endpoint : resolveBinary(record);
      candidates.push({ source, key, record: { ...record, confirmed: false }, resolved, error: null });
    } catch { candidates.push({ source, key, record: { ...record, confirmed: false }, error: ISSUE.UNAVAILABLE }); }
  };
  add(SOURCE.ENV, INPUT.HOST, env[INPUT.HOST], CONNECTION_MODE.EXTERNAL);
  for (const key of INPUT.SKIP) if (env[key] === 'true' && !candidateValue(env[INPUT.HOST]).success) candidates.push({ source: SOURCE.ENV, key, record: null, error: ISSUE.INVALID });
  for (const key of OPENCODE_CONNECTION.BINARY_ENV_KEYS) add(SOURCE.ENV, key, env[key], CONNECTION_MODE.CONFIGURED);
  add(SOURCE.SETTINGS, INPUT.BINARY, settings[INPUT.BINARY], CONNECTION_MODE.CONFIGURED);
  if (!error && candidates.some(candidate => candidate.error)) error = candidates.find(candidate => candidate.error).error;
  if (!error && new Set(candidates.map(candidate => JSON.stringify(candidate.record))).size > 1) error = ISSUE.CONFLICT;
  const bundle = modes.find(mode => mode.mode === CONNECTION_MODE.BUNDLED && mode.available);
  const recommendation = !error && !candidates.length && bundle ? { source: SOURCE.BUNDLE, mode: CONNECTION_MODE.BUNDLED, resolved: bundle.resolved } : null;
  return { saved, error, candidates, modes, recommendation };
};
