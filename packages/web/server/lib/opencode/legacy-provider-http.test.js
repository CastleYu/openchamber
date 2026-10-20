import { afterEach, describe, expect, test } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createLegacyProviderHttp } from './legacy-provider-http.js';
import { createLegacyProviderRuntime } from './legacy-provider-runtime.js';

const IDENTITY = Object.freeze({ generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'http://127.0.0.1:4096', epoch: 7 });
const BASE = '/api/legacy/providers';
const servers = new Set();

async function fixture(options = {}) {
  const calls = [];
  const app = express();
  app.use(express.json());
  const api = {
    methods: async request => { calls.push(['methods', request]); return { methods: [] }; },
    sources: async (...args) => { calls.push(['sources', ...args]); return { sources: {} }; },
    save: async request => { calls.push(['save', request]); return { providerID: request.providerID }; },
    disconnect: async (...args) => { calls.push(['disconnect', ...args]); return { removed: ['user'] }; },
    beginOAuth: async (...args) => { calls.push(['begin', ...args]); return { attemptId: 'attempt-1' }; },
    authorizeOAuth: async (...args) => { calls.push(['authorize', ...args]); return { url: 'https://provider.example/auth' }; },
    callbackOAuth: async (...args) => { calls.push(['callback', ...args]); return { providerID: 'p' }; },
    cancelOAuth: async (...args) => { calls.push(['cancel', ...args]); },
    ...options.api,
  };
  createLegacyProviderHttp({ api, getRuntime: () => options.runtime ?? IDENTITY, resolveCaller: options.resolveCaller ?? (async () => 'trusted-host-session') }).register(app);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.add(server);
  const address = server.address();
  return { calls, server, url: `http://127.0.0.1:${address.port}${BASE}` };
}

async function post(url, path, body = {}) {
  return fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

afterEach(async () => {
  await Promise.all([...servers].map(server => new Promise(resolve => server.close(resolve))));
  servers.clear();
});

describe('legacy provider HTTP adapter', () => {
  test('authenticates before any API effect and marks responses no-store', async () => {
    const app = await fixture({ resolveCaller: async () => null });
    const response = await post(app.url, '/methods', { identity: IDENTITY });
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(app.calls).toEqual([]);
  });

  test('rejects extra body fields and stale runtime identity before invoking owners', async () => {
    const app = await fixture();
    expect((await post(app.url, '/sources', { identity: IDENTITY, providerID: 'p', caller: 'spoof' })).status).toBe(400);
    expect((await post(app.url, '/methods', { identity: { ...IDENTITY, endpoint: 'http://old' } })).status).toBe(409);
    expect(app.calls).toEqual([]);
  });

  test('passes only parsed operation data and a live request signal', async () => {
    const app = await fixture();
    const response = await post(app.url, '/save', { identity: IDENTITY, providerID: 'p', key: 'secret', directory: 'D:/work' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ persisted: true, requiresRestart: true });
    const [, request] = app.calls[0];
    expect(request).toMatchObject({ providerID: 'p', key: 'secret', directory: 'D:/work', expectedIdentity: IDENTITY });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.signal.aborted).toBe(false);
  });

  test('binds OAuth attempt ownership to the trusted caller and preserves the attempt flow', async () => {
    const app = await fixture();
    const begin = await post(app.url, '/oauth/begin', { identity: IDENTITY, providerID: 'p', method: 0, caller: 'attacker' });
    expect(begin.status).toBe(400);
    const started = await post(app.url, '/oauth/begin', { identity: IDENTITY, providerID: 'p', method: 0 });
    expect(await started.json()).toEqual({ attemptId: 'attempt-1' });
    expect((await post(app.url, '/oauth/authorize', { attemptId: 'attempt-1', caller: 'attacker' })).status).toBe(400);
    expect(await (await post(app.url, '/oauth/authorize', { attemptId: 'attempt-1' })).json()).toEqual({ url: 'https://provider.example/auth' });
    expect(app.calls.filter(call => call[0] === 'begin')).toHaveLength(1);
    expect(app.calls.find(call => call[0] === 'begin')[2].signal.aborted).toBe(false);
    expect(app.calls.at(-1)).toEqual(['authorize', 'trusted-host-session', 'attempt-1']);
  });

  test('exposes known partial outcome and treats disconnected writes as indeterminate to the client', async () => {
    const app = await fixture({ api: { disconnect: async () => { throw Object.assign(new Error('contains private provider detail'), { statusCode: 502, outcome: { persisted: false, partial: true, removed: ['user'], remaining: ['project'], credential: 'unknown', requiresRestart: true } }); } } });
    const response = await post(app.url, '/disconnect', { identity: IDENTITY, providerID: 'p' });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Provider request failed', outcome: { persisted: false, partial: true, removed: ['user'], remaining: ['project'], credential: 'unknown', requiresRestart: true } });
  });

  test('does not claim a disconnect result when the response is lost after the owner commits', async () => {
    let entered;
    let finish;
    let signal;
    let committed = false;
    const started = new Promise(resolve => { entered = resolve; });
    const pending = new Promise(resolve => { finish = resolve; });
    const app = await fixture({ api: { disconnect: async (_provider, _directory, requestSignal) => {
      signal = requestSignal;
      entered();
      await pending;
      committed = true;
      return { removed: ['user'] };
    } } });
    const address = app.server.address();
    const request = http.request({ host: '127.0.0.1', port: address.port, path: `${BASE}/disconnect`, method: 'POST', headers: { 'content-type': 'application/json' } });
    const lost = new Promise(resolve => request.once('error', resolve));
    request.end(JSON.stringify({ identity: IDENTITY, providerID: 'p' }));
    await started;
    request.destroy();
    await lost;
    finish();
    await new Promise(resolve => setImmediate(resolve));
    expect(signal.aborted).toBe(true);
    expect(committed).toBe(true);
  });

  test('aborts an in-flight begin when the client disconnects before the response', async () => {
    let observedAbort;
    let started;
    const began = new Promise(resolve => { started = resolve; });
    const app = await fixture({ api: { beginOAuth: (_caller, request) => new Promise((resolve, reject) => {
      observedAbort = request.signal;
      started();
      request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) } });
    const address = app.server.address();
    const request = http.request({ host: '127.0.0.1', port: address.port, path: `${BASE}/oauth/begin`, method: 'POST', headers: { 'content-type': 'application/json' } });
    request.on('error', () => {});
    request.end(JSON.stringify({ identity: IDENTITY, providerID: 'p', method: 0 }));
    await began;
    request.destroy();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(observedAbort).toBeInstanceOf(AbortSignal);
    expect(observedAbort.aborted).toBe(true);
  });
  test('accepts host status metadata without accepting extra client identity fields', async () => {
    const app = await fixture({ runtime: { ...IDENTITY, status: 'ready' } });
    expect((await post(app.url, '/methods', { identity: IDENTITY })).status).toBe(200);
    expect((await post(app.url, '/methods', { identity: { ...IDENTITY, status: 'ready' } })).status).toBe(400);
    expect(app.calls).toHaveLength(1);
  });

  test('does not dispatch after a client disconnects while authentication is pending', async () => {
    let enter;
    let release;
    const started = new Promise(resolve => { enter = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const app = await fixture({ resolveCaller: async () => { enter(); await pending; return 'trusted'; } });
    const address = app.server.address();
    const req = http.request({ host: '127.0.0.1', port: address.port, path: BASE + '/save', method: 'POST', headers: { 'content-type': 'application/json' } });
    req.on('error', () => {});
    req.end(JSON.stringify({ identity: IDENTITY, providerID: 'p', key: 'synthetic' }));
    await started;
    req.destroy();
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(app.calls).toEqual([]);
  });

  test.each(['/oauth/authorize', '/oauth/callback'])('cancels the caller-bound attempt when %s loses its response', async route => {
    let enter;
    let finish;
    let canceled;
    const started = new Promise(resolve => { enter = resolve; });
    const pending = new Promise(resolve => { finish = resolve; });
    const stopped = new Promise(resolve => { canceled = resolve; });
    const run = async () => { enter(); await pending; return {}; };
    const app = await fixture({ api: {
      authorizeOAuth: run, callbackOAuth: run,
      cancelOAuth: async (...args) => { app.calls.push(['cancel', ...args]); canceled(); finish(); },
    } });
    const address = app.server.address();
    const req = http.request({ host: '127.0.0.1', port: address.port, path: BASE + route, method: 'POST', headers: { 'content-type': 'application/json' } });
    req.on('error', () => {});
    req.end(JSON.stringify({ attemptId: 'attempt-1' }));
    await started;
    req.destroy();
    await stopped;
    expect(app.calls).toEqual([['cancel', 'trusted-host-session', 'attempt-1']]);
  });

  test('propagates HTTP cancellation through the retained owner to the original SDK request', async () => {
    const owner = { id: Symbol('native'), env: { USERPROFILE: 'C:/native' }, cwd: 'C:/project' };
    const listeners = new Set();
    let entered;
    let aborted;
    const started = new Promise(resolve => { entered = resolve; });
    const stopped = new Promise(resolve => { aborted = resolve; });
    const api = createLegacyProviderRuntime({
      getRuntime: () => IDENTITY, getNativeConfigContext: () => owner,
      getBackendSelection: () => ({ family: 'opencode', revision: 1 }),
      getHeaders: () => ({ authorization: 'Bearer synthetic' }),
      subscribeCredentialOwner: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      kernelOperations: {},
      fetchImpl: req => new Promise((resolve, reject) => {
        entered();
        req.signal.addEventListener('abort', () => { aborted(); reject(new Error('canceled')); }, { once: true });
      }),
    });
    try {
      const app = await fixture({ api });
      const begin = await post(app.url, '/oauth/begin', { identity: IDENTITY, providerID: 'p', method: 0, directory: 'C:/project' });
      const { attemptId } = await begin.json();
      const address = app.server.address();
      const req = http.request({ host: '127.0.0.1', port: address.port, path: BASE + '/oauth/authorize', method: 'POST', headers: { 'content-type': 'application/json' } });
      req.on('error', () => {});
      req.end(JSON.stringify({ attemptId }));
      await started;
      req.destroy();
      await stopped;
      expect((await post(app.url, '/oauth/callback', { attemptId })).status).toBe(409);
      expect(listeners.size).toBe(1);
    } finally { api.dispose(); }
    expect(listeners.size).toBe(0);
  });

});
