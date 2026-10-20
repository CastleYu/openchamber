import { expect, test } from 'bun:test';
import { switchRuntimeEndpoint, subscribeRuntimeEndpointWillChange } from '@/lib/runtime-switch';
import { createLegacyProviderService, LegacyProviderError } from './legacy-providers';
import type { OpenCodeRuntime } from './runtime';

const runtime = (): OpenCodeRuntime => ({ generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'https://legacy.test', epoch: 1 });
const service = (getRuntime: () => OpenCodeRuntime | null, fetch: Parameters<typeof createLegacyProviderService>[0]['fetch']) =>
  createLegacyProviderService({ getRuntime, fetch });
const failure = async (request: Promise<unknown>): Promise<LegacyProviderError> => {
  try { await request; } catch (error) { if (error instanceof LegacyProviderError) return error; throw error; }
  throw new Error('Expected LegacyProviderError');
};

test('methods and sources use the exact Legacy identity and settings directory', async () => {
  const requests: Array<{ path: string; body: string; directory?: string | null; signal?: AbortSignal | null }> = [];
  const api = service(runtime, async (input, init) => {
    requests.push({ path: String(input), body: String(init?.body), directory: init?.directory, signal: init?.signal });
    return Response.json(String(input).endsWith('/methods') ? { openai: [{ type: 'api', label: 'API key' }] } : {
      providerId: 'openai', layers: [], auth: { exists: false }, complete: true, residuals: [],
      application: { configuration: 'matches-persisted' },
    });
  });
  const controller = new AbortController();
  expect(await api.methods({ directory: '/settings/project', signal: controller.signal })).toEqual({ openai: [{ type: 'api', label: 'API key' }] });
  expect((await api.sources('openai', { directory: '/settings/project' })).application.configuration).toBe('matches-persisted');
  expect(requests.map(item => item.path)).toEqual(['/api/legacy/providers/methods', '/api/legacy/providers/sources']);
  expect(requests[0]?.body).toBe(JSON.stringify({ identity: runtime(), directory: '/settings/project' }));
  expect(requests[0]?.directory).toBe('/settings/project');
  expect(requests[0]?.signal).toBe(controller.signal);
  expect(requests[0]?.body).toContain('"epoch":1');
});

test('unsupported runtimes and malformed authoritative responses fail', async () => {
  let requests = 0;
  const unsupported = service(() => ({ ...runtime(), profile: 'oc1' }), async () => { requests += 1; return Response.json({}); });
  const unsupportedError = await failure(unsupported.methods());
  expect(unsupportedError.kind).toBe('unsupported');
  expect(requests).toBe(0);
  const malformed = service(runtime, async () => Response.json({ providerId: 'openai', layers: [], auth: { exists: false } }));
  expect(await failure(malformed.sources('openai'))).toBeInstanceOf(LegacyProviderError);
});

test('a runtime switch while a read is in flight rejects the late response', async () => {
  let current = runtime();
  let finish: (response: Response) => void = () => undefined;
  const api = service(() => current, async () => new Promise(resolve => { finish = resolve; }));
  const pending = api.methods();
  current = { ...current, epoch: 2 };
  finish(Response.json({}));
  const staleError = await failure(pending);
  expect(staleError.kind).toBe('stale');
  expect(staleError.status).toBe(409);
});

test('a begin response from a retired runtime is rejected without routing cancel to its replacement', async () => {
  let current = runtime();
  let finish: (response: Response) => void = () => undefined;
  const seen: string[] = [];
  const api = service(() => current, async input => {
    seen.push(String(input));
    return new Promise(resolve => { finish = resolve; });
  });
  const pending = api.beginOAuth('openai', 0);
  current = { ...current, epoch: 2 };
  finish(Response.json({ attemptId: 'retired-attempt' }));
  expect((await failure(pending)).kind).toBe('stale');
  expect(seen).toEqual(['/api/legacy/providers/oauth/begin']);
});

test('disconnect preserves precise partial and unknown credential outcomes', async () => {
  const outcome = { persisted: false, partial: true, requiresRestart: true, removed: ['/user/config.json'],
    remaining: ['/project/config.json'], credential: 'unknown' };
  const api = service(runtime, async () => Response.json({ error: 'Provider request failed', outcome, credential: 'unknown', requiresRestart: true }, { status: 500 }));
  const error = await failure(api.disconnect('openai', { directory: '/repo' }));
  expect(error.status).toBe(500);
  expect(error.outcome).toEqual(outcome);
  expect(error.credential).toBe('unknown');
  expect(error.requiresRestart).toBe(true);
});

test('OAuth flow binds follow-up to its runtime and cancels only on that runtime', async () => {
  let current = runtime();
  const seen: string[] = [];
  const api = service(() => current, async input => {
    const path = String(input);
    seen.push(path);
    if (path.endsWith('/oauth/begin')) return Response.json({ attemptId: 'attempt-1' });
    if (path.endsWith('/oauth/authorize')) return Response.json({ url: 'https://auth.test', method: 'code', instructions: 'Enter code' });
    return Response.json({ canceled: true });
  });
  const flow = await api.beginOAuth('openai', 0, { directory: '/repo' });
  expect(await flow.authorize()).toEqual({ url: 'https://auth.test', method: 'code', instructions: 'Enter code' });
  current = { ...current, endpoint: 'https://next.test', epoch: 2 };
  expect((await failure(flow.authorize())).kind).toBe('stale');
  await flow.cancel();
  expect(seen).toEqual(['/api/legacy/providers/oauth/begin', '/api/legacy/providers/oauth/authorize']);
});

test('OAuth cancel sends the attempt only while the captured runtime is current', async () => {
  const seen: string[] = [];
  const api = service(() => ({ ...runtime(), status: 'ready' }), async input => {
    const path = String(input);
    seen.push(path);
    return path.endsWith('/oauth/begin') ? Response.json({ attemptId: 'attempt-3' }) : Response.json({ canceled: true });
  });
  const controller = new AbortController();
  const flow = await api.beginOAuth('openai', 0, { signal: controller.signal });
  await flow.cancel();
  expect(seen).toEqual(['/api/legacy/providers/oauth/begin', '/api/legacy/providers/oauth/cancel']);
});

test('cancel retires an in-flight authorization result', async () => {
  let finish: (response: Response) => void = () => undefined;
  const api = service(runtime, async input => {
    const path = String(input);
    if (path.endsWith('/oauth/begin')) return Response.json({ attemptId: 'attempt-5' });
    if (path.endsWith('/oauth/authorize')) return new Promise(resolve => { finish = resolve; });
    return Response.json({ canceled: true });
  });
  const flow = await api.beginOAuth('openai', 0);
  const authorization = flow.authorize();
  await flow.cancel();
  finish(Response.json({ url: 'https://auth.test', method: 'code', instructions: 'Too late' }));
  expect((await failure(authorization)).kind).toBe('stale');
});

test('aborting the OAuth lifetime cancels its attempt with an independent signal', async () => {
  const controller = new AbortController();
  const seen: Array<{ path: string; signal?: AbortSignal | null }> = [];
  const api = service(runtime, async (input, init) => {
    seen.push({ path: String(input), signal: init?.signal });
    return String(input).endsWith('/oauth/begin') ? Response.json({ attemptId: 'attempt-4' }) : Response.json({ canceled: true });
  });
  await api.beginOAuth('openai', 0, { signal: controller.signal });
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(seen.map(item => item.path)).toEqual(['/api/legacy/providers/oauth/begin', '/api/legacy/providers/oauth/cancel']);
  expect(seen[0]?.signal).toBeDefined();
  expect(seen[0]?.signal).not.toBe(controller.signal);
  expect(seen[1]?.signal).toBeDefined();
  expect(seen[1]?.signal?.aborted).toBe(false);
});

test('save and OAuth callback return persisted and restart outcomes', async () => {
  const api = service(runtime, async input => String(input).endsWith('/oauth/begin') ? Response.json({ attemptId: 'attempt-2' })
    : Response.json({ persisted: true, requiresRestart: true }));
  expect(await api.save('openai', 'secret', { directory: '/repo' })).toEqual({ persisted: true, requiresRestart: true });
  const flow = await api.beginOAuth('openai', 0);
  expect(await flow.callback('auth-code')).toEqual({ persisted: true, requiresRestart: true });
});

test('cleanup waits for a pending begin and cancels its original attempt', async () => {
  let finishBegin: (response: Response) => void = () => undefined;
  const seen: string[] = [];
  const api = service(runtime, async input => {
    const path = String(input);
    seen.push(path);
    if (path.endsWith('/oauth/begin')) return new Promise(resolve => { finishBegin = resolve; });
    return Response.json({ canceled: true });
  });
  const begin = api.beginOAuth('openai', 0);
  const cleanup = api.cleanupOAuth(new AbortController().signal);
  if (!cleanup) throw new Error('Expected pending begin cleanup');
  let completed = false;
  void cleanup.then(() => { completed = true; });
  await Promise.resolve();
  expect(completed).toBe(false);
  finishBegin(Response.json({ attemptId: 'pending-attempt' }));
  expect((await failure(begin)).kind).toBe('stale');
  await cleanup;
  expect(seen).toEqual(['/api/legacy/providers/oauth/begin', '/api/legacy/providers/oauth/cancel']);
});

test('cleanup reuses cancellation already started by an aborted OAuth lifetime', async () => {
  const controller = new AbortController();
  let finishCancel: (response: Response) => void = () => undefined;
  const seen: string[] = [];
  const api = service(runtime, async input => {
    const path = String(input);
    seen.push(path);
    if (path.endsWith('/oauth/begin')) return Response.json({ attemptId: 'aborted-attempt' });
    return new Promise(resolve => { finishCancel = resolve; });
  });
  await api.beginOAuth('openai', 0, { signal: controller.signal });
  controller.abort();
  await Promise.resolve();
  const cleanupSignal = new AbortController().signal;
  const cleanup = api.cleanupOAuth(cleanupSignal);
  if (!cleanup) throw new Error('Expected active flow cleanup');
  expect(api.cleanupOAuth(cleanupSignal)).toBe(cleanup);
  expect(seen).toEqual(['/api/legacy/providers/oauth/begin', '/api/legacy/providers/oauth/cancel']);
  finishCancel(Response.json({ canceled: true }));
  await cleanup;
  expect(seen.filter(path => path.endsWith('/oauth/cancel'))).toHaveLength(1);
});

test('cleanup waits for cancellation failure and releases the begin gate', async () => {
  let failCancel: (response: Response) => void = () => undefined;
  let beginCount = 0;
  const seen: string[] = [];
  const api = service(runtime, async input => {
    const path = String(input);
    seen.push(path);
    if (path.endsWith('/oauth/begin')) return Response.json({ attemptId: ++beginCount === 1 ? 'failure-attempt' : 'next-attempt' });
    if (path.endsWith('/oauth/cancel')) return new Promise(resolve => { failCancel = resolve; });
    return Response.json({ attemptId: 'next-attempt' });
  });
  await api.beginOAuth('openai', 0);
  const cleanup = api.cleanupOAuth(new AbortController().signal);
  if (!cleanup) throw new Error('Expected active flow cleanup');
  expect((await failure(api.beginOAuth('openai', 0))).kind).toBe('stale');
  await Promise.resolve();
  expect(seen.filter(path => path.endsWith('/oauth/begin'))).toHaveLength(1);
  failCancel(Response.json({ error: 'failed' }, { status: 500 }));
  expect((await failure(cleanup)).kind).toBe('request');
  expect((await api.beginOAuth('openai', 0)).attemptId).toBe('next-attempt');
  expect(seen.filter(path => path.endsWith('/oauth/begin'))).toHaveLength(2);
});

test('cleanup never sends a stale attempt to a replacement runtime', async () => {
  let current = runtime();
  const seen: string[] = [];
  const api = service(() => current, async input => {
    const path = String(input);
    seen.push(path);
    return path.endsWith('/oauth/begin') ? Response.json({ attemptId: 'old-runtime-attempt' }) : Response.json({ canceled: true });
  });
  await api.beginOAuth('openai', 0);
  current = { ...current, endpoint: 'https://replacement.test', epoch: 2 };
  const cleanup = api.cleanupOAuth(new AbortController().signal);
  if (!cleanup) throw new Error('Expected active flow cleanup');
  await cleanup;
  expect(seen).toEqual(['/api/legacy/providers/oauth/begin']);
});

test('cleanup returns no work when no OAuth attempt exists', () => {
  const api = service(runtime, async () => Response.json({}));
  expect(api.cleanupOAuth(new AbortController().signal)).toBeUndefined();
});

test('cleanup deadline aborts owned cancellation and releases the begin gate', async () => {
  let current = runtime();
  let cancelSignal: AbortSignal | null | undefined;
  const seen: string[] = [];
  const api = service(() => current, async (input, init) => {
    const path = String(input);
    seen.push(path);
    if (path.endsWith('/oauth/begin')) return Response.json({ attemptId: 'deadline-attempt' });
    cancelSignal = init?.signal;
    return new Promise(() => undefined);
  });
  await api.beginOAuth('openai', 0);
  const controller = new AbortController();
  const cleanup = api.cleanupOAuth(controller.signal);
  if (!cleanup) throw new Error('Expected active flow cleanup');
  await Promise.resolve();
  controller.abort();
  const error = await cleanup.catch(reason => reason);
  expect(error).toBeInstanceOf(DOMException);
  expect(cancelSignal?.aborted).toBe(true);
  current = { ...current, endpoint: 'https://replacement.test', epoch: 2 };
  expect((await api.beginOAuth('openai', 0)).attemptId).toBe('deadline-attempt');
  expect(seen).toEqual(['/api/legacy/providers/oauth/begin', '/api/legacy/providers/oauth/cancel', '/api/legacy/providers/oauth/begin']);
});

test('deadline aborts a pending begin even if transport ignores abort, without contaminating the next runtime', async () => {
  let current = runtime();
  let finish: (response: Response) => void = () => {};
  let beginSignal: AbortSignal | null | undefined;
  const seen: string[] = [];
  const api = service(() => current, async (input, init) => {
    seen.push(String(input));
    if (seen.length === 1) { beginSignal = init?.signal; return new Promise(resolve => { finish = resolve; }); }
    return Response.json({ attemptId: 'replacement-attempt' });
  });
  const begin = api.beginOAuth('openai', 0).then(() => 'unexpected', error => error);
  const deadline = new AbortController();
  const cleanup = api.cleanupOAuth(deadline.signal);
  if (!cleanup) throw new Error('Expected pending cleanup');
  const canceled = cleanup.catch(error => error);
  deadline.abort();
  expect(await begin).toBeInstanceOf(DOMException);
  await canceled;
  expect(beginSignal?.aborted).toBe(true);
  current = { ...current, endpoint: 'https://replacement.test', epoch: 2 };
  expect((await api.beginOAuth('openai', 0)).attemptId).toBe('replacement-attempt');
  finish(Response.json({ attemptId: 'late-old-attempt' }));
  await Promise.resolve();
  expect(seen).toEqual(['/api/legacy/providers/oauth/begin', '/api/legacy/providers/oauth/begin']);
});

test('an already-failed cancellation remains unconfirmed until switch cleanup consumes it', async () => {
  const seen: string[] = [];
  const api = service(runtime, async input => {
    seen.push(String(input));
    return String(input).endsWith('/oauth/begin') ? Response.json({ attemptId: 'failed-cancel' }) : Response.json({ error: 'offline' }, { status: 500 });
  });
  const flow = await api.beginOAuth('openai', 0);
  await failure(flow.cancel());
  const cleanup = api.cleanupOAuth(new AbortController().signal);
  if (!cleanup) throw new Error('Failure must remain visible to cleanup');
  expect((await failure(cleanup)).kind).toBe('request');
  expect(api.cleanupOAuth(new AbortController().signal)).toBeUndefined();
  expect(seen.filter(path => path.endsWith('/oauth/cancel'))).toHaveLength(1);
});

test('no begin can dispatch in the interval between cleanup completion and endpoint commit', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  } });
  let requests = 0;
  const api = service(runtime, async () => { requests += 1; return Response.json({ attemptId: 'unexpected' }); });
  let rejected: Promise<LegacyProviderError> | undefined;
  const remove = subscribeRuntimeEndpointWillChange(() => { rejected = failure(api.beginOAuth('openai', 0)); });
  try {
    await switchRuntimeEndpoint({ apiBaseUrl: 'https://replacement.test' });
    expect((await rejected)?.kind).toBe('stale');
    expect(requests).toBe(0);
  } finally {
    remove();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
