import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_FAMILY } from '../agent/constants.js';
import { createLegacyCredentialOperations } from './legacy-credential-operations.js';

const RUNTIME = Object.freeze({ generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'http://legacy.test', epoch: 4 });
const IDENTITY = Object.freeze({ ...RUNTIME });
const credentialCatalog = { openai: [{ type: 'api', label: 'API key', prompts: [{ type: 'text', key: 'key', message: 'API key' }] }] };
let releases = [];
afterEach(() => { for (const release of releases.splice(0)) release(); });

function fixture(fetchImpl = globalThis.fetch, overrides = {}) {
  const state = { runtime: { ...RUNTIME }, native: { id: Symbol('native'), env: {}, cwd: 'C:\\OpenCode\\project' }, backend: { family: AGENT_FAMILY.OPENCODE, revision: 8 }, listeners: new Set() };
  const owner = createLegacyCredentialOperations({
    getRuntime: () => state.runtime,
    getNativeConfigContext: () => state.native,
    getBackendSelection: () => state.backend,
    getHeaders: () => ({ authorization: 'Bearer test', 'x-test': 'yes' }),
    subscribe: listener => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
    fetchImpl, ...overrides,
  });
  return { owner, state };
}
function json(data) { return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }); }
function requestRecorder(data, received = []) {
  return async (request) => { received.push(request); return json(data); };
}

describe('createLegacyCredentialOperations', () => {
  it('uses the official SDK for the provider auth catalog and preserves auth and directory headers', async () => {
    const received = [];
    const { owner } = fixture(requestRecorder(credentialCatalog, received));
    await expect(owner.methods({ directory: 'C:\\work' })).resolves.toEqual(credentialCatalog);
    expect(received[0].url).toBe('http://legacy.test/provider/auth?directory=C%3A%5Cwork');
    expect(received[0].headers.get('authorization')).toBe('Bearer test');
    expect(received[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('saves API credentials through auth.set and returns no credential data', async () => {
    const received = [];
    const { owner } = fixture(requestRecorder(true, received));
    await expect(owner.save({ providerID: 'openai', key: 'secret', expectedIdentity: IDENTITY })).resolves.toBe(true);
    expect(received[0].method).toBe('PUT');
    expect(received[0].url).toBe('http://legacy.test/auth/openai');
    expect(await received[0].json()).toEqual({ type: 'api', key: 'secret' });
    expect(received[0].headers.get('authorization')).toBe('Bearer test');
  });

  it('binds OAuth to one SDK client, header set, directory, provider, and method', async () => {
    const received = [];
    const queue = [json({ url: 'https://provider.test/auth', method: 'code', instructions: 'Enter code' }), json(true)];
    const state = { headers: { authorization: 'Bearer captured' } };
    const { owner } = fixture(async request => { received.push(request); return queue.shift(); }, { getHeaders: () => state.headers });
    const flow = await owner.beginOAuth({ providerID: 'openai', method: 2, directory: 'C:\\work' });
    state.headers = { authorization: 'Bearer changed' };
    await expect(flow.authorize()).resolves.toEqual({ url: 'https://provider.test/auth', method: 'code', instructions: 'Enter code' });
    await expect(flow.callback({ code: 'code-value' })).resolves.toBe(true);
    expect(await received[0].json()).toEqual({ method: 2 });
    expect(await received[1].json()).toEqual({ method: 2, code: 'code-value' });
    expect(received.map(request => request.url)).toEqual([
      'http://legacy.test/provider/openai/oauth/authorize?directory=C%3A%5Cwork',
      'http://legacy.test/provider/openai/oauth/callback?directory=C%3A%5Cwork',
    ]);
    expect(received.map(request => request.headers.get('authorization'))).toEqual(['Bearer captured', 'Bearer captured']);
  });

  it('rejects callback after owner retirement without dispatch and releases the flow', async () => {
    let requests = 0;
    const { owner, state } = fixture(async request => { requests += 1; return json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }); });
    const flow = await owner.beginOAuth({ providerID: 'openai', method: 1 });
    await flow.authorize();
    expect(state.listeners.size).toBe(1);
    state.runtime = { ...state.runtime, epoch: 5 };
    for (const listener of [...state.listeners]) listener();
    await expect(flow.callback()).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toBe(1);
    expect(state.listeners.size).toBe(0);
  });

  it.each([
    ['profile', state => { state.runtime = { ...state.runtime, profile: 'other' }; }],
    ['version', state => { state.runtime = { ...state.runtime, version: '1.2.28' }; }],
    ['native process', state => { state.native = { ...state.native, id: Symbol('replacement') }; }],
  ])('retires OAuth after %s changes between authorization and callback', async (_label, change) => {
    let requests = 0;
    const { owner, state } = fixture(async () => { requests += 1; return json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }); });
    const flow = await owner.beginOAuth({ providerID: 'openai', method: 1 });
    await flow.authorize();
    change(state);
    for (const listener of [...state.listeners]) listener();
    await expect(flow.callback()).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toBe(1);
    expect(state.listeners.size).toBe(0);
  });

  it('retires the whole flow when its external signal aborts', async () => {
    const received = [];
    const controller = new AbortController();
    const { owner, state } = fixture(async request => {
      received.push(request);
      return json({ url: 'https://provider.test/auth', method: 'code', instructions: '' });
    });
    const flow = await owner.beginOAuth({ providerID: 'openai', method: 1, signal: controller.signal });
    await flow.authorize();
    controller.abort();
    await expect(flow.callback()).rejects.toHaveProperty('name', 'AbortError');
    expect(received).toHaveLength(1);
    expect(state.listeners.size).toBe(0);
  });
  it('cancels an in-flight callback and reports its credential outcome as unknown', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let callbackSignal;
    const { owner, state } = fixture(request => {
      if (request.url.includes('/authorize')) return Promise.resolve(json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }));
      callbackSignal = request.signal;
      started();
      return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    });
    const flow = await owner.beginOAuth({ providerID: 'openai', method: 1 });
    await flow.authorize();
    const pending = flow.callback({ code: 'abc' });
    await ready;
    flow.cancel();
    await expect(pending).rejects.toMatchObject({ statusCode: 502, credential: 'unknown', requiresRestart: true, message: 'OpenCode credential operation failed' });
    expect(callbackSignal.aborted).toBe(true);
    expect(state.listeners.size).toBe(0);
  });

  it('sanitizes failed callbacks while preserving the unknown mutation outcome', async () => {
    let calls = 0;
    const { owner, state } = fixture(async request => {
      calls += 1;
      return calls === 1 ? json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }) : Promise.reject(new Error('secret response body'));
    });
    const flow = await owner.beginOAuth({ providerID: 'openai', method: 1 });
    await flow.authorize();
    await expect(flow.callback()).rejects.toMatchObject({ statusCode: 502, credential: 'unknown', requiresRestart: true, message: 'OpenCode credential operation failed' });
    expect(state.listeners.size).toBe(0);
  });

  it('allows one authorize and one callback, rejecting repeated or parallel calls', async () => {
    let settle;
    const { owner, state } = fixture(request => {
      if (request.url.includes('/authorize')) return Promise.resolve(json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }));
      return new Promise(resolve => { settle = () => resolve(json(true)); });
    });
    const flow = await owner.beginOAuth({ providerID: 'openai', method: 1 });
    await flow.authorize();
    await expect(flow.authorize()).rejects.toMatchObject({ statusCode: 409 });
    const first = flow.callback();
    await expect(flow.callback()).rejects.toMatchObject({ statusCode: 409 });
    settle();
    await expect(first).resolves.toBe(true);
    await expect(flow.callback()).rejects.toMatchObject({ statusCode: 409 });
    expect(state.listeners.size).toBe(0);
  });

  it.each([
    ['missing native process', state => { state.native = null; }],
    ['changed version', state => { state.runtime = { ...state.runtime, version: '1.2.28' }; }],
    ['external backend', state => { state.backend = { family: 'cagent', revision: 8 }; }],
  ])('refuses %s before network access', async (_label, change) => {
    let requests = 0;
    const { owner, state } = fixture(async () => { requests += 1; return json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }); });
    change(state);
    await expect(owner.methods()).rejects.toMatchObject({ statusCode: 501 });
    expect(requests).toBe(0);
  });

  it('rejects unknown request properties and stale required identity before dispatch', async () => {
    let requests = 0;
    const { owner } = fixture(async () => { requests += 1; return json(true); });
    await expect(owner.methods({ inputs: {} })).rejects.toMatchObject({ statusCode: 400 });
    await expect(owner.remove({ providerID: 'openai', expectedIdentity: { ...IDENTITY, version: '1.2.28' } })).rejects.toMatchObject({ statusCode: 409 });
    await expect(owner.remove({ providerID: 'openai', expectedIdentity: { ...IDENTITY, epoch: 3 } })).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toBe(0);
  });

  it('sanitizes failed mutations and reports unknown state only after dispatch', async () => {
    const { owner } = fixture(async () => { throw new Error('secret response body'); });
    await expect(owner.save({ providerID: 'openai', key: 'secret' })).rejects.toMatchObject({ statusCode: 502, credential: 'unknown', requiresRestart: true, message: 'OpenCode credential operation failed' });
    await expect(owner.save({ providerID: 'openai', key: 'secret' })).rejects.not.toHaveProperty('cause');
  });

  it('aborts a stalled operation and retires its subscription after completion', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const fetchImpl = request => new Promise((_resolve, reject) => {
      started();
      request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    const { owner, state } = fixture(fetchImpl);
    const controller = new AbortController();
    const pending = owner.methods({ signal: controller.signal });
    await ready;
    expect(state.listeners.size).toBe(1);
    state.runtime = { ...state.runtime, epoch: 5 };
    for (const listener of [...state.listeners]) listener();
    await expect(pending).rejects.toMatchObject({ statusCode: 409, message: 'OpenCode credential owner changed' });
    expect(state.listeners.size).toBe(0);
  });

  it('removes credentials through auth.remove with the required matching identity', async () => {
    const received = [];
    const { owner } = fixture(requestRecorder(true, received));
    await expect(owner.remove({ providerID: 'openai', expectedIdentity: IDENTITY })).resolves.toBe(true);
    expect(received[0].method).toBe('DELETE');
    expect(received[0].url).toBe('http://legacy.test/auth/openai');
  });

  it('aborts a pending catalog read when only the native process identity retires', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const fetchImpl = request => new Promise((_resolve, reject) => {
      started();
      request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    const { owner, state } = fixture(fetchImpl);
    const pending = owner.methods();
    await ready;
    state.native = { ...state.native, id: Symbol('replacement') };
    for (const listener of [...state.listeners]) listener();
    await expect(pending).rejects.toMatchObject({ statusCode: 409, message: 'OpenCode credential owner changed' });
    expect(state.listeners.size).toBe(0);
  });
  it('rejects malformed catalog data without returning an empty success', async () => {
    const { owner } = fixture(requestRecorder({ openai: [{ type: 'oauth' }] }));
    await expect(owner.methods()).rejects.toMatchObject({ statusCode: 502 });
  });
});








describe('credential cancellation and setup boundaries', () => {
  it('releases subscriptions when transport headers fail before SDK dispatch', async () => {
    let requests = 0;
    const { owner, state } = fixture(async () => { requests += 1; return json(true); },
      { getHeaders: () => { throw new Error('private header failure'); } });
    await expect(owner.save({ providerID: 'openai', key: 'secret' })).rejects.toMatchObject({ statusCode: 502 });
    expect(requests).toBe(0);
    expect(state.listeners.size).toBe(0);
  });
  it('does not dispatch a pre-canceled write or a mismatched save identity', async () => {
    let requests = 0;
    const { owner, state } = fixture(async () => { requests += 1; return json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }); });
    const controller = new AbortController();
    controller.abort();
    await expect(owner.save({ providerID: 'openai', key: 'secret', signal: controller.signal })).rejects.toHaveProperty('name', 'AbortError');
    await expect(owner.save({ providerID: 'openai', key: 'secret', expectedIdentity: { ...IDENTITY, epoch: 19 } })).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toBe(0);
    expect(state.listeners.size).toBe(0);
  });
  it.each(['read', 'write'])('distinguishes caller cancellation from retirement: %s', async kind => {
    let start;
    const ready = new Promise(resolve => { start = resolve; });
    const { owner, state } = fixture(request => new Promise((_resolve, reject) => {
      start();
      request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const controller = new AbortController();
    const pending = kind === 'read' ? owner.methods({ signal: controller.signal })
      : owner.save({ providerID: 'openai', key: 'secret', signal: controller.signal });
    await ready;
    controller.abort();
    if (kind === 'read') await expect(pending).rejects.toHaveProperty('name', 'AbortError');
    else await expect(pending).rejects.toMatchObject({ statusCode: 502, credential: 'unknown', requiresRestart: true });
    expect(state.listeners.size).toBe(0);
  });
  it.each(['success', 'failure'])('keeps a dispatched retired mutation unknown: %s', async outcome => {
    let settle, start;
    const ready = new Promise(resolve => { start = resolve; });
    const { owner, state } = fixture(() => new Promise((resolve, reject) => {
      start(); settle = () => outcome === 'success' ? resolve(json(true)) : reject(new Error('secret upstream body'));
    }));
    const pending = owner.remove({ providerID: 'openai', expectedIdentity: IDENTITY });
    await ready;
    state.runtime = { ...state.runtime, epoch: 20 };
    settle();
    await expect(pending).rejects.toMatchObject({ statusCode: 409, credential: 'unknown', requiresRestart: true });
    expect(state.listeners.size).toBe(0);
  });
});

describe('OAuth setup boundaries', () => {
  it('releases a pre-canceled flow before headers or dispatch', async () => {
    let requests = 0, headers = 0;
    const { owner, state } = fixture(async () => { requests += 1; return json(true); },
      { getHeaders: () => { headers += 1; return {}; } });
    const controller = new AbortController();
    controller.abort();
    await expect(owner.beginOAuth({ providerID: 'openai', method: 0, signal: controller.signal })).rejects.toHaveProperty('name', 'AbortError');
    expect(requests).toBe(0);
    expect(headers).toBe(0);
    expect(state.listeners.size).toBe(0);
  });
  it('releases a flow when its bound client cannot capture headers', async () => {
    let requests = 0;
    const { owner, state } = fixture(async () => { requests += 1; return json(true); },
      { getHeaders: () => { throw new Error('private setup detail'); } });
    await expect(owner.beginOAuth({ providerID: 'openai', method: 0 })).rejects.toMatchObject({ statusCode: 502, message: 'OpenCode credential operation failed' });
    expect(requests).toBe(0);
    expect(state.listeners.size).toBe(0);
  });
  it('rejects late authorization success after cancellation without enabling callback', async () => {
    let settle, start, requests = 0;
    const ready = new Promise(resolve => { start = resolve; });
    const { owner, state } = fixture(() => new Promise(resolve => {
      requests += 1;
      start();
      settle = () => resolve(json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }));
    }));
    const flow = await owner.beginOAuth({ providerID: 'openai', method: 0 });
    const pending = flow.authorize();
    await ready;
    flow.cancel();
    settle();
    await expect(pending).rejects.toMatchObject({ credential: 'unknown', requiresRestart: true });
    await expect(flow.callback()).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toBe(1);
    expect(state.listeners.size).toBe(0);
  });
});
