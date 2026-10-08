import http from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_OPERATION, AGENT_SERVER_METHOD } from './constants.js';
import { agentArtifactDigest } from './artifacts.js';
import { createAgentAuthority } from './authority.js';
import { createAgentDispatcher } from './dispatcher.js';
import { loadAgentAdapter } from './loader.js';
import { AgentTransportError, createAgentTransport } from './transport.js';

const servers = new Set();
const sockets = new Map();
const identity = (overrides = {}) => ({
  family: AGENT_FAMILY.CAGENT,
  connectionID: 'connection-1',
  epoch: 1,
  adapterRevision: 'adapter-1',
  capabilityRevision: 'capability-1',
  ...overrides,
});
const connection = (overrides = {}) => ({
  identity: identity(),
  baseURL: 'http://127.0.0.1/',
  headers: { Authorization: 'Bearer host-secret', 'X-Host': 'host-value' },
  ready: true,
  authorized: true,
  ...overrides,
});
const start = async (handler) => {
  const server = http.createServer(handler);
  servers.add(server);
  const connected = new Set();
  sockets.set(server, connected);
  server.on('connection', (socket) => {
    connected.add(socket);
    socket.on('close', () => connected.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
};
const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};
const sendJSON = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};
const request = (method = AGENT_SERVER_METHOD.GET, path = '/status', extra = {}) => ({ method, path, ...extra });
const errorCode = async (promise, code) => {
  await expect(promise).rejects.toBeInstanceOf(AgentTransportError);
  await expect(promise).rejects.toMatchObject({ name: 'AgentTransportError', code });
};

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => {
    for (const socket of sockets.get(server) || []) socket.destroy();
    server.close(resolve);
  })));
  sockets.clear();
  servers.clear();
});

describe('agent HTTP transport', () => {
  it('preserves the API prefix, query, host headers and JSON body', async () => {
    let received;
    const { url } = await start(async (req, res) => {
      received = { url: req.url, method: req.method, headers: req.headers, body: await readBody(req) };
      sendJSON(res, 200, { ok: true });
    });
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: `${url}api/v2/` }) });

    const result = await transport.request(request(AGENT_SERVER_METHOD.POST, '/sessions/s%201', {
      query: { cursor: 'a b', mode: 'full' }, body: { prompt: 'hello', count: 2 },
    }), identity());

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(received).toMatchObject({
      url: '/api/v2/sessions/s%201?cursor=a+b&mode=full', method: 'POST',
      headers: {
        authorization: 'Bearer host-secret', 'x-host': 'host-value',
        accept: 'application/json', 'content-type': 'application/json',
      },
      body: '{"prompt":"hello","count":2}',
    });
  });

  it('retains JSON error bodies and represents 204 and 205 bodies as null', async () => {
    const { url } = await start((req, res) => {
      if (req.url === '/bad') sendJSON(res, 400, { error: 'rejected' });
      else res.writeHead(req.url === '/empty' ? 204 : 205).end();
    });
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: url }) });

    await expect(transport.request(request(AGENT_SERVER_METHOD.GET, '/bad'), identity()))
      .resolves.toEqual({ status: 400, body: { error: 'rejected' } });
    await expect(transport.request(request(AGENT_SERVER_METHOD.GET, '/empty'), identity()))
      .resolves.toEqual({ status: 204, body: null });
    await expect(transport.request(request(AGENT_SERVER_METHOD.GET, '/reset'), identity()))
      .resolves.toEqual({ status: 205, body: null });
  });

  it('rejects malformed JSON and refuses redirects without contacting the redirect target', async () => {
    let targetCalls = 0;
    const target = await start((_req, res) => { targetCalls += 1; sendJSON(res, 200, { leaked: true }); });
    const source = await start((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: target.url }).end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{broken');
      }
    });
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: source.url }) });

    await errorCode(transport.request(request(AGENT_SERVER_METHOD.GET, '/json'), identity()), AGENT_ERROR.INVALID_RESPONSE);
    await errorCode(transport.request(request(AGENT_SERVER_METHOD.GET, '/redirect'), identity()), AGENT_ERROR.INVALID_RESPONSE);
    expect(targetCalls).toBe(0);
  });

  it.each([
    ['null selection', () => null],
    ['malformed selection', () => ({ identity: {}, baseURL: 'not-a-url' })],
    ['throwing selector', () => { throw new Error('private selector detail'); }],
  ])('refuses a %s without making a network request', async (_label, getConnection) => {
    let calls = 0;
    const server = await start((_req, res) => { calls += 1; sendJSON(res, 200, {}); });
    const transport = createAgentTransport({ getConnection });

    await errorCode(transport.request(request(), identity()), AGENT_ERROR.UNAVAILABLE);
    expect(calls).toBe(0);
    await expect(transport.request(request(), identity())).rejects.not.toThrow(/private selector detail/);
    expect(server.url).toBeTruthy();
  });

  it.each([
    ['unauthorized', { authorized: false }, AGENT_ERROR.UNAUTHORIZED],
    ['unready', { ready: false }, AGENT_ERROR.UNAVAILABLE],
    ['wrong connection', { identity: identity({ connectionID: 'other' }) }, AGENT_ERROR.CHANGED],
    ['wrong epoch', { identity: identity({ epoch: 2 }) }, AGENT_ERROR.CHANGED],
    ['wrong adapter revision', { identity: identity({ adapterRevision: 'other' }) }, AGENT_ERROR.CHANGED],
    ['wrong capability revision', { identity: identity({ capabilityRevision: 'other' }) }, AGENT_ERROR.CHANGED],
    ['wrong backend family', { identity: identity({ family: AGENT_FAMILY.OPENCODE }) }, AGENT_ERROR.UNAVAILABLE],
  ])('refuses %s before network access', async (_label, override, code) => {
    let calls = 0;
    const { url } = await start((_req, res) => { calls += 1; sendJSON(res, 200, {}); });
    const transport = createAgentTransport({ getConnection: () => connection({ ...override, baseURL: url }) });

    await errorCode(transport.request(request(), identity()), code);
    expect(calls).toBe(0);
  });

  it('uses endpoint and credentials from the current connection after an epoch advance', async () => {
    let selected;
    let oldCalls = 0;
    let newRequest;
    const oldServer = await start((_req, res) => { oldCalls += 1; sendJSON(res, 200, {}); });
    const newServer = await start(async (req, res) => {
      newRequest = { url: req.url, authorization: req.headers.authorization };
      sendJSON(res, 200, { current: true });
    });
    selected = connection({ baseURL: oldServer.url });
    const transport = createAgentTransport({ getConnection: () => selected });
    selected = connection({
      identity: identity({ epoch: 2 }), baseURL: `${newServer.url}current/`,
      headers: { Authorization: 'Bearer new-secret' },
    });

    await errorCode(transport.request(request(), identity()), AGENT_ERROR.CHANGED);
    await expect(transport.request(request(AGENT_SERVER_METHOD.GET, '/check'), selected.identity))
      .resolves.toEqual({ status: 200, body: { current: true } });
    expect(oldCalls).toBe(0);
    expect(newRequest).toEqual({ url: '/current/check', authorization: 'Bearer new-secret' });
  });

  it('rejects a delayed response when the connection changes while the request is in flight', async () => {
    let selected;
    let received;
    const entered = new Promise((resolve) => { received = resolve; });
    let finish;
    const delayed = new Promise((resolve) => { finish = resolve; });
    const { url } = await start(async (_req, res) => {
      received();
      await delayed;
      sendJSON(res, 200, { stale: true });
    });
    selected = connection({ baseURL: url });
    const transport = createAgentTransport({ getConnection: () => selected });
    const pending = transport.request(request(), identity());
    await entered;
    selected = connection({ identity: identity({ epoch: 2 }), baseURL: url });
    finish();

    await errorCode(pending, AGENT_ERROR.CHANGED);
  });

  it('keeps refusal messages free of endpoint, credentials and thrown details', async () => {
    const secretURL = 'https://user:secret@example.invalid/private/?token=query-secret#fragment-secret';
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: secretURL }) });

    await expect(transport.request(request(), identity())).rejects.toMatchObject({
      code: AGENT_ERROR.INVALID_INPUT,
      message: `Agent transport refused: ${AGENT_ERROR.INVALID_INPUT}`,
    });
    await expect(createAgentTransport({ getConnection: () => { throw new Error('password-secret'); } })
      .request(request(), identity())).rejects.not.toThrow(/password-secret|secret|token/);
  });

  it('rejects a completed JSON body if the identity changes after headers arrive', async () => {
    let selected;
    let headersRead;
    const observed = new Promise((resolve) => { headersRead = resolve; });
    let finish;
    const delayed = new Promise((resolve) => { finish = resolve; });
    const { url } = await start(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"stale":');
      await delayed;
      res.end('true}');
    });
    selected = connection({ baseURL: url });
    let reads = 0;
    const transport = createAgentTransport({ getConnection: () => {
      reads += 1;
      if (reads === 2) headersRead();
      return selected;
    } });
    const pending = transport.request(request(), identity());
    await observed;
    selected = connection({ identity: identity({ epoch: 2 }), baseURL: url });
    finish();
    await errorCode(pending, AGENT_ERROR.CHANGED);
    expect(reads).toBe(3);
  });

  it('connects a verified adapter through authority and dispatch to the native HTTP port', async () => {
    let calls = 0;
    const session = { id: 'session-1', workspaceID: 'workspace-1', title: 'Synthetic transport' };
    const { url } = await start((req, res) => {
      calls += 1;
      expect(req.url).toBe('/api/sessions/session-1?workspace=workspace-1');
      expect(req.headers.authorization).toBe('Bearer host-secret');
      sendJSON(res, 200, session);
    });
    const source = Buffer.from(`export function createAdapter(context) {
      return { capabilities: { '${AGENT_OPERATION.GET_SESSION}': { state: 'supported', evidence: ['syntheticAPI'] } },
        handlers: { '${AGENT_OPERATION.GET_SESSION}': async (input, scope) => {
          const response = await context.request({ method: 'GET', path: '/sessions/' + input.sessionID,
            query: { workspace: input.workspaceID } }, scope);
          if (response.status !== 200) throw new Error('backend refused');
          return response.body;
        } } };
    }`);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-agent-http-'));
    try {
      await fs.writeFile(path.join(directory, 'adapter.mjs'), source);
      const files = [{ path: 'adapter.mjs', bytes: source.length,
        digest: createHash('sha256').update(source).digest('hex') }];
      const profile = { adapterID: 'synthetic-api', family: AGENT_FAMILY.CAGENT,
        adapterRevision: identity().adapterRevision, capabilityRevision: identity().capabilityRevision };
      const transport = createAgentTransport({ getConnection: () => connection({ baseURL: `${url}api/` }) });
      const registration = await loadAgentAdapter({ directory, profile, transport,
        manifest: { version: 1, files, artifactDigest: agentArtifactDigest(files) } });
      const selection = { ...identity(), adapterID: profile.adapterID, serverRevision: 'synthetic-server',
        ready: true, authorized: true };
      let approved = false;
      const authority = createAgentAuthority({ registrations: [registration], getSelection: () => selection,
        getAcceptance: () => approved ? { ...profile, connectionID: selection.connectionID,
          serverRevision: selection.serverRevision, artifactDigest: registration.artifactDigest,
          operations: [{ operation: AGENT_OPERATION.GET_SESSION, evidence: ['host synthetic acceptance'] }] } : null });
      const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
      const input = { workspaceID: 'workspace-1', sessionID: 'session-1' };
      await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, input))
        .rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
      expect(calls).toBe(0);
      approved = true;
      await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, input))
        .resolves.toEqual({ identity: identity(), data: session });
      expect(calls).toBe(1);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  it.each([
    ['GET body', request(AGENT_SERVER_METHOD.GET, '/status', { body: { forbidden: true } })],
    ['dot segment', request(AGENT_SERVER_METHOD.GET, '/safe/../admin')],
    ['encoded dot segment', request(AGENT_SERVER_METHOD.GET, '/safe/%2e%2e/admin')],
    ['encoded slash', request(AGENT_SERVER_METHOD.GET, '/safe/%2fadmin')],
    ['backslash', request(AGENT_SERVER_METHOD.GET, '/safe\\admin')],
    ['malformed encoding', request(AGENT_SERVER_METHOD.GET, '/safe/%ZZ')],
  ])('rejects %s before sending a request', async (_label, input) => {
    let calls = 0;
    const { url } = await start((_req, res) => { calls += 1; sendJSON(res, 200, {}); });
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: url }) });

    await errorCode(transport.request(input, identity()), AGENT_ERROR.INVALID_INPUT);
    expect(calls).toBe(0);
  });

  it.each([
    'ftp://127.0.0.1/',
    'http://user:pass@127.0.0.1/',
    'http://127.0.0.1/?token=query-secret',
    'http://127.0.0.1/#fragment-secret',
    'http://127.0.0.1/no-trailing-slash',
  ])('rejects an invalid base URL: %s', async (baseURL) => {
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL }) });
    await errorCode(transport.request(request(), identity()), AGENT_ERROR.INVALID_INPUT);
  });

  it('rejects a missing selector at construction', () => {
    expect(() => createAgentTransport({})).toThrowError(`Agent transport refused: ${AGENT_ERROR.INVALID_INPUT}`);
  });

  it('times out while waiting for response headers', async () => {
    const { url } = await start(() => {});
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: url }), timeoutMs: 250 });

    await errorCode(transport.request(request(), identity()), AGENT_ERROR.TIMEOUT);
  });

  it('times out while consuming a partial JSON body', async () => {
    let headersSent;
    const entered = new Promise((resolve) => { headersSent = resolve; });
    const { url } = await start(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"partial":');
      headersSent();
      await new Promise(() => {});
    });
    let reads = 0;
    const transport = createAgentTransport({ getConnection: () => {
      reads += 1;
      return connection({ baseURL: url });
    }, timeoutMs: 250 });
    const pending = transport.request(request(), identity());
    await entered;

    await errorCode(pending, AGENT_ERROR.TIMEOUT);
    expect(reads).toBe(2);
  });

  it('rejects a pre-aborted signal without making an HTTP request', async () => {
    let calls = 0;
    const { url } = await start((_req, res) => { calls += 1; sendJSON(res, 200, {}); });
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: url }) });
    const controller = new AbortController();
    controller.abort();

    await errorCode(transport.request(request(), identity(), { signal: controller.signal }), AGENT_ERROR.CANCELLED);
    expect(calls).toBe(0);
  });

  it.each(['headers', 'body'])('cancels a selection-retired request while %s are pending', async (stage) => {
    let calls = 0;
    let inspected = 0;
    let headersRead;
    const headers = new Promise((resolve) => { headersRead = resolve; });
    let enteredRequest;
    const entered = new Promise((resolve) => { enteredRequest = resolve; });
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const { url } = await start(async (_req, res) => {
      calls += 1;
      if (stage === 'body') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"partial":');
      }
      enteredRequest();
      await held;
      if (stage === 'body') res.end('true}');
      else sendJSON(res, 200, { retired: true });
    });
    const retired = new AbortController();
    const transport = createAgentTransport({ getConnection: () => {
      inspected += 1;
      if (inspected === 2) headersRead();
      return connection({ baseURL: url });
    }, selectionSignal: retired.signal });
    const pending = transport.request(request(), identity());
    try {
      await entered;
      if (stage === 'body') await headers;
      retired.abort();
      await errorCode(pending, AGENT_ERROR.CHANGED);
      expect(calls).toBe(1);
    } finally { release(); }
  });

  it('refuses a retired selection before making an HTTP request', async () => {
    let calls = 0;
    const { url } = await start((_req, res) => { calls += 1; sendJSON(res, 200, {}); });
    const retired = new AbortController();
    retired.abort();
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: url }), selectionSignal: retired.signal });

    await errorCode(transport.request(request(), identity()), AGENT_ERROR.CHANGED);
    expect(calls).toBe(0);
  });

  it.each(['headers', 'body'])('cancels a caller-aborted request while %s are pending', async (stage) => {
    let enteredRequest;
    const entered = new Promise((resolve) => { enteredRequest = resolve; });
    const { url } = await start(async (_req, res) => {
      if (stage === 'body') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"partial":');
      }
      enteredRequest();
      await new Promise(() => {});
    });
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: url }) });
    const controller = new AbortController();
    const pending = transport.request(request(), identity(), { signal: controller.signal });
    await entered;
    controller.abort();

    await errorCode(pending, AGENT_ERROR.CANCELLED);
  });

  it('keeps a later request usable after the caller aborts an earlier request', async () => {
    let calls = 0;
    let firstEntered;
    const entered = new Promise((resolve) => { firstEntered = resolve; });
    const { url } = await start(async (_req, res) => {
      calls += 1;
      if (calls === 1) {
        firstEntered();
        await new Promise(() => {});
      } else sendJSON(res, 200, { ok: true });
    });
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: url }) });
    const controller = new AbortController();
    const first = transport.request(request(), identity(), { signal: controller.signal });
    await entered;
    controller.abort();
    await errorCode(first, AGENT_ERROR.CANCELLED);

    await expect(transport.request(request(), identity())).resolves.toEqual({ status: 200, body: { ok: true } });
  });

  it('rejects invalid timeout and request control values', async () => {
    for (const selectionSignal of [null, {}]) {
      expect(() => createAgentTransport({ getConnection: () => connection(), selectionSignal }))
        .toThrowError(`Agent transport refused: ${AGENT_ERROR.INVALID_INPUT}`);
    }
    for (const timeoutMs of [0, 1.5, 300001]) {
      expect(() => createAgentTransport({ getConnection: () => connection(), timeoutMs }))
        .toThrowError(`Agent transport refused: ${AGENT_ERROR.INVALID_INPUT}`);
    }
    const { url } = await start((_req, res) => sendJSON(res, 200, {}));
    const transport = createAgentTransport({ getConnection: () => connection({ baseURL: url }) });
    for (const control of [null, { signal: {} }, { signal: new AbortController().signal, extra: true }]) {
      await errorCode(transport.request(request(), identity(), control), AGENT_ERROR.INVALID_INPUT);
    }
  });
});
