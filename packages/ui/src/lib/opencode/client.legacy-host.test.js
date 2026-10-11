import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { opencodeClient } from './client';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '../runtime-url';
import { createLegacyMetadataStore } from '../../../../web/server/lib/openchamber-sessions/legacy-metadata-store.js';
import { OPENCODE_PROFILE } from '../../../../web/server/lib/opencode/compatibility.js';
import { createKernelOperations } from '../../../../web/server/lib/opencode/kernel-operations.js';
import { createLegacySessionHttp } from '../../../../web/server/lib/opencode/legacy-session-http.js';
import { registerOpenCodeProxy } from '../../../../web/server/lib/opencode/proxy.js';

const PROFILE = OPENCODE_PROFILE.LEGACY;
const SCOPE = 'managed';
const DIRECTORY = 'C:/work';
const SESSION_ID = 'ses_legacy';
const SESSION = { id: SESSION_ID, slug: 'legacy', projectID: 'prj_1', directory: DIRECTORY,
  version: '1.2.27', title: 'before', time: { created: 1, updated: 2 } };
const previousResolver = getRuntimeUrlResolver();
const servers = [];
const tempDirs = [];

const listen = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server;
};
const origin = (server) => `http://127.0.0.1:${server.address().port}`;
const bodyOf = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
};
const json = (response, value) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};

beforeEach(() => {
  opencodeClient.reconnectToRuntimeBaseUrl();
});

afterEach(async () => {
  opencodeClient.reconnectToRuntimeBaseUrl();
  setRuntimeUrlResolver(previousResolver);
  await Promise.all(servers.splice(0).reverse().map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const makeHost = async (requests) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-legacy-ui-host-'));
  tempDirs.push(directory);
  const session = { ...SESSION, time: { ...SESSION.time } };
  const upstream = await listen(async (req, res) => {
    const body = await bodyOf(req);
    const url = new URL(req.url, 'http://upstream');
    const record = { method: req.method, path: url.pathname, query: url.search, body,
      authorization: req.headers.authorization };
    requests.push(record);
    if (req.method === 'POST' && url.pathname === '/session') {
      Object.assign(session, body, { id: SESSION_ID, directory: DIRECTORY, time: SESSION.time });
      return json(res, session);
    }
    if (req.method === 'DELETE' && url.pathname === `/session/${SESSION_ID}`) return json(res, true);
    if (req.method === 'PATCH' && url.pathname === `/session/${SESSION_ID}`) {
      session.title = body.title ?? session.title;
      return json(res, session);
    }
    if (req.method === 'GET' && url.pathname === `/session/${SESSION_ID}`) return json(res, session);
    if (req.method === 'GET' && url.pathname === '/session') return json(res, [session]);
    if (req.method === 'GET' && url.pathname === `/session/${SESSION_ID}/message`) return json(res, []);
    if (req.method === 'GET' && ['/permission', '/question'].includes(url.pathname)) return json(res, []);
    if (req.method === 'POST' && url.pathname.endsWith('/prompt_async')) {
      record.responseStatus = 204;
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'POST' && /\/session\/[^/]+\/abort$/.test(url.pathname)) return json(res, true);
    if (req.method === 'POST' && /\/(permission|question)\/[^/]+\/(reply|reject)$/.test(url.pathname)) return json(res, true);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unexpected-upstream-request' }));
  });
  const runtime = { generation: 'oc1', profile: PROFILE, version: '1.2.27', endpoint: origin(upstream), epoch: 1 };
  const storageScope = { value: SCOPE };
  const getRuntime = () => runtime;
  const getStorageScope = () => storageScope.value;
  const metadataStore = createLegacyMetadataStore({ dataDir: directory });
  const operations = createKernelOperations({ getRuntime, getHeaders: () => ({ authorization: 'Bearer fixture-token' }),
    legacyMetadataStore: metadataStore, getStorageScope });
  const legacySessionHttp = createLegacySessionHttp({ getRuntime, operations, metadataStore, getStorageScope });
  const app = express();
  registerOpenCodeProxy(app, {
    fs, os, path, OPEN_CODE_READY_GRACE_MS: 6000,
    getRuntime: () => ({ openCodePort: upstream.address().port, isOpenCodeReady: true }),
    getKernelRuntime: getRuntime,
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer fixture-token' }),
    buildOpenCodeUrl: (route) => origin(upstream) + route,
    ensureOpenCodeApiPrefix: () => {},
    readWorktreeBootstrapStatus: async () => ({ status: 'ready' }),
    legacySessionHttp,
  });
  const host = await listen(app);
  configureRuntimeUrlResolver({ apiBaseUrl: `${origin(host)}/api` });
  opencodeClient.bindRuntime({ generation: 'oc1', profile: PROFILE, version: '1.2.27', endpoint: runtime.endpoint, epoch: 1 });
  return { runtime, metadataStore, storageScope };
};

describe('Legacy 1.2.27 shared UI to host contract', () => {
  test('uses the bound SDK through the loopback host for sessions, sync, prompts, and replies', async () => {
    const requests = [];
    const { metadataStore } = await makeHost(requests);
    const metadata = { openchamber: { goal: 'g' } };

    const created = await opencodeClient.createSession({ title: 'created', metadata }, DIRECTORY);
    expect(created).toMatchObject({ id: SESSION_ID, title: 'created', metadata });
    expect(await metadataStore.read(SCOPE, SESSION_ID)).toEqual(metadata);
    expect(requests[0]).toMatchObject({ method: 'POST', path: '/session', body: { title: 'created' } });
    expect(requests[0].body.metadata).toBeUndefined();

    await opencodeClient.updateSession(SESSION_ID, { title: 'renamed', metadata: { openchamber: { keep: true } } }, DIRECTORY);
    expect(await metadataStore.read(SCOPE, SESSION_ID)).toEqual({ openchamber: { goal: 'g', keep: true } });
    expect(await opencodeClient.getSession(SESSION_ID, DIRECTORY)).toMatchObject({ id: SESSION_ID, title: 'renamed', metadata: { openchamber: { goal: 'g', keep: true } } });
    expect((await opencodeClient.listSessions()).some((item) => item.id === SESSION_ID)).toBe(true);
    expect(await opencodeClient.getSessionMessages(SESSION_ID, 20, DIRECTORY)).toEqual([]);

    const sync = opencodeClient.getSyncSource();
    expect((await sync.listSessions(DIRECTORY)).some((item) => item.id === SESSION_ID)).toBe(true);
    expect(await sync.messagePage(SESSION_ID, DIRECTORY, 20)).toMatchObject({ items: [] });
    expect(await sync.permissions(DIRECTORY)).toEqual([]);
    expect(await sync.inputs(DIRECTORY)).toEqual([]);

    const messageId = await opencodeClient.sendMessage({ id: SESSION_ID, providerID: 'provider', modelID: 'model',
      messageId: 'msg_fixture', text: 'hello from SDK', files: [{ type: 'file', mime: 'text/plain', filename: 'note.txt',
        url: 'data:text/plain;base64,SGVsbG8=' }], directory: DIRECTORY });
    expect(messageId).toBe('msg_fixture');
    const prompt = requests.find((request) => request.path === `/session/${SESSION_ID}/prompt_async`);
    expect(prompt).toMatchObject({ method: 'POST', responseStatus: 204, body: { messageID: 'msg_fixture',
      model: { providerID: 'provider', modelID: 'model' },
      parts: [{ type: 'text', text: 'hello from SDK' }, { type: 'file', mime: 'text/plain', filename: 'note.txt' }] } });
    expect(prompt.body.parts[1].url).toBe('data:text/plain;base64,SGVsbG8=');

    expect(await opencodeClient.abortSession(SESSION_ID, DIRECTORY)).toBe(true);
    expect(await opencodeClient.replyToPermission('perm_1', 'once', { directory: DIRECTORY, sessionID: SESSION_ID })).toBe(true);
    expect(await opencodeClient.replyToQuestion('question_1', ['yes'], DIRECTORY)).toBe(true);
    expect(requests.every((request) => request.authorization === 'Bearer fixture-token')).toBe(true);
  });

  test('deletes through the owned host and refuses a mismatched Legacy profile', async () => {
    const requests = [];
    const state = await makeHost(requests);
    await state.metadataStore.patch(SCOPE, SESSION_ID, { openchamber: { goal: 'g' } }, { replace: true });
    expect(await opencodeClient.deleteSession(SESSION_ID, DIRECTORY)).toBe(true);
    expect(await state.metadataStore.read(SCOPE, SESSION_ID)).toEqual({});
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'DELETE', path: `/session/${SESSION_ID}`, authorization: 'Bearer fixture-token' });
    requests.length = 0;
    state.runtime.version = '1.2.28';
    await expect(opencodeClient.createSession({ title: 'blocked' }, DIRECTORY)).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});
