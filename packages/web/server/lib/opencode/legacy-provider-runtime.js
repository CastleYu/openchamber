import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createLegacyCredentials } from './legacy-credentials.js';
import { createLegacyCredentialOperations } from './legacy-credential-operations.js';
import { createLegacyProviderConfig } from './legacy-provider-config.js';

const FIELD = Object.freeze({ CALLER: 'caller', ID: 'id', EXPIRES: 'expiresAt', FLOW: 'flow', SNAPSHOT: 'snapshot', AUTHORIZING: 'authorizing', CALLBACK: 'callback', SIGNAL: 'signal', ABORT: 'abort' });
const STATUS = Object.freeze({ INVALID: 400, CONFLICT: 409 });
const MESSAGE = Object.freeze({ INVALID: 'Invalid OAuth attempt', CONFLICT: 'OAuth attempt is unavailable' });
const LIMIT = Object.freeze({ TTL: 30 * 60 * 1000, CALLER: 512, ATTEMPT: 128 });
const callerSchema = z.string().min(1).max(LIMIT.CALLER);
const attemptSchema = z.string().min(1).max(LIMIT.ATTEMPT);

function failure(statusCode, message) { return Object.assign(new Error(message), { statusCode }); }
function invalid() { return failure(STATUS.INVALID, MESSAGE.INVALID); }
function conflict() { return failure(STATUS.CONFLICT, MESSAGE.CONFLICT); }
function same(left, right) {
  return Boolean(left && right && left.owner.id === right.owner.id && left.owner.cwd === right.owner.cwd
    && left.runtime.generation === right.runtime.generation && left.runtime.profile === right.runtime.profile
    && left.runtime.version === right.runtime.version && left.runtime.endpoint === right.runtime.endpoint
    && left.runtime.epoch === right.runtime.epoch && left.backend.family === right.backend.family
    && left.backend.revision === right.backend.revision);
}
function capture(input, required = true) {
  const owner = input.getNativeConfigContext();
  const runtime = input.getRuntime();
  const backend = input.getBackendSelection();
  if (!owner || !runtime || !backend || !runtime.endpoint || !runtime.version) {
    if (required) throw conflict();
    return null;
  }
  return { owner: { id: owner.id, cwd: owner.cwd }, runtime: { generation: runtime.generation, profile: runtime.profile,
    version: runtime.version, endpoint: runtime.endpoint, epoch: runtime.epoch }, backend: { family: backend.family, revision: backend.revision } };
}

function createLegacyProviderRuntime(input) {
  const now = input.now ?? Date.now;
  const ttl = input.ttlMs ?? LIMIT.TTL;
  const attempts = new Map();
  let disposed = false;
  let timer = null;
  let unsubscribe = () => {};
  const dependencies = { ...input, subscribe: input.subscribeCredentialOwner };
  const credentials = createLegacyCredentials(dependencies);
  const operations = createLegacyCredentialOperations(dependencies);
  const providerConfig = createLegacyProviderConfig({
    getNativeConfigContext: input.getNativeConfigContext,
    getRuntime: input.getRuntime,
    getBackendSelection: input.getBackendSelection,
    credentials,
    operations: {
      ...input.kernelOperations,
      removeLegacyCredential: request => operations.remove(request),
    },
  });
  let providerOwner = capture(input, false);
  const release = (entry, cancel) => {
    if (attempts.get(entry[FIELD.ID]) !== entry) return;
    attempts.delete(entry[FIELD.ID]);
    entry[FIELD.SIGNAL]?.removeEventListener('abort', entry[FIELD.ABORT]);
    if (cancel) entry[FIELD.FLOW].cancel();
    schedule();
  };
  const expire = () => {
    const time = now();
    for (const entry of attempts.values()) if (entry[FIELD.EXPIRES] <= time) release(entry, true);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (disposed || attempts.size === 0) return;
    const next = Math.min(...[...attempts.values()].map(entry => entry[FIELD.EXPIRES]));
    timer = setTimeout(() => { timer = null; expire(); schedule(); }, Math.max(1, next - now()));
    timer.unref?.();
  };
  const retireChanged = () => {
    if (disposed) return;
    let currentProviderOwner;
    try { currentProviderOwner = capture(input); } catch { currentProviderOwner = null; }
    const ownerChanged = !currentProviderOwner || !providerOwner || providerOwner.owner.id !== currentProviderOwner.owner.id
      || providerOwner.owner.cwd !== currentProviderOwner.owner.cwd;
    if (!same(providerOwner, currentProviderOwner)) providerConfig.clear(ownerChanged);
    providerOwner = currentProviderOwner;
    for (const entry of attempts.values()) {
      let current;
      try { current = capture(input); } catch { current = null; }
      if (!same(entry[FIELD.SNAPSHOT], current)) release(entry, true);
    }
  };
  unsubscribe = input.subscribeCredentialOwner(retireChanged);
  const validate = (caller, attemptId) => {
    if (!callerSchema.safeParse(caller).success || !attemptSchema.safeParse(attemptId).success) throw invalid();
    if (disposed) throw conflict();
    expire();
    const entry = attempts.get(attemptId);
    if (!entry || entry[FIELD.CALLER] !== caller) throw conflict();
    return entry;
  };
  const beginOAuth = async (caller, request) => {
    if (!callerSchema.safeParse(caller).success) throw invalid();
    if (disposed) throw conflict();
    const snapshot = capture(input);
    const flow = await operations.beginOAuth(request);
    let attemptId;
    do { attemptId = randomBytes(32).toString('base64url'); } while (attempts.has(attemptId));
    const entry = { [FIELD.ID]: attemptId, [FIELD.CALLER]: caller, [FIELD.EXPIRES]: now() + ttl, [FIELD.AUTHORIZING]: false, [FIELD.CALLBACK]: false,
      [FIELD.FLOW]: flow, [FIELD.SNAPSHOT]: snapshot, [FIELD.SIGNAL]: request.signal, [FIELD.ABORT]: null };
    let current;
    try { current = capture(input); } catch { flow.cancel(); throw conflict(); }
    if (disposed || !same(snapshot, current)) { flow.cancel(); throw conflict(); }
    if (request.signal?.aborted) { flow.cancel(); throw conflict(); }
    entry[FIELD.ABORT] = () => release(entry, true);
    attempts.set(attemptId, entry);
    request.signal?.addEventListener('abort', entry[FIELD.ABORT], { once: true });
    schedule();
    return { attemptId };
  };
  const authorizeOAuth = async (caller, attemptId) => {
    const entry = validate(caller, attemptId);
    if (entry[FIELD.AUTHORIZING]) throw conflict();
    entry[FIELD.AUTHORIZING] = true;
    try {
      return await entry[FIELD.FLOW].authorize();
    } catch (error) {
      // A dispatched authorization can have an unknown remote outcome; preserve the private error contract.
      release(entry, true);
      throw error;
    }
  };
  const callbackOAuth = async (caller, attemptId, request) => {
    const entry = validate(caller, attemptId);
    if (entry[FIELD.CALLBACK]) throw conflict();
    entry[FIELD.CALLBACK] = true;
    try { return await entry[FIELD.FLOW].callback(request); }
    finally { release(entry, true); }
  };
  const cancelOAuth = (caller, attemptId) => {
    const entry = validate(caller, attemptId);
    release(entry, true);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    providerConfig.clear(true);
    if (timer) clearTimeout(timer);
    timer = null;
    for (const entry of [...attempts.values()]) release(entry, true);
  };
  return {
    sources: (name, directory) => disposed ? Promise.reject(conflict()) : providerConfig.sources(name, directory),
    disconnect: (name, directory, signal) => disposed ? Promise.reject(conflict()) : providerConfig.disconnect(name, directory, signal),
    methods: request => disposed ? Promise.reject(conflict()) : operations.methods(request),
    save: request => disposed ? Promise.reject(conflict()) : operations.save(request),
    beginOAuth,
    authorizeOAuth,
    callbackOAuth,
    cancelOAuth,
    dispose,
  };
}

export { createLegacyProviderRuntime };
