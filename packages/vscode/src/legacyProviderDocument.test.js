import { afterEach, expect, test } from 'bun:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LegacyProviderDocument } from './legacyProviderDocument';
import { LEGACY_PROVIDER_BRIDGE } from '../legacyProviderBridge';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-provider-'));
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  let blockAuthorize;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    calls.push({ path: req.url, method: req.method, headers: req.headers, body });
    if (req.url.startsWith('/provider/openai/oauth/authorize') && blockAuthorize) return blockAuthorize(req, res);
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/provider/auth')) res.end(JSON.stringify({ openai: [{ type: 'oauth', label: 'Sign in' }] }));
    else if (req.url.startsWith('/provider/openai/oauth/authorize')) res.end(JSON.stringify({ url: 'https://provider.example/auth', method: 'code', instructions: 'Enter code' }));
    else res.end('true');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const runtime = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', epoch: 1, endpoint: 'http://127.0.0.1:' + server.address().port };
  const native = { id: Symbol('native'), env: { USERPROFILE: directory }, cwd: directory };
  const listeners = new Set();
  const subscriptions = [];
  const manager = { getKernelRuntime: () => runtime, getNativeConfigContext: () => native,
    getOpenCodeAuthHeaders: () => ({ authorization: 'Bearer fixture-only' }),
    subscribeCredentialOwner: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  const a = new LegacyProviderDocument(manager, subscriptions);
  const b = new LegacyProviderDocument(manager, subscriptions);
  cleanups.push(() => { a.dispose(); b.dispose(); for (const item of subscriptions) item.dispose(); });
  let serial = 0;
  const request = (doc, route, body, id = 'request-' + ++serial) => doc.handle({ id, type: LEGACY_PROVIDER_BRIDGE.REQUEST,
    payload: { method: 'POST', path: '/api/legacy/providers' + route, body } });
  const admitted = extra => ({ identity: { ...runtime }, directory, ...extra });
  const begin = async doc => (await request(doc, '/oauth/begin', admitted({ providerID: 'openai', method: 0 }))).data.body.attemptId;
  return { a, b, calls, runtime, native, listeners, subscriptions, manager, request, admitted, begin,
    block: fn => { blockAuthorize = fn; } };
}

test('shares one owner per manager and keeps credential headers/directory in SDK requests', async () => {
  const f = await fixture();
  for (const doc of [f.a, f.b]) {
    const result = await f.request(doc, '/methods', f.admitted());
    expect(result.data.status).toBe(200);
    expect(result.data.body.openai[0].type).toBe('oauth');
  }
  expect(f.subscriptions.length).toBe(1);
  expect(f.listeners.size).toBe(1);
  expect(f.calls.length).toBe(2);
  expect(f.calls[0].headers.authorization).toBe('Bearer fixture-only');
  expect(new URL(f.calls[0].path, f.runtime.endpoint).searchParams.get('directory')).toBe(f.native.cwd);
  f.subscriptions[0].dispose();
  expect(f.listeners.size).toBe(0);
  expect((await f.request(f.a, '/methods', f.admitted())).data.status).toBe(409);
});

test('binds an OAuth attempt to one document and completes only once', async () => {
  const f = await fixture(); const attemptId = await f.begin(f.a);
  expect((await f.request(f.b, '/oauth/authorize', { attemptId })).data.status).toBe(409);
  expect(f.calls.length).toBe(0);
  expect((await f.request(f.a, '/oauth/authorize', { attemptId })).data.body.method).toBe('code');
  expect((await f.request(f.a, '/oauth/callback', { attemptId, code: 'fixture-code' })).data.body).toEqual({ persisted: true, requiresRestart: true });
  expect((await f.request(f.a, '/oauth/callback', { attemptId, code: 'again' })).data.status).toBe(409);
  expect(f.calls.length).toBe(2);
  expect(f.calls[1].body).toEqual({ method: 0, code: 'fixture-code' });
});

test('ready retires old attempts without canceling a sibling document', async () => {
  const f = await fixture(); const old = await f.begin(f.a); const sibling = await f.begin(f.b);
  f.a.reset();
  expect((await f.request(f.a, '/oauth/authorize', { attemptId: old })).data.status).toBe(409);
  expect((await f.request(f.b, '/oauth/authorize', { attemptId: sibling })).data.status).toBe(200);
  const fresh = await f.begin(f.a);
  expect((await f.request(f.a, '/oauth/authorize', { attemptId: fresh })).data.status).toBe(200);
});

test('disposal blocks new calls and retires retained OAuth attempts', async () => {
  const f = await fixture(); const attemptId = await f.begin(f.a); f.a.dispose();
  expect((await f.request(f.a, '/methods', f.admitted())).data.status).toBe(409);
  expect((await f.request(f.b, '/oauth/authorize', { attemptId })).data.status).toBe(409);
  expect(f.calls.length).toBe(0);
});

test('rejects forged callers, wrong identity and unsupported native contexts before dispatch', async () => {
  const f = await fixture();
  expect((await f.request(f.a, '/methods', f.admitted({ caller: 'forged' }))).data.status).toBe(400);
  expect((await f.request(f.a, '/methods', f.admitted({ identity: { ...f.runtime, epoch: 2 } }))).data.status).toBe(409);
  f.manager.getNativeConfigContext = () => null;
  expect((await f.request(f.a, '/methods', f.admitted())).data.status).toBeGreaterThanOrEqual(400);
  expect(f.calls.length).toBe(0);
});

test('owner retirement rejects old attempt instead of dispatching to replacement', async () => {
  const f = await fixture(); const attemptId = await f.begin(f.a);
  f.runtime.epoch++;
  for (const listener of f.listeners) listener();
  expect((await f.request(f.a, '/oauth/authorize', { attemptId })).data.status).toBe(409);
  expect(f.calls.length).toBe(0);
});

test('aborts only a request in the same document and cancels its retained attempt', async () => {
  const f = await fixture(); const attemptId = await f.begin(f.a);
  let opened; const started = new Promise(resolve => { opened = resolve; });
  f.block(() => opened());
  const pending = f.request(f.a, '/oauth/authorize', { attemptId }, 'active');
  await started;
  await f.b.handle({ id: 'abort-other', type: LEGACY_PROVIDER_BRIDGE.ABORT, payload: { requestID: 'active' } });
  await f.a.handle({ id: 'abort-own', type: LEGACY_PROVIDER_BRIDGE.ABORT, payload: { requestID: 'active' } });
  expect((await pending).data.status).toBe(409);
  expect((await f.request(f.a, '/oauth/callback', { attemptId })).data.status).toBe(409);
  expect(f.calls.length).toBe(1);
});

test('API-key save preserves SDK method/body and distinguishes persistence from application', async () => {
  const f = await fixture();
  const result = await f.request(f.a, '/save', f.admitted({ providerID: 'openai', key: 'fixture-key' }));
  expect(result.data.body).toEqual({ persisted: true, requiresRestart: true });
  expect(f.calls[0].method).toBe('PUT');
  expect(f.calls[0].body).toEqual({ type: 'api', key: 'fixture-key' });
});
