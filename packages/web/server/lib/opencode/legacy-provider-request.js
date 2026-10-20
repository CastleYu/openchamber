import { z } from 'zod';
import { ENTERPRISE_MODE_ERROR, isEnterpriseMode } from '../enterprise-mode.js';
import { LEGACY_PROVIDER_ROUTE as ROUTE } from './legacy-provider-routes.js';

const FIELD = Object.freeze({ IDENTITY: 'identity', DIRECTORY: 'directory', PROVIDER: 'providerID', KEY: 'key', METHOD: 'method', ATTEMPT: 'attemptId', CODE: 'code' });
const STATUS = Object.freeze({ BAD: 400, AUTH: 401, STALE: 409, MISSING: 404, METHOD: 405, SERVER: 500 });
const MESSAGE = Object.freeze({ BAD: 'Invalid provider request', AUTH: 'Authentication required', STALE: 'OpenCode runtime identity changed', SERVER: 'Provider request failed' });
const IDENTITY = z.object({ generation: z.literal('oc1'), profile: z.literal('legacy-1.2.27'), version: z.literal('1.2.27'), endpoint: z.string().min(1), epoch: z.union([z.string(), z.number()]) }).strict();
const BASE = { [FIELD.IDENTITY]: IDENTITY, [FIELD.DIRECTORY]: z.string().optional() };
const SCHEMA = Object.freeze({
  METHODS: z.object(BASE).strict(),
  SOURCES: z.object({ ...BASE, [FIELD.PROVIDER]: z.string().min(1) }).strict(),
  SAVE: z.object({ ...BASE, [FIELD.PROVIDER]: z.string().min(1), [FIELD.KEY]: z.string().min(1) }).strict(),
  DISCONNECT: z.object({ ...BASE, [FIELD.PROVIDER]: z.string().min(1) }).strict(),
  BEGIN: z.object({ ...BASE, [FIELD.PROVIDER]: z.string().min(1), [FIELD.METHOD]: z.number().int().nonnegative() }).strict(),
  ATTEMPT: z.object({ [FIELD.ATTEMPT]: z.string().min(1) }).strict(),
  CALLBACK: z.object({ [FIELD.ATTEMPT]: z.string().min(1), [FIELD.CODE]: z.string().optional() }).strict(),
});
const OUTCOME = z.object({
  persisted: z.boolean().optional(), partial: z.boolean().optional(), requiresRestart: z.boolean().optional(), removed: z.array(z.string()).optional(),
  remaining: z.array(z.string()).optional(), credential: z.enum(['retained', 'removed', 'unknown', 'absent']).optional(),
}).strict();
const CONNECT = new Set([ROUTE.SAVE, ROUTE.BEGIN, ROUTE.AUTHORIZE, ROUTE.CALLBACK].map(path => ROUTE.BASE + path));
const CALLER = z.string().min(1);
const STATUS_CODE = z.number().int().min(400).max(599);
const CREDENTIAL = z.enum(['retained', 'removed', 'unknown', 'absent']);

function sameIdentity(left, right) {
  const parsed = IDENTITY.strip().safeParse(right);
  return parsed.success && left.generation === parsed.data.generation && left.profile === parsed.data.profile
    && left.version === parsed.data.version && left.endpoint === parsed.data.endpoint && left.epoch === parsed.data.epoch;
}

function errorResponse(error) {
  const status = STATUS_CODE.safeParse(error?.statusCode);
  const body = { error: MESSAGE.SERVER };
  const partial = OUTCOME.safeParse(error?.outcome);
  const credential = CREDENTIAL.safeParse(error?.credential);
  const restart = z.boolean().safeParse(error?.requiresRestart);
  if (partial.success) body.outcome = partial.data;
  if (credential.success) body.credential = credential.data;
  if (restart.success) body.requiresRestart = restart.data;
  return { status: status.success ? status.data : STATUS.SERVER, body };
}

function createLegacyProviderRequest({ api, getRuntime }) {
  const handlers = new Map();
  const route = (path, schema, run, needsIdentity = false) => handlers.set(ROUTE.BASE + path, { schema, run, needsIdentity });
  route(ROUTE.METHODS, SCHEMA.METHODS, ({ input, signal }) => api.methods({ directory: input.directory, signal }), true);
  route(ROUTE.SOURCES, SCHEMA.SOURCES, ({ input }) => api.sources(input.providerID, input.directory), true);
  route(ROUTE.SAVE, SCHEMA.SAVE, ({ input, signal }) => api.save({ key: input.key, providerID: input.providerID, directory: input.directory, signal, expectedIdentity: input.identity }), true);
  route(ROUTE.DISCONNECT, SCHEMA.DISCONNECT, ({ input, signal }) => api.disconnect(input.providerID, input.directory, signal), true);
  route(ROUTE.BEGIN, SCHEMA.BEGIN, ({ caller, input, signal }) => api.beginOAuth(caller, { providerID: input.providerID, method: input.method, directory: input.directory, signal }), true);
  route(ROUTE.AUTHORIZE, SCHEMA.ATTEMPT, ({ caller, input }) => api.authorizeOAuth(caller, input.attemptId));
  route(ROUTE.CALLBACK, SCHEMA.CALLBACK, ({ caller, input }) => api.callbackOAuth(caller, input.attemptId, input.code === undefined ? {} : { code: input.code }));
  route(ROUTE.CANCEL, SCHEMA.ATTEMPT, ({ caller, input }) => api.cancelOAuth(caller, input.attemptId));

  return async ({ method, path, body, caller, signal }) => {
    const handler = handlers.get(path);
    if (!handler) return { status: STATUS.MISSING, body: { error: MESSAGE.SERVER } };
    if (method !== 'POST') return { status: STATUS.METHOD, body: { error: MESSAGE.SERVER } };
    if (signal?.aborted) return { status: STATUS.STALE, body: { error: MESSAGE.SERVER } };
    if (!CALLER.safeParse(caller).success) return { status: STATUS.AUTH, body: { error: MESSAGE.SERVER } };
    const parsed = handler.schema.safeParse(body);
    if (!parsed.success) return { status: STATUS.BAD, body: { error: MESSAGE.SERVER } };
    const input = parsed.data;
    if (CONNECT.has(path) && isEnterpriseMode()) return { status: 403, body: { error: ENTERPRISE_MODE_ERROR, code: 'enterprise_mode' } };
    if (handler.needsIdentity) {
      let runtime;
      try { runtime = getRuntime(); } catch { return errorResponse(new Error(MESSAGE.SERVER)); }
      if (!sameIdentity(input.identity, runtime)) return { status: STATUS.STALE, body: { error: MESSAGE.SERVER } };
    }
    const followup = path === ROUTE.BASE + ROUTE.AUTHORIZE || path === ROUTE.BASE + ROUTE.CALLBACK;
    const cancel = () => {
      if (followup) Promise.resolve().then(() => api.cancelOAuth(caller, input.attemptId)).catch(() => {});
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const value = await handler.run({ caller, input, signal });
      if (signal?.aborted) return { status: STATUS.STALE, body: { error: MESSAGE.SERVER } };
      if (path === ROUTE.BASE + ROUTE.SAVE || path === ROUTE.BASE + ROUTE.CALLBACK) return { status: 200, body: { persisted: true, requiresRestart: true } };
      if (path === ROUTE.BASE + ROUTE.CANCEL) return { status: 200, body: { canceled: true } };
      return { status: 200, body: value ?? {} };
    } catch (error) { return errorResponse(error); }
    finally { signal?.removeEventListener('abort', cancel); }
  };
}

export { createLegacyProviderRequest };
export { LEGACY_PROVIDER_ROUTE } from './legacy-provider-routes.js';
