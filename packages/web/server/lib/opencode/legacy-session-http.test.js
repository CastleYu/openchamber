import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createLegacyMetadataStore } from '../openchamber-sessions/legacy-metadata-store.js';
import { OPENCODE_PROFILE } from './compatibility.js';
import { createKernelOperations } from './kernel-operations.js';
import { createLegacySessionHttp } from './legacy-session-http.js';
import { registerOpenCodeProxy } from './proxy.js';

const GENERATION = Object.freeze({ OC1: 'oc1', OC2: 'oc2' });
const SCOPE = 'managed';
const DIRECTORY = 'C:/work';
const IDENTITY = Object.freeze({ generation: GENERATION.OC1, profile: OPENCODE_PROFILE.LEGACY,
  version: '1.2.27', endpoint: 'http://fixture.invalid', epoch: 1 });
const SESSION = Object.freeze({ id: 'ses_1', slug: 'one', projectID: 'prj_1', directory: DIRECTORY,
  version: '1.2.27', title: 'before', parentID: 'ses_parent', time: { created: 1, updated: 2 } });
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

const address = (server) => `http://127.0.0.1:${server.address().port}`;

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
};

const createHarness = async ({ runtime = { ...IDENTITY }, upstreamRequest = () => {}, storeOptions = {} } = {}) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-legacy-session-http-'));
  directories.push(dataDir);
  const currentSession = { ...SESSION, time: { ...SESSION.time } };
  const upstream = await listen(async (request, response) => {
    const body = await readBody(request);
    const url = new URL(request.url, 'http://upstream');
    const record = { method: request.method, path: url.pathname, directory: url.searchParams.get('directory'), body };
    upstreamRequest(record);
    if (request.method === 'POST' && url.pathname === '/session') {
      Object.assign(currentSession, body, { id: SESSION.id, directory: DIRECTORY, time: SESSION.time });
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify(currentSession));
    }
    if (request.method === 'GET' && url.pathname === `/session/${SESSION.id}`) {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify(currentSession));
    }
    if (request.method === 'PATCH' && url.pathname === `/session/${SESSION.id}`) {
      currentSession.title = body.title ?? currentSession.title;
      currentSession.time = { ...currentSession.time, ...(body.time ?? {}), updated: 3 };
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify(currentSession));
    }
    if (request.method === 'GET' && ['/session', '/experimental/session'].includes(url.pathname)) {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify([currentSession]));
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'unexpected upstream request' }));
  });
  const endpoint = address(upstream);
  runtime.endpoint = endpoint;
  const storageScope = { value: SCOPE };
  const metadataStore = createLegacyMetadataStore({ dataDir, ...storeOptions });
  const getRuntime = () => runtime;
  const getStorageScope = () => storageScope.value;
  const operations = createKernelOperations({ getRuntime, getHeaders: () => ({}),
    legacyMetadataStore: metadataStore, getStorageScope });
  const legacySessionHttp = createLegacySessionHttp({ getRuntime, operations, metadataStore, getStorageScope });
  const app = express();
  registerOpenCodeProxy(app, {
    fs, os, path, OPEN_CODE_READY_GRACE_MS: 6000,
    getRuntime: () => ({ openCodePort: upstream.address().port, isOpenCodeReady: true }),
    getKernelRuntime: getRuntime,
    getOpenCodeAuthHeaders: () => ({}),
    buildOpenCodeUrl: (route) => address(upstream) + route,
    ensureOpenCodeApiPrefix: () => {},
    readWorktreeBootstrapStatus: async () => ({ status: 'ready' }),
    legacySessionHttp,
  });
  const host = await listen(app);
  return { host, upstream, currentSession, dataDir, metadataStore, runtime, storageScope };
};

const hostUrl = (host, route) => `${address(host)}/api${route}`;

describe('Legacy session HTTP integration', () => {
  it('creates a session through the kernel, persists metadata off-wire, and overlays all session reads', async () => {
    const requests = [];
    const harness = await createHarness({ upstreamRequest: (request) => requests.push(request) });
    const metadata = { openchamber: { goal: 'g' } };
    const permission = [{ permission: 'read', pattern: '**', action: 'allow' }];
    const response = await fetch(hostUrl(harness.host, '/session?directory=C%3A%2Fwork'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'created', parentID: 'ses_parent', permission, workspaceID: 'wrk_1', metadata }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: SESSION.id, title: 'created', metadata });
    expect(requests).toEqual([{ method: 'POST', path: '/session', directory: DIRECTORY,
      body: { title: 'created', parentID: 'ses_parent', permission, workspaceID: 'wrk_1' } }]);
    expect(await harness.metadataStore.read(SCOPE, SESSION.id)).toEqual(metadata);

    for (const route of ['/session?directory=C%3A%2Fwork', `/session/${SESSION.id}?directory=C%3A%2Fwork`,
      '/experimental/session?directory=C%3A%2Fwork']) {
      const read = await fetch(hostUrl(harness.host, route));
      expect(read.status).toBe(200);
      const body = await read.json();
      const session = Array.isArray(body) ? body[0] : body;
      expect(session).toMatchObject({ id: SESSION.id, metadata });
    }
  });

  it('updates upstream fields and merges metadata patches across HTTP and persisted reads', async () => {
    const requests = [];
    const harness = await createHarness({ upstreamRequest: (request) => requests.push(request) });
    await harness.metadataStore.patch(SCOPE, SESSION.id, { openchamber: { keep: true, remove: true } }, { replace: true });
    const response = await fetch(hostUrl(harness.host, `/session/${SESSION.id}?directory=C%3A%2Fwork`), {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'renamed', time: { archived: 9 }, metadata: { openchamber: { remove: null, added: 2 } } }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title: 'renamed', time: { archived: 9 },
      metadata: { openchamber: { keep: true, added: 2 } } });
    expect(requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'GET', path: `/session/${SESSION.id}`, body: null },
      { method: 'PATCH', path: `/session/${SESSION.id}`, body: { title: 'renamed', time: { archived: 9 } } },
    ]);
    expect(await createLegacyMetadataStore({ dataDir: harness.dataDir }).read(SCOPE, SESSION.id))
      .toEqual({ openchamber: { keep: true, added: 2 } });
  });

  it('rejects unknown fields and a non-Legacy descriptor before upstream effects', async () => {
    const requests = [];
    const harness = await createHarness({ upstreamRequest: (request) => requests.push(request) });
    const invalid = await fetch(hostUrl(harness.host, '/session?directory=C%3A%2Fwork'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'bad', agent: 'build' }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid-request' });

    harness.runtime.version = '1.2.28';
    const changed = await fetch(hostUrl(harness.host, '/session?directory=C%3A%2Fwork'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'bad' }),
    });
    expect(changed.status).toBe(501);
    expect(requests).toHaveLength(0);
  });

  it('refuses a delayed metadata overlay after the Legacy descriptor retires', async () => {
    let releaseRead;
    let readStarted;
    const started = new Promise((resolve) => { readStarted = resolve; });
    const gate = new Promise((resolve) => { releaseRead = resolve; });
    const requests = [];
    const harness = await createHarness({ upstreamRequest: (request) => requests.push(request), storeOptions: {
      fsPromises: { readFile: async () => { readStarted(); await gate; return '{}'; } },
    } });
    const pending = fetch(hostUrl(harness.host, `/session/${SESSION.id}?directory=C%3A%2Fwork`));
    await started;
    harness.runtime.epoch += 1;
    releaseRead();
    const response = await pending;

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'OpenCode service unavailable' });
    expect(requests).toHaveLength(1);
  });
});


describe('Legacy HTTP partial outcomes', () => {
  it('reports the created session when metadata storage and rollback fail without leaking the storage error', async () => {
    const requests = [];
    const harness = await createHarness({ upstreamRequest: (request) => requests.push(request), storeOptions: {
      fsPromises: { ...fs, rename: async () => { throw new Error('private-storage-path'); } },
    } });
    const response = await fetch(hostUrl(harness.host, '/session?directory=C%3A%2Fwork'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'created', metadata: { openchamber: { goal: 'g' } } }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'legacy-session-failed', partial: true,
      createdSessionID: SESSION.id, rolledBack: false, cleanupFailed: true });
    expect(requests.map((request) => request.method)).toEqual(['POST', 'DELETE']);
    expect(await harness.metadataStore.read(SCOPE, SESSION.id)).toEqual({});
  });
});
