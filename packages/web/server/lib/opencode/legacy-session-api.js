import { z } from 'zod';
import { OPENCODE_PROFILE } from './compatibility.js';
import { supportsLegacyStream } from './legacy-contract.js';

const METHOD = Object.freeze({ CREATE: 'POST', UPDATE: 'PATCH', REMOVE: 'DELETE' });
const ERROR = Object.freeze({ INVALID: 'invalid-request', CHANGED: 'runtime-changed', FAILED: 'legacy-session-failed' });
const metadataSchema = z.record(z.string(), z.unknown());
const createSchema = z.object({
  parentID: z.string().optional(), title: z.string().optional(), metadata: metadataSchema.optional(),
  permission: z.array(z.object({ permission: z.string(), pattern: z.string(), action: z.enum(['allow', 'deny', 'ask']) }).strict()).optional(),
  workspaceID: z.string().optional(),
}).strict();
const updateSchema = z.object({ title: z.string().optional(), metadata: metadataSchema.optional(),
  time: z.object({ archived: z.number().optional() }).strict().optional(),
}).strict();
const querySchema = z.object({ directory: z.string().min(1).optional() }).strict();
const sessionSchema = z.object({ id: z.string().min(1) }).passthrough();

// Own the SDK wire-to-kernel conversion and isolated metadata projection together.
export const createLegacySessionApi = ({ getRuntime, operations, metadataStore, getStorageScope }) => {
  const current = (identity) => {
    const runtime = getRuntime();
    return supportsLegacyStream(runtime) && runtime.generation === identity.generation
      && runtime.profile === identity.profile && runtime.endpoint === identity.endpoint
      && runtime.version === identity.version && runtime.epoch === identity.epoch;
  };
  const check = (identity, scope) => {
    if (!current(identity) || getStorageScope() !== scope) {
      throw Object.assign(new Error(ERROR.CHANGED), { code: ERROR.CHANGED, status: 409 });
    }
  };
  const accepts = (method, route) => supportsLegacyStream(getRuntime())
    && ((method === METHOD.CREATE && route === '/session')
      || ([METHOD.UPDATE, METHOD.REMOVE].includes(method) && /^\/session\/[^/]+$/.test(route)));
  const overlay = async (payload, identity) => {
    if (identity.profile !== OPENCODE_PROFILE.LEGACY) return payload;
    const scope = getStorageScope();
    check(identity, scope);
    const project = async (raw) => {
      const parsed = sessionSchema.safeParse(raw);
      if (!parsed.success) return raw;
      const metadata = await metadataStore.read(scope, parsed.data.id);
      check(identity, scope);
      return { ...parsed.data, metadata };
    };
    return Array.isArray(payload) ? Promise.all(payload.map(project)) : project(payload);
  };
  const request = async ({ method, route, body: rawBody, query: rawQuery, directory: headerDirectory, signal }) => {
    const identity = { ...getRuntime() };
    if (!accepts(method, route)) return { status: 501, body: { error: 'unaccepted', profile: identity.profile } };
    const create = method === METHOD.CREATE;
    const remove = method === METHOD.REMOVE;
    const body = (create ? createSchema : remove ? z.object({}).strict() : updateSchema).safeParse(rawBody === undefined ? {} : rawBody);
    const query = querySchema.safeParse(rawQuery === undefined ? {} : rawQuery);
    if (!body.success || !query.success) return { status: 400, body: { error: ERROR.INVALID } };
    const directory = query.data.directory ?? headerDirectory;
    if (!directory) return { status: 400, body: { error: ERROR.INVALID } };
    const scope = getStorageScope();
    try {
      check(identity, scope);
      const input = { ...body.data, directory, signal, expectedIdentity: identity };
      const result = create ? await operations.createSession(input)
        : remove ? await operations.removeSession({ directory, signal, expectedIdentity: identity, sessionID: route.split('/')[2] })
        : await operations.updateSession({ ...input, sessionID: route.split('/')[2] });
      try { check(identity, scope); } catch (error) {
        error.partial = true;
        if (create) {
          error.createdSessionID = result.data.id;
          error.rolledBack = false;
          error.cleanupFailed = true;
        } else if (remove) error.upstreamDeleted = true;
        else if (body.data.title !== undefined || body.data.time !== undefined) error.upstreamUpdated = true;
        throw error;
      }
      return { status: 200, body: create ? { ...result.data.raw, metadata: result.data.metadata } : result.data };
    } catch (error) {
      const status = error?.code === ERROR.CHANGED ? 409 : error?.status === 501 ? 501 : 503;
      const failure = { error: error?.code === ERROR.CHANGED ? ERROR.CHANGED : ERROR.FAILED };
      if (error?.partial === true) failure.partial = true;
      if (error?.createdSessionID) {
        failure.createdSessionID = error.createdSessionID;
        failure.rolledBack = error.rolledBack === true;
        failure.cleanupFailed = error.cleanupFailed === true;
      }
      if (error?.upstreamUpdated === true) failure.upstreamUpdated = true;
      if (error?.upstreamDeleted === true) failure.upstreamDeleted = true;
      return { status, body: failure };
    }
  };
  return { accepts, overlay, request };
};
