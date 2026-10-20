import { z } from 'zod';
import { isRuntimeSwitching, registerRuntimeOAuthCleanup } from '@/lib/runtime-switch';
import { runtimeFetch, type RuntimeFetchOptions } from '@/lib/runtime-fetch';
import { opencodeClient } from './client';
import { OPEN_CODE_PROFILE, type OpenCodeRuntime } from './runtime';

const ROUTE = {
  BASE: '/api/legacy/providers', METHODS: '/methods', SOURCES: '/sources', SAVE: '/save', DISCONNECT: '/disconnect',
  BEGIN: '/oauth/begin', AUTHORIZE: '/oauth/authorize', CALLBACK: '/oauth/callback', CANCEL: '/oauth/cancel',
} as const;
const VALUE = { GENERATION: 'oc1', PROFILE: OPEN_CODE_PROFILE.LEGACY, VERSION: '1.2.27', API: 'api', OAUTH: 'oauth', AUTO: 'auto', CODE: 'code' } as const;
const APPLICATION = { MATCHES: 'matches-persisted', PENDING: 'pending-restart', UNKNOWN: 'unknown' } as const;
const CREDENTIAL = { RETAINED: 'retained', REMOVED: 'removed', UNKNOWN: 'unknown', ABSENT: 'absent' } as const;
const RESIDUAL = { ENVIRONMENT: 'environment', REMOTE: 'remote-config', PLUGINS: 'plugins', EFFECTIVE: 'effective-config' } as const;

const runtimeSchema = z.object({ generation: z.literal(VALUE.GENERATION), profile: z.literal(VALUE.PROFILE), version: z.literal(VALUE.VERSION),
  endpoint: z.string().min(1), epoch: z.union([z.string(), z.number()]) });
const identitySchema = z.strictObject({ generation: z.literal(VALUE.GENERATION), profile: z.literal(VALUE.PROFILE), version: z.literal(VALUE.VERSION),
  endpoint: z.string().min(1), epoch: z.union([z.string(), z.number()]) });
const methodSchema = z.object({ type: z.enum([VALUE.API, VALUE.OAUTH]), label: z.string(),
  prompts: z.array(z.object({ type: z.string(), key: z.string(), message: z.string() }).passthrough()).optional() }).passthrough();
const methodsSchema = z.record(z.string(), z.array(methodSchema));
const sourceSchema = z.strictObject({ path: z.string().nullable(), scope: z.enum(['user', 'project', 'inline', 'managed']),
  origin: z.enum(['global', 'explicit-config', 'project-root', 'dot-directory', 'explicit-config-dir', 'inline', 'managed']), order: z.number().int(), writable: z.boolean() });
const sourcesSchema = z.strictObject({ providerId: z.string(), layers: z.array(sourceSchema), auth: z.strictObject({ exists: z.boolean() }), complete: z.boolean(),
  residuals: z.array(z.enum(Object.values(RESIDUAL))), application: z.strictObject({ configuration: z.enum(Object.values(APPLICATION)) }) });
const attemptSchema = z.strictObject({ attemptId: z.string().min(1) });
const authorizationSchema = z.strictObject({ url: z.string().url(), method: z.enum([VALUE.AUTO, VALUE.CODE]), instructions: z.string() });
const persistedFields = { persisted: z.literal(true), requiresRestart: z.literal(true) };
const persistedSchema = z.strictObject(persistedFields);
const disconnectSchema = z.strictObject({ ...persistedFields, removed: z.array(z.string()), credential: z.enum(Object.values(CREDENTIAL)),
  application: z.strictObject({ configuration: z.enum(Object.values(APPLICATION)) }) });
const outcomeSchema = z.strictObject({ persisted: z.boolean().optional(), partial: z.boolean().optional(), requiresRestart: z.boolean().optional(),
  removed: z.array(z.string()).optional(), remaining: z.array(z.string()).optional(), credential: z.enum(Object.values(CREDENTIAL)).optional() });
const errorSchema = z.object({ error: z.string().optional(), outcome: outcomeSchema.optional(), credential: z.enum(Object.values(CREDENTIAL)).optional(),
  requiresRestart: z.boolean().optional() });

export type LegacyProviderSource = z.infer<typeof sourceSchema>;
export type LegacyProviderSources = z.infer<typeof sourcesSchema>;
export type LegacyProviderMethods = z.infer<typeof methodsSchema>;
export type LegacyProviderSave = z.infer<typeof persistedSchema>;
export type LegacyProviderDisconnect = z.infer<typeof disconnectSchema>;
export type LegacyProviderOutcome = z.infer<typeof outcomeSchema>;
type RuntimeIdentity = z.infer<typeof identitySchema>;
type IdentityPayload = { identity: RuntimeIdentity; directory?: string };
type ProviderPayload = { identity: RuntimeIdentity; providerID: string; directory?: string };
type CredentialPayload = ProviderPayload & { key: string };
type OAuthStartPayload = ProviderPayload & { method: number };
type OAuthAttemptPayload = { attemptId: string };
type OAuthCallbackPayload = OAuthAttemptPayload & { code?: string };
type Payload = IdentityPayload | ProviderPayload | CredentialPayload | OAuthStartPayload | OAuthAttemptPayload | OAuthCallbackPayload;
export type LegacyProviderRequest = { directory?: string; signal?: AbortSignal };
export type LegacyProviderOAuthFlow = {
  attemptId: string;
  authorize(signal?: AbortSignal): Promise<z.infer<typeof authorizationSchema>>;
  callback(code?: string, signal?: AbortSignal): Promise<LegacyProviderSave>;
  cancel(signal?: AbortSignal): Promise<void>;
};
type Fetcher = (input: string | URL | Request, init?: RuntimeFetchOptions) => Promise<Response>;

export class LegacyProviderError extends Error {
  constructor(readonly kind: 'unsupported' | 'stale' | 'request', readonly status: number, readonly outcome?: LegacyProviderOutcome,
    readonly credential?: z.infer<typeof errorSchema>['credential'], readonly requiresRestart?: boolean) {
    super(kind === 'unsupported' ? 'Legacy providers are not supported by this runtime' : kind === 'stale'
      ? 'The OpenCode runtime changed during the provider operation' : 'Legacy provider request failed');
    this.name = 'LegacyProviderError';
  }
}

const sameRuntime = (left: RuntimeIdentity, right: RuntimeIdentity): boolean => left.generation === right.generation && left.profile === right.profile
  && left.version === right.version && left.endpoint === right.endpoint && left.epoch === right.epoch;
const requireRuntime = (getRuntime: () => OpenCodeRuntime | null): RuntimeIdentity => {
  const parsed = runtimeSchema.safeParse(getRuntime());
  if (!parsed.success) throw new LegacyProviderError('unsupported', 501);
  return identitySchema.parse(parsed.data);
};

const post = async <T>(fetcher: Fetcher, path: string, payload: Payload, schema: z.ZodType<T>, options: LegacyProviderRequest = {}): Promise<T> => {
  options.signal?.throwIfAborted();
  const init: RuntimeFetchOptions = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: options.signal };
  if (options.directory !== undefined) init.directory = options.directory;
  const response = await fetcher(`${ROUTE.BASE}${path}`, init);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(await response.json().catch(() => null));
    const kind = response.status === 501 ? 'unsupported' : response.status === 409 ? 'stale' : 'request';
    throw new LegacyProviderError(kind, response.status, parsed.success ? parsed.data.outcome : undefined,
      parsed.success ? parsed.data.credential : undefined, parsed.success ? parsed.data.requiresRestart : undefined);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new LegacyProviderError('request', response.status);
  options.signal?.throwIfAborted();
  return parsed.data;
};

export function createLegacyProviderService(options: { getRuntime: () => OpenCodeRuntime | null; fetch?: Fetcher }) {
  const fetcher = options.fetch ?? runtimeFetch;
  const bound = (runtime: RuntimeIdentity): void => {
    const current = runtimeSchema.safeParse(options.getRuntime());
    if (!current.success || !sameRuntime(runtime, identitySchema.parse(current.data))) throw new LegacyProviderError('stale', 409);
  };
  const call = async <T>(runtime: RuntimeIdentity, path: string, payload: Payload, schema: z.ZodType<T>, request: LegacyProviderRequest): Promise<T> => {
    bound(runtime);
    const result = await post(fetcher, path, payload, schema, request);
    bound(runtime);
    return result;
  };
  const body = (runtime: RuntimeIdentity, request: LegacyProviderRequest): IdentityPayload => {
    const payload: IdentityPayload = { identity: runtime };
    if (request.directory !== undefined) payload.directory = request.directory;
    return payload;
  };
  const methods = async (request: LegacyProviderRequest = {}): Promise<LegacyProviderMethods> => {
    const runtime = requireRuntime(options.getRuntime);
    return call(runtime, ROUTE.METHODS, body(runtime, request), methodsSchema, request);
  };
  const sources = async (providerID: string, request: LegacyProviderRequest = {}): Promise<LegacyProviderSources> => {
    const runtime = requireRuntime(options.getRuntime);
    return call(runtime, ROUTE.SOURCES, { ...body(runtime, request), providerID }, sourcesSchema, request);
  };
  const save = async (providerID: string, key: string, request: LegacyProviderRequest = {}): Promise<LegacyProviderSave> => {
    const runtime = requireRuntime(options.getRuntime);
    return call(runtime, ROUTE.SAVE, { ...body(runtime, request), providerID, key }, persistedSchema, request);
  };
  const disconnect = async (providerID: string, request: LegacyProviderRequest = {}): Promise<LegacyProviderDisconnect> => {
    const runtime = requireRuntime(options.getRuntime);
    return call(runtime, ROUTE.DISCONNECT, { ...body(runtime, request), providerID }, disconnectSchema, request);
  };
  type ActiveFlow = { invalidate: () => void; cancel: (signal?: AbortSignal) => Promise<void> };
  const activeFlows = new Set<ActiveFlow>();
  const pendingBegins = new Map<Promise<void>, AbortController>();
  let cleanupPromise: Promise<void> | undefined;
  let cleanupSignal: AbortSignal | undefined;
  let cleanupGeneration = 0;
  const wait = async <T>(pending: Promise<T>, signal: AbortSignal): Promise<T> => {
    if (signal.aborted) throw signal.reason ?? new DOMException('OAuth cleanup aborted', 'AbortError');
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason ?? new DOMException('OAuth cleanup aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
      })]);
    }
    finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
  };
  const cleanupOAuth = (signal: AbortSignal): Promise<void> | undefined => {
    if (cleanupPromise) return cleanupPromise;
    if (pendingBegins.size === 0 && activeFlows.size === 0) return undefined;
    cleanupGeneration += 1;
    cleanupSignal = signal;
    const abortBegins = (): void => { for (const controller of pendingBegins.values()) controller.abort(signal.reason); };
    signal.addEventListener('abort', abortBegins, { once: true });
    if (signal.aborted) abortBegins();
    for (const flow of activeFlows) flow.invalidate();
    cleanupPromise = (async () => {
      while (pendingBegins.size > 0) await wait(Promise.all([...pendingBegins.keys()]), signal);
      const results = await wait(Promise.allSettled([...activeFlows].map(flow => flow.cancel(signal))), signal);
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    })().finally(() => {
      for (const flow of activeFlows) flow.invalidate();
      activeFlows.clear();
      pendingBegins.clear();
      signal.removeEventListener('abort', abortBegins);
      cleanupPromise = undefined;
      cleanupSignal = undefined;
    });
    return cleanupPromise;
  };
  const beginOAuth = async (providerID: string, method: number, request: LegacyProviderRequest = {}): Promise<LegacyProviderOAuthFlow> => {
    if (cleanupPromise || isRuntimeSwitching()) throw new LegacyProviderError('stale', 409);
    const runtime = requireRuntime(options.getRuntime);
    bound(runtime);
    const generation = cleanupGeneration;
    let completeBegin!: () => void;
    const pending = new Promise<void>(resolve => { completeBegin = resolve; });
    const beginController = new AbortController();
    const abortBegin = (): void => beginController.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', abortBegin, { once: true });
    if (request.signal?.aborted) abortBegin();
    pendingBegins.set(pending, beginController);
    try {
      const result = await wait(post(fetcher, ROUTE.BEGIN, { ...body(runtime, request), providerID, method }, attemptSchema, { ...request, signal: beginController.signal }), beginController.signal);
      bound(runtime);
      let closed = false;
      let invalidated = false;
      let cancelPromise: Promise<void> | undefined;
      let cancelController: AbortController | undefined;
      let removeCleanupAbort: (() => void) | undefined;
      const check = (): void => { if (closed || invalidated) throw new LegacyProviderError('stale', 409); request.signal?.throwIfAborted(); bound(runtime); };
      const retire = (): void => { closed = true; if (!cancelPromise) activeFlows.delete(flow); request.signal?.removeEventListener('abort', onAbort); };
      const cancel = (signal?: AbortSignal): Promise<void> => {
        if (cancelPromise) {
          if (signal && cancelController && !removeCleanupAbort) {
            const abort = (): void => cancelController?.abort(signal.reason);
            if (signal.aborted) abort();
            else {
              signal.addEventListener('abort', abort, { once: true });
              removeCleanupAbort = () => signal.removeEventListener('abort', abort);
            }
          }
          return cancelPromise;
        }
        if (closed) return Promise.resolve();
        closed = true;
        request.signal?.removeEventListener('abort', onAbort);
        const current = runtimeSchema.safeParse(options.getRuntime());
        if (!current.success || !sameRuntime(runtime, identitySchema.parse(current.data))) {
          activeFlows.delete(flow);
          return Promise.resolve();
        }
        cancelController = new AbortController();
        if (signal) {
          const abort = (): void => cancelController?.abort(signal.reason);
          if (signal.aborted) abort();
          else {
            signal.addEventListener('abort', abort, { once: true });
            removeCleanupAbort = () => signal.removeEventListener('abort', abort);
          }
        }
        cancelPromise = post(fetcher, ROUTE.CANCEL, { attemptId: result.attemptId }, z.strictObject({ canceled: z.literal(true) }), {
          directory: request.directory, signal: cancelController.signal,
        }).then(() => { activeFlows.delete(flow); }).finally(() => { removeCleanupAbort?.(); });
        return cancelPromise;
      };
      const onAbort = (): void => { void cancel().catch(() => undefined); };
      const flow: ActiveFlow = { invalidate: () => { invalidated = true; request.signal?.removeEventListener('abort', onAbort); }, cancel };
      if (generation !== cleanupGeneration) {
        if (cleanupSignal && !cleanupSignal.aborted) {
          activeFlows.add(flow);
          await cancel(cleanupSignal);
        }
        throw new LegacyProviderError('stale', 409);
      }
      activeFlows.add(flow);
      if (request.signal?.aborted) { await cancel(); request.signal.throwIfAborted(); }
      request.signal?.addEventListener('abort', onAbort, { once: true });
      return {
        attemptId: result.attemptId,
        authorize: async (signal) => {
          check();
          const authorization = await call(runtime, ROUTE.AUTHORIZE, { attemptId: result.attemptId }, authorizationSchema, { ...request, signal: signal ?? request.signal });
          check();
          return authorization;
        },
        callback: async (code, signal) => {
          check();
          const payload: OAuthCallbackPayload = { attemptId: result.attemptId };
          if (code !== undefined) payload.code = code;
          try {
            const saved = await call(runtime, ROUTE.CALLBACK, payload, persistedSchema, { ...request, signal: signal ?? request.signal });
            check();
            return saved;
          }
          finally { retire(); }
        },
        cancel: (signal) => cancel(signal),
      };
    }
    finally { request.signal?.removeEventListener('abort', abortBegin); pendingBegins.delete(pending); completeBegin(); }
  };
  return { methods, sources, save, disconnect, beginOAuth, cleanupOAuth };
}

const legacyProviderService = createLegacyProviderService({ getRuntime: () => opencodeClient.getBoundRuntime() });
export const legacyProviderMethods = legacyProviderService.methods;
export const legacyProviderSources = legacyProviderService.sources;
export const saveLegacyProvider = legacyProviderService.save;
export const disconnectLegacyProvider = legacyProviderService.disconnect;
export const beginLegacyProviderOAuth = legacyProviderService.beginOAuth;
registerRuntimeOAuthCleanup(legacyProviderService.cleanupOAuth);
