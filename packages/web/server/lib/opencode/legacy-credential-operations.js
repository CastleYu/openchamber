import path from 'node:path';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import { z } from 'zod';
import { AGENT_FAMILY } from '../agent/constants.js';

const VALUE = Object.freeze({ OC1: 'oc1', LEGACY: 'legacy-1.2.27', API: 'api', OAUTH: 'oauth', AUTO: 'auto', CODE: 'code', UNKNOWN: 'unknown' });
const STATUS = Object.freeze({ INVALID: 400, CHANGED: 409, FAILED: 502, UNSUPPORTED: 501 });
const OAUTH_PHASE = Object.freeze({ READY: 'ready', AUTHORIZING: 'authorizing', AUTHORIZED: 'authorized', CALLBACK: 'callback', DONE: 'done' });
const runtimeSchema = z.object({ generation: z.string(), profile: z.string(), version: z.string(), endpoint: z.string().url(), epoch: z.number() });
const nativeSchema = z.object({ id: z.symbol(), cwd: z.string() });
const backendSchema = z.object({ family: z.string(), revision: z.number() });
const identitySchema = z.object({ generation: z.enum([VALUE.OC1, 'oc2']), profile: z.string().optional(), version: z.string(), endpoint: z.string().url(), epoch: z.union([z.string(), z.number()]) }).strict();
const providerSchema = z.string().min(1).max(256);
const directorySchema = z.string().min(1).optional();
const signalSchema = z.instanceof(AbortSignal).optional();
const inputBase = { directory: directorySchema, signal: signalSchema };
const methodsInput = z.object(inputBase).strict();
const saveInput = z.object({ ...inputBase, providerID: providerSchema, key: z.string().min(1), expectedIdentity: identitySchema.optional() }).strict();
const removeInput = z.object({ ...inputBase, providerID: providerSchema, expectedIdentity: identitySchema }).strict();
const oauthInput = z.object({ ...inputBase, providerID: providerSchema, method: z.number().int().nonnegative() }).strict();
const oauthFlowInput = oauthInput;
const oauthCodeInput = z.object({ code: z.string().optional() }).strict();
const authMethodSchema = z.object({ type: z.enum([VALUE.API, VALUE.OAUTH]), label: z.string(), prompts: z.array(z.object({ type: z.string(), key: z.string(), message: z.string() }).passthrough()).optional() }).passthrough();
const authCatalogSchema = z.record(z.string(), z.array(authMethodSchema));
const authResultSchema = z.object({ url: z.string().url(), method: z.enum([VALUE.AUTO, VALUE.CODE]), instructions: z.string() }).strict();
const booleanSchema = z.literal(true);

function failure(statusCode, message, details) { return Object.assign(new Error(message), { statusCode, ...details }); }
function unsupported() { return failure(STATUS.UNSUPPORTED, 'Native Legacy credential operations are unavailable'); }
function changed() { return failure(STATUS.CHANGED, 'OpenCode credential owner changed'); }
function invalid() { return failure(STATUS.INVALID, 'Invalid credential operation input'); }
function failed(details) { return failure(STATUS.FAILED, 'OpenCode credential operation failed', details); }
function same(left, right) {
  return left.generation === right.generation && left.profile === right.profile && left.version === right.version
    && left.endpoint === right.endpoint && left.epoch === right.epoch;
}
function capture(input) {
  const runtime = runtimeSchema.safeParse(input.getRuntime());
  const native = nativeSchema.safeParse(input.getNativeConfigContext());
  const backend = backendSchema.safeParse(input.getBackendSelection());
  if (process.platform !== 'win32' || !runtime.success || !native.success || !backend.success
    || !z.string().min(1).safeParse(native.data.cwd).success || !path.isAbsolute(native.data.cwd)
    || runtime.data.generation !== VALUE.OC1 || runtime.data.profile !== VALUE.LEGACY || runtime.data.version !== '1.2.27'
    || backend.data.family !== AGENT_FAMILY.OPENCODE) throw unsupported();
  return { runtime: { ...runtime.data }, native: { id: native.data.id, cwd: native.data.cwd }, backend: { ...backend.data } };
}
function current(input, snapshot) {
  const runtime = runtimeSchema.safeParse(input.getRuntime());
  const native = nativeSchema.safeParse(input.getNativeConfigContext());
  const backend = backendSchema.safeParse(input.getBackendSelection());
  if (!runtime.success || !native.success || !backend.success || !same(runtime.data, snapshot.runtime)
    || native.data.id !== snapshot.native.id || native.data.cwd !== snapshot.native.cwd
    || backend.data.family !== snapshot.backend.family || backend.data.revision !== snapshot.backend.revision) throw changed();
}
function identity(snapshot) { return { ...snapshot.runtime }; }
function client(input, snapshot) {
  const headers = new Headers(input.getHeaders());
  return createOpencodeClient({ baseUrl: snapshot.runtime.endpoint, headers, fetch: input.fetchImpl, throwOnError: true });
}
function operation(input, parsed, run, mutation = false) {
  let snapshot;
  try { snapshot = capture(input); } catch (error) { return Promise.reject(error); }
  const controller = new AbortController();
  let retired = false;
  const stop = input.subscribe(() => {
    try { current(input, snapshot); } catch { retired = true; controller.abort(); }
  });
  const abort = () => controller.abort(parsed.signal?.reason);
  parsed.signal?.addEventListener('abort', abort, { once: true });
  if (parsed.signal?.aborted) abort();
  const options = { signal: controller.signal };
  const check = () => { if (retired) throw changed(); current(input, snapshot); parsed.signal?.throwIfAborted(); };
  let dispatched = false;
  return Promise.resolve().then(async () => {
    check();
    if (parsed.expectedIdentity && !same(parsed.expectedIdentity, identity(snapshot))) throw changed();
    try {
      const requestClient = client(input, snapshot);
      check();
      dispatched = true;
      const result = await run(requestClient, options);
      check();
      return result;
    } catch {
      const details = mutation && dispatched ? { credential: VALUE.UNKNOWN, requiresRestart: true } : undefined;
      try { if (retired) throw changed(); current(input, snapshot); }
      catch { throw Object.assign(changed(), details); }
      if (details) throw failed(details);
      if (parsed.signal?.aborted) throw new DOMException('Credential operation canceled', 'AbortError');
      throw failed();
    }
  }).finally(() => {
    parsed.signal?.removeEventListener('abort', abort);
    stop();
  });
}

function oauthFlow(input, parsed) {
  const snapshot = capture(input);
  const controller = new AbortController();
  let retired = false;
  let canceled = false;
  let closed = false;
  let phase = OAUTH_PHASE.READY;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    parsed.signal?.removeEventListener('abort', abort);
    stop();
  };
  const abort = () => {
    canceled = true;
    controller.abort(parsed.signal?.reason);
    cleanup();
  };
  const retire = () => {
    retired = true;
    controller.abort();
    cleanup();
  };
  const stop = input.subscribe(() => {
    try { current(input, snapshot); } catch { retire(); }
  });
  parsed.signal?.addEventListener('abort', abort, { once: true });
  if (parsed.signal?.aborted) abort();
  try {
    const check = () => {
      if (retired) throw changed();
      if (canceled) throw new DOMException('Credential operation canceled', 'AbortError');
      current(input, snapshot);
      parsed.signal?.throwIfAborted();
    };
    check();
    const sdk = client(input, snapshot);
    check();
    const run = async request => {
      check();
      try {
        const result = await request(sdk, { signal: controller.signal });
        check();
        return result;
      } catch {
        const details = { credential: VALUE.UNKNOWN, requiresRestart: true };
        if (retired) throw Object.assign(changed(), details);
        try { current(input, snapshot); } catch { throw Object.assign(changed(), details); }
        throw failed(details);
      }
    };
    const end = () => { phase = OAUTH_PHASE.DONE; cleanup(); };
    return {
      authorize() {
        if (phase !== OAUTH_PHASE.READY) return Promise.reject(failure(STATUS.CHANGED, 'OAuth flow is no longer available'));
        phase = OAUTH_PHASE.AUTHORIZING;
        return run(async (bound, options) => {
          const response = await bound.provider.oauth.authorize({ providerID: parsed.providerID, method: parsed.method, directory: parsed.directory }, options);
          const result = authResultSchema.safeParse(response.data);
          if (!result.success) throw failed();
          return result.data;
        }).then(result => { phase = OAUTH_PHASE.AUTHORIZED; return result; }, error => { end(); throw error; });
      },
      callback(raw = {}) {
        const code = oauthCodeInput.safeParse(raw);
        if (!code.success) return Promise.reject(invalid());
        if (phase !== OAUTH_PHASE.AUTHORIZED) return Promise.reject(failure(STATUS.CHANGED, 'OAuth flow is not ready for callback'));
        phase = OAUTH_PHASE.CALLBACK;
        return run(async (bound, options) => {
          const response = await bound.provider.oauth.callback({ providerID: parsed.providerID, method: parsed.method, code: code.data.code, directory: parsed.directory }, options);
          if (!booleanSchema.safeParse(response.data).success) throw failed();
          return true;
        }).finally(end);
      },
      cancel() {
        if (phase === OAUTH_PHASE.DONE) return;
        canceled = true;
        controller.abort();
        end();
      },
    };
  } catch (error) {
    cleanup();
    if (retired) throw changed();
    if (canceled || parsed.signal?.aborted) throw new DOMException('Credential operation canceled', 'AbortError');
    if (error?.statusCode === STATUS.UNSUPPORTED || error?.statusCode === STATUS.CHANGED) throw error;
    throw failed();
  }
}
function createLegacyCredentialOperations(input) {
  const dependencies = z.object({ getRuntime: z.function(), getNativeConfigContext: z.function(), getBackendSelection: z.function(), getHeaders: z.function(), subscribe: z.function() }).safeParse(input);
  if (!dependencies.success) throw new TypeError('Legacy credential operation dependencies are required');
  const fetchImpl = input.fetchImpl ?? fetch;
  const deps = { ...input, fetchImpl };
  return {
    methods(raw = {}) {
      const parsed = methodsInput.safeParse(raw);
      if (!parsed.success) return Promise.reject(invalid());
      return operation(deps, parsed.data, async (sdk, options) => {
        const response = await sdk.provider.auth({ directory: parsed.data.directory }, options);
        const result = authCatalogSchema.safeParse(response.data);
        if (!result.success) throw failed();
        return result.data;
      });
    },
    save(raw) {
      const parsed = saveInput.safeParse(raw);
      if (!parsed.success) return Promise.reject(invalid());
      return operation(deps, parsed.data, async (sdk, options) => {
        const response = await sdk.auth.set({ providerID: parsed.data.providerID, auth: { type: VALUE.API, key: parsed.data.key }, directory: parsed.data.directory }, options);
        if (response.data !== true) throw failed();
        return true;
      }, true);
    },
    remove(raw) {
      const parsed = removeInput.safeParse(raw);
      if (!parsed.success) return Promise.reject(invalid());
      return operation(deps, parsed.data, async (sdk, options) => {
        const response = await sdk.auth.remove({ providerID: parsed.data.providerID, directory: parsed.data.directory }, options);
        if (!booleanSchema.safeParse(response.data).success) throw failed();
        return true;
      }, true);
    },
    beginOAuth(raw) {
      const parsed = oauthFlowInput.safeParse(raw);
      if (!parsed.success) return Promise.reject(invalid());
      try { return Promise.resolve(oauthFlow(deps, parsed.data)); }
      catch (error) { return Promise.reject(error); }
    },
  };
}

export { createLegacyCredentialOperations };
