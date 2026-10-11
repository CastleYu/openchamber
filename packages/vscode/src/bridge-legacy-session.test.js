import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { createLegacyMetadataStore } from '../../web/server/lib/openchamber-sessions/legacy-metadata-store.js';
import { OPENCODE_PROFILE } from '../../web/server/lib/opencode/compatibility.js';
import { createKernelOperations } from '../../web/server/lib/opencode/kernel-operations.js';
import { createLegacySessionApi } from '../../web/server/lib/opencode/legacy-session-api.js';
import { handleProxyBridgeMessage } from './bridge-proxy-runtime';
import { openSseProxy } from './sseProxy';

const VERSION = '1.2.27';
const DIRECTORY = 'C:/work';
const SESSION_ID = 'ses_bridge';
const AUTH = 'Bearer exact-legacy-token';
const SESSION = { id: SESSION_ID, slug: 'bridge', projectID: 'prj_bridge', directory: DIRECTORY,
  version: VERSION, title: 'before', time: { created: 1, updated: 2 } };
const servers = [];
const directories = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).reverse().map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const listen = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server;
};
const baseUrl = (server) => `http://127.0.0.1:${server.address().port}`;
const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
};
const bridgeDeps = (legacySessions) => ({
  tryHandleLocalFsProxy: async () => null,
  legacySessions,
  buildUnavailableApiResponse: () => ({ status: 503, headers: {}, bodyText: '' }),
  sanitizeForwardHeaders: (headers) => headers || {},
  collectHeaders: (headers) => Object.fromEntries(headers),
  base64EncodeUtf8: (text) => Buffer.from(text, 'utf8').toString('base64'),
});

const createHarness = async ({ onUpstream = () => {}, beforeQueueReply } = {}) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-legacy-bridge-'));
  directories.push(dataDir);
  let session = { ...SESSION, time: { ...SESSION.time } };
  let runtime;
  const upstream = await listen(async (request, response) => {
    const body = await readJson(request);
    const url = new URL(request.url, 'http://upstream');
    onUpstream({ method: request.method, path: url.pathname, search: url.search, directory: url.searchParams.get('directory'), body,
      authorization: request.headers.authorization });
    if (url.pathname === '/session' && request.method === 'POST') {
      session = { ...session, ...body, id: SESSION_ID, directory: DIRECTORY };
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify(session));
    }
    if (url.pathname === `/session/${SESSION_ID}` && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify(session));
    }
    if (url.pathname === `/session/${SESSION_ID}` && request.method === 'PATCH') {
      session = { ...session, ...body, time: { ...session.time, ...(body.time || {}), updated: 3 } };
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify(session));
    }
    if (['/session', '/experimental/session'].includes(url.pathname) && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify([session]));
    }
    if (url.pathname.endsWith('/prompt_async') && request.method === 'POST') {
      if (request.headers['x-test-hold']) await new Promise((resolve) => response.once('close', resolve));
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ accepted: true, body }));
    }
    if ((url.pathname === '/event' || url.pathname === '/global/event') && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.write('id: evt-1\ndata: {"type":"server.connected"}\n\n');
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'unexpected upstream request' }));
  });
  runtime = { generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY, version: VERSION, endpoint: baseUrl(upstream), epoch: 1 };
  const storageScope = { value: 'managed' };
  const metadataStore = createLegacyMetadataStore({ dataDir });
  const getRuntime = () => runtime;
  const getStorageScope = () => storageScope.value;
  const operations = createKernelOperations({ getRuntime, getHeaders: () => ({ authorization: AUTH }),
    legacyMetadataStore: metadataStore, getStorageScope });
  const legacySessions = createLegacySessionApi({ getRuntime, operations, metadataStore, getStorageScope });
  const manager = {
    getStatus: () => 'connected', getApiUrl: () => runtime.endpoint,
    onStatusChange: (callback) => { callback('connected'); return { dispose() {} }; },
    getKernelRuntime: getRuntime, refreshKernelRuntime: async () => runtime,
    getOpenCodeAuthHeaders: () => ({ authorization: AUTH }), getWorkingDirectory: () => DIRECTORY,
    connectionRequest: async () => {
      if (beforeQueueReply) return beforeQueueReply(runtime);
      return { status: 200, body: { target: 'a'.repeat(64) } };
    },
  };
  const deps = bridgeDeps(legacySessions);
  const bridge = await listen(async (request, response) => {
    try {
      const message = await readJson(request);
      const result = await handleProxyBridgeMessage(message, { manager }, deps);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'bridge', type: 'api:proxy', success: false,
        error: error instanceof Error ? error.message : String(error) }));
    }
  });
  const send = async (id, method, requestPath, body, headers = {}) => {
    const payload = { method, path: requestPath, headers };
    if (body !== undefined) payload.bodyBase64 = Buffer.from(body, 'utf8').toString('base64');
    const response = await fetch(`${baseUrl(bridge)}/message`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, type: 'api:proxy', payload }) });
    return response.json();
  };
  return { bridge, upstream, send, get runtime() { return runtime; }, set runtime(value) { runtime = value; },
    metadataStore, storageScope };
};

const resultData = (result) => result.data;
const responseBody = (result) => JSON.parse(resultData(result).bodyText);

describe('VS Code exact Legacy 1.2.27 loopback bridge', () => {
  it('creates through kernel operations and overlays persisted metadata on list, detail, and experimental reads', async () => {
    const calls = [];
    const harness = await createHarness({ onUpstream: (call) => calls.push(call) });
    const metadata = { openchamber: { goal: 'g' } };
    const permission = [{ permission: 'read', pattern: '**', action: 'allow' }];
    const create = await harness.send('create', 'POST', `/api/session?directory=${encodeURIComponent(DIRECTORY)}`,
      JSON.stringify({ title: 'created', parentID: 'ses_parent', permission, workspaceID: 'wrk_1', metadata }));
    expect(resultData(create).status).toBe(200);
    expect(responseBody(create)).toMatchObject({ id: SESSION_ID, title: 'created', metadata });
    expect(calls).toEqual([{ method: 'POST', path: '/session', search: `?directory=${encodeURIComponent(DIRECTORY)}`,
      directory: DIRECTORY, body: { title: 'created', parentID: 'ses_parent', permission, workspaceID: 'wrk_1' }, authorization: AUTH }]);
    expect(await harness.metadataStore.read('managed', SESSION_ID)).toEqual(metadata);
    expect(await harness.metadataStore.read('external:http://other.invalid', SESSION_ID)).toEqual({});

    for (const route of ['/api/session?directory=C%3A%2Fwork', `/api/session/${SESSION_ID}?directory=C%3A%2Fwork`,
      '/api/experimental/session?directory=C%3A%2Fwork']) {
      const read = await harness.send(`read-${route}`, 'GET', route);
      expect(resultData(read).status).toBe(200);
      const body = responseBody(read);
      expect(Array.isArray(body) ? body[0] : body).toMatchObject({ id: SESSION_ID, metadata });
    }
  });

  it('keeps title on the upstream PATCH and merges metadata in the scoped local store', async () => {
    const calls = [];
    const harness = await createHarness({ onUpstream: (call) => calls.push(call) });
    await harness.metadataStore.patch('managed', SESSION_ID, { openchamber: { keep: true, remove: true } }, { replace: true });
    const updated = await harness.send('patch', 'PATCH', `/api/session/${SESSION_ID}?directory=C%3A%2Fwork`,
      JSON.stringify({ title: 'renamed', time: { archived: 9 }, metadata: { openchamber: { remove: null, added: 2 } } }));
    expect(resultData(updated).status).toBe(200);
    expect(responseBody(updated)).toMatchObject({ title: 'renamed', time: { archived: 9 },
      metadata: { openchamber: { keep: true, added: 2 } } });
    expect(calls.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'GET', path: `/session/${SESSION_ID}`, body: null },
      { method: 'PATCH', path: `/session/${SESSION_ID}`, body: { title: 'renamed', time: { archived: 9 } } },
    ]);
  });

  it('rejects malformed and null JSON bodies plus duplicate query values before upstream effects', async () => {
    const calls = [];
    const harness = await createHarness({ onUpstream: (call) => calls.push(call) });
    const route = `/api/session?directory=${encodeURIComponent(DIRECTORY)}`;
    for (const [id, body] of [['malformed', '{'], ['null-body', 'null']]) {
      const rejected = await harness.send(id, 'POST', route, body);
      expect(resultData(rejected).status).toBe(400);
    }
    const duplicate = await harness.send('duplicate-query', 'POST', `${route}&directory=${encodeURIComponent(DIRECTORY)}`,
      JSON.stringify({ title: 'must not write' }));
    expect(resultData(duplicate).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('refuses a Legacy advanced route before it reaches upstream', async () => {
    const calls = [];
    const harness = await createHarness({ onUpstream: (call) => calls.push(call) });
    const result = await harness.send('advanced', 'POST', `/api/session/${SESSION_ID}/fork`, '{}');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported');
    expect(calls).toHaveLength(0);
  });

  it('stops a queued write when the owner changes during confirmation', async () => {
    const calls = [];
    let harness;
    harness = await createHarness({ onUpstream: (call) => calls.push(call),
      beforeQueueReply: async () => {
        harness.runtime = { ...harness.runtime, epoch: harness.runtime.epoch + 1 };
        return { status: 200, body: { target: 'a'.repeat(64) } };
      } });
    const result = await harness.send('queued-create', 'POST', '/api/session?directory=C%3A%2Fwork',
      JSON.stringify({ title: 'stale owner' }), { 'x-openchamber-queue-target': 'a'.repeat(64) });
    expect(result.success).toBe(false);
    expect(result.error).toContain('connection changed');
    expect(calls).toHaveLength(0);
  });

  it('preserves prompt_async auth, directory, and JSON body, and cancels the pending bridge response', async () => {
    const calls = [];
    let started;
    const requestStarted = new Promise((resolve) => { started = resolve; });
    const harness = await createHarness({ onUpstream: (call) => {
      calls.push(call);
      if (calls.filter((item) => item.path.endsWith('/prompt_async')).length === 2) started();
    } });
    const bridgeRequest = (id, payload) => fetch(`${baseUrl(harness.bridge)}/message`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, type: 'api:proxy', payload }) });
    const body = JSON.stringify({ parts: [{ type: 'text', text: 'hello' }], model: { providerID: 'p', modelID: 'm' } });
    const first = await bridgeRequest('prompt', { method: 'POST',
      path: `/api/session/${SESSION_ID}/prompt_async?directory=${encodeURIComponent(DIRECTORY)}`,
      headers: { 'content-type': 'application/json', 'x-opencode-directory': DIRECTORY },
      bodyBase64: Buffer.from(body).toString('base64') });
    expect(first.status).toBe(200);
    const captured = calls.find((call) => call.path.endsWith('/prompt_async'));
    expect(captured).toMatchObject({ method: 'POST', directory: DIRECTORY, body: JSON.parse(body), authorization: AUTH });

    const pending = bridgeRequest('abort-prompt', { method: 'POST', path: `/api/session/${SESSION_ID}/prompt_async`,
      headers: { 'x-test-hold': '1' }, bodyBase64: Buffer.from(body).toString('base64') });
    await requestStarted;
    const aborted = await fetch(`${baseUrl(harness.bridge)}/abort`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'abort', type: 'api:proxy:abort', payload: { requestID: 'abort-prompt' } }) });
    expect((await aborted.json()).data.aborted).toBe(true);
    const completion = await pending;
    expect(completion.status).toBe(200);
    expect((await completion.json()).data.status).toBe(502);
    expect(calls.filter((call) => call.path.endsWith('/prompt_async'))).toHaveLength(2);
  });

  it('streams the real Legacy event frame with auth and closes delivery when the runtime retires', async () => {
    const requests = [];
    let sendSecond;
    let secondReady;
    const secondGate = new Promise((resolve) => { sendSecond = resolve; });
    const gotSecond = new Promise((resolve) => { secondReady = resolve; });
    const upstream = await listen((request, response) => {
      const url = new URL(request.url, 'http://upstream');
      requests.push({ path: url.pathname, directory: url.searchParams.get('directory'), authorization: request.headers.authorization });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.write('id: evt-1\ndata: {"type":"server.connected"}\n\n');
      void secondGate.then(() => response.write('id: evt-2\ndata: {"type":"session.updated"}\n\n'));
    });
    let runtime = { generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY, version: VERSION, endpoint: baseUrl(upstream), epoch: 1 };
    const manager = {
      getStatus: () => 'connected', getApiUrl: () => runtime.endpoint,
      onStatusChange: (callback) => { callback('connected'); return { dispose() {} }; },
      getKernelRuntime: () => runtime, refreshKernelRuntime: async () => runtime,
      getOpenCodeAuthHeaders: () => ({ authorization: AUTH }), getWorkingDirectory: () => DIRECTORY,
    };
    const controller = new AbortController();
    const frames = [];
    const opened = await openSseProxy({ manager, path: '/api/event?directory=C%3A%2Fwork&lastEventId=old',
      signal: controller.signal, onChunk: (frame) => { frames.push(frame); if (frames.length === 1) secondReady(); }, stallTimeoutMs: 1000 });
    try {
      await gotSecond;
      expect(opened.headers).toMatchObject({ 'content-type': 'text/event-stream' });
      expect(frames.join('')).toContain('id: evt-1\ndata: {"type":"server.connected"}');
      expect(requests).toEqual([{ path: '/event', directory: DIRECTORY, authorization: AUTH }]);
      runtime = { ...runtime, epoch: runtime.epoch + 1 };
      sendSecond();
      await expect(opened.run).rejects.toThrow('connection changed');
    } finally {
      controller.abort();
      sendSecond();
    }
  });
});






// VS Code uses Node fetch. Bun can settle an abort while retaining the socket,
// so verify actual upstream connection cancellation in the owning runtime.
it('closes an aborted upstream prompt connection in native Node', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-node-abort-'));
  directories.push(directory);
  const bundle = path.join(directory, 'bridge.mjs');
  await build({ entryPoints: [new URL('./bridge-proxy-runtime.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, external: ['vscode'], logLevel: 'silent' });
  const worker = path.join(directory, 'worker.mjs');
  await fs.writeFile(worker, `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import { handleProxyBridgeMessage } from './bridge.mjs';
    let entered, closed;
    const started = new Promise(resolve => { entered = resolve; });
    const disconnected = new Promise(resolve => { closed = resolve; });
    const server = http.createServer(async (request, response) => {
      for await (const chunk of request) {}
      response.once('close', closed);
      entered();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = 'http://127.0.0.1:' + server.address().port;
    const identity = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', epoch: 1, endpoint };
    const manager = { getStatus: () => 'connected', getApiUrl: () => endpoint,
      getKernelRuntime: () => identity, refreshKernelRuntime: async () => identity,
      getOpenCodeAuthHeaders: () => ({}), onStatusChange: () => ({ dispose() {} }) };
    const deps = { tryHandleLocalFsProxy: async () => null, sanitizeForwardHeaders: headers => headers || {},
      collectHeaders: headers => Object.fromEntries(headers), base64EncodeUtf8: text => Buffer.from(text).toString('base64'),
      buildUnavailableApiResponse: () => ({ status: 503, headers: {} }) };
    try {
      const pending = handleProxyBridgeMessage({ id: 'held', type: 'api:proxy', payload: { method: 'POST',
        path: '/session/s1/prompt_async?directory=repo', headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from('{"parts":[]}').toString('base64') } }, { manager }, deps);
      await started;
      const aborted = await handleProxyBridgeMessage({ id: 'cancel', type: 'api:proxy:abort', payload: { requestID: 'held' } }, { manager }, deps);
      assert.equal(aborted.data.aborted, true);
      assert.equal((await pending).data.status, 502);
      await disconnected;
      console.log(JSON.stringify({ aborted: true, upstreamClosed: true, runtime: process.version }));
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  `);
  const { stdout } = await promisify(execFile)('node', [worker], { windowsHide: true, timeout: 15000 });
  expect(JSON.parse(stdout)).toMatchObject({ aborted: true, upstreamClosed: true });
}, 20000);
