import { describe, expect, it } from 'vitest';
import { AGENT_FAMILY } from '../agent/constants.js';
import { createLegacyProviderRuntime } from './legacy-provider-runtime.js';

const RUNTIME = Object.freeze({ generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'http://legacy.test', epoch: 4 });
const CALLER = 'trusted-host-session';
function json(data) { return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }); }
function fixture(fetchImpl, options = {}) {
  const state = { runtime: { ...RUNTIME }, native: { id: Symbol('native'), env: { USERPROFILE: 'C:\\Users\\native' }, cwd: 'C:\\OpenCode\\project' },
    backend: { family: AGENT_FAMILY.OPENCODE, revision: 8 }, headers: { authorization: 'Bearer captured' }, listeners: new Set(), subscriptions: 0 };
  if (options.unready) { state.native = null; state.runtime = { generation: 'unknown', epoch: 0 }; }
  const subscribe = listener => { state.subscriptions += 1; state.listeners.add(listener); return () => state.listeners.delete(listener); };
  const api = createLegacyProviderRuntime({
    getRuntime: () => state.runtime,
    getNativeConfigContext: () => state.native,
    getBackendSelection: () => state.backend,
    getHeaders: () => state.headers,
    subscribeCredentialOwner: subscribe,
    fetchImpl,
    now: options.now,
    ttlMs: options.ttlMs,
    kernelOperations: {
      async getLegacyConfiguration() { throw new Error('not used'); },
      async compareLegacyProvider() { throw new Error('not used'); },
    },
  });
  return { api, state, notify: () => { for (const listener of [...state.listeners]) listener(); } };
}
function begin(api) { return api.beginOAuth(CALLER, { providerID: 'openai', method: 2, directory: 'C:\\project' }); }

describe('createLegacyProviderRuntime OAuth lease', () => {
  it('waits for native readiness without reconstructing the shared owner', async () => {
    const requests = [];
    const { api, state, notify } = fixture(async request => { requests.push(request); return json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }); }, { unready: true });
    await expect(begin(api)).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toHaveLength(0);
    state.native = { id: Symbol('ready'), env: { USERPROFILE: 'C:\\Users\\native' }, cwd: 'C:\\OpenCode\\project' };
    state.runtime = { ...RUNTIME };
    notify();
    const { attemptId } = await begin(api);
    await expect(api.authorizeOAuth(CALLER, attemptId)).resolves.toMatchObject({ method: 'code' });
    expect(requests).toHaveLength(1);
    expect(state.subscriptions).toBe(2);
    api.dispose();
    expect(state.listeners.size).toBe(0);
  });

  it('returns an opaque attempt before dispatch and preserves captured headers and directory', async () => {
    const requests = [];
    const queue = [json({ url: 'https://provider.test/auth', method: 'code', instructions: 'Enter code' }), json(true)];
    const { api, state } = fixture(async request => { requests.push(request); return queue.shift(); });
    const { attemptId } = await begin(api);
    expect(requests).toHaveLength(0);
    expect(attemptId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    state.headers = { authorization: 'Bearer changed' };
    await expect(api.authorizeOAuth(CALLER, attemptId)).resolves.toMatchObject({ method: 'code' });
    await expect(api.callbackOAuth(CALLER, attemptId, { code: 'ok' })).resolves.toBe(true);
    expect(requests.map(request => request.url)).toEqual([
      'http://legacy.test/provider/openai/oauth/authorize?directory=C%3A%5Cproject',
      'http://legacy.test/provider/openai/oauth/callback?directory=C%3A%5Cproject',
    ]);
    expect(requests.map(request => request.headers.get('authorization'))).toEqual(['Bearer captured', 'Bearer captured']);
    expect(state.listeners.size).toBe(1);
    api.dispose();
    expect(state.listeners.size).toBe(0);
  });

  it('rejects a different caller without dispatch or canceling the owner flow', async () => {
    const requests = [];
    const queue = [json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }), json(true)];
    const { api } = fixture(async request => { requests.push(request); return queue.shift(); });
    const { attemptId } = await begin(api);
    await expect(api.authorizeOAuth('other-caller', attemptId)).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toHaveLength(0);
    await expect(api.authorizeOAuth(CALLER, attemptId)).resolves.toHaveProperty('url');
    await expect(api.callbackOAuth(CALLER, attemptId)).resolves.toBe(true);
    api.dispose();
  });

  it('retires on native-only owner changes and preserves leases on identical notifications', async () => {
    const requests = [];
    const queue = [json({ url: 'https://provider.test/auth', method: 'code', instructions: '' })];
    const { api, state, notify } = fixture(async request => { requests.push(request); return queue.shift(); });
    const { attemptId } = await begin(api);
    notify();
    expect(state.listeners.size).toBe(2);
    await api.authorizeOAuth(CALLER, attemptId);
    state.native = { ...state.native, id: Symbol('replacement') };
    notify();
    await expect(api.callbackOAuth(CALLER, attemptId)).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toHaveLength(1);
    expect(state.listeners.size).toBe(1);
    api.dispose();
    expect(state.listeners.size).toBe(0);
  });

  it('expires leases, cancels them, and releases private and registry subscriptions', async () => {
    let time = 100;
    const requests = [];
    const { api, state } = fixture(async request => { requests.push(request); return json({ url: 'https://provider.test/auth', method: 'code', instructions: '' }); }, { now: () => time, ttlMs: 5 });
    const { attemptId } = await begin(api);
    time = 106;
    await expect(api.authorizeOAuth(CALLER, attemptId)).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toHaveLength(0);
    expect(state.listeners.size).toBe(1);
    api.dispose();
    expect(state.listeners.size).toBe(0);
  });

  it.each(['cancel', 'dispose'])('aborts an in-flight authorize on %s', async action => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let aborted = false;
    const { api, state } = fixture(request => new Promise((_resolve, reject) => {
      started();
      request.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    }));
    const { attemptId } = await begin(api);
    const pending = api.authorizeOAuth(CALLER, attemptId);
    await ready;
    if (action === 'cancel') api.cancelOAuth(CALLER, attemptId);
    else api.dispose();
    await expect(pending).rejects.toMatchObject({ statusCode: 502, credential: 'unknown', requiresRestart: true });
    expect(aborted).toBe(true);
    expect(state.listeners.size).toBe(action === 'dispose' ? 0 : 1);
    api.dispose();
    expect(state.listeners.size).toBe(0);
  });

  it('refuses repeated callback while the first request is in flight', async () => {
    let started;
    let finish;
    const ready = new Promise(resolve => { started = resolve; });
    const { api } = fixture(async request => {
      if (request.url.includes('/oauth/callback')) return new Promise(resolve => { finish = resolve; started(); });
      return json({ url: 'https://provider.test/auth', method: 'code', instructions: '' });
    });
    const { attemptId } = await begin(api);
    await api.authorizeOAuth(CALLER, attemptId);
    const pending = api.callbackOAuth(CALLER, attemptId);
    await ready;
    await expect(api.callbackOAuth(CALLER, attemptId)).rejects.toMatchObject({ statusCode: 409 });
    finish(json(true));
    await expect(pending).resolves.toBe(true);
    await expect(api.callbackOAuth(CALLER, attemptId)).rejects.toMatchObject({ statusCode: 409 });
    api.dispose();
  });




  it.each(['callback before authorize', 'malformed callback'])('releases a private flow after %s', async action => {
    const requests = [];
    const { api, state } = fixture(async request => { requests.push(request); return json(true); });
    const { attemptId } = await begin(api);
    if (action === 'callback before authorize') await expect(api.callbackOAuth(CALLER, attemptId)).rejects.toMatchObject({ statusCode: 409 });
    else await expect(api.callbackOAuth(CALLER, attemptId, { code: 4 })).rejects.toMatchObject({ statusCode: 400 });
    expect(requests).toHaveLength(0);
    expect(state.listeners.size).toBe(1);
    await expect(api.authorizeOAuth(CALLER, attemptId)).rejects.toMatchObject({ statusCode: 409 });
    api.dispose();
  });

  it('retires a lease immediately when its request signal aborts and skips pre-aborted begins', async () => {
    const requests = [];
    const { api, state } = fixture(async request => { requests.push(request); return json(true); });
    const aborted = new AbortController();
    aborted.abort();
    await expect(api.beginOAuth(CALLER, { providerID: 'openai', method: 2, directory: 'C:\\project', signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.listeners.size).toBe(1);
    const controller = new AbortController();
    const { attemptId } = await api.beginOAuth(CALLER, { providerID: 'openai', method: 2, directory: 'C:\\project', signal: controller.signal });
    controller.abort();
    expect(state.listeners.size).toBe(1);
    await expect(api.authorizeOAuth(CALLER, attemptId)).rejects.toMatchObject({ statusCode: 409 });
    await expect(api.callbackOAuth(CALLER, attemptId)).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toHaveLength(0);
    api.dispose();
  });

  it('rejects every public operation after dispose before dispatch', async () => {
    const requests = [];
    const { api } = fixture(async request => { requests.push(request); return json([]); });
    api.dispose();
    await expect(api.sources('openai', 'C:\\project')).rejects.toMatchObject({ statusCode: 409 });
    await expect(api.disconnect('openai', 'C:\\project')).rejects.toMatchObject({ statusCode: 409 });
    await expect(api.methods({ providerID: 'openai' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(api.save({ providerID: 'openai', method: 2, directory: 'C:\\project' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(api.beginOAuth(CALLER, { providerID: 'openai', method: 2, directory: 'C:\\project' })).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toHaveLength(0);
  });

});
