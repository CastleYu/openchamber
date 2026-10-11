import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createOpenChamberSessionService, registerOpenChamberSessionRoutes } from '../openchamber-sessions/routes.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernelOperations } from './kernel-operations.js';
import { OPENCODE_PROFILE } from './compatibility.js';
import { createLegacyMetadataStore } from '../openchamber-sessions/legacy-metadata-store.js';

const GEN = Object.freeze({ OC1: 'oc1' });
const SCOPE = Object.freeze({ PRIMARY: 'managed', OTHER: 'external:http://other' });
const DIR = 'C:/work';
const SESSION = Object.freeze({ id: 'ses_1', slug: 'one', projectID: 'prj_1', directory: DIR,
  title: 'before', version: '1.2.27', time: { created: 1, updated: 2 } });
const servers = [];
const dirs = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const serve = async (reply, requests = []) => {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://fixture');
    const record = { method: req.method, path: url.pathname, search: url.searchParams,
      headers: req.headers, body: body ? JSON.parse(body) : null };
    requests.push(record);
    const answer = await reply(record);
    res.writeHead(answer.status ?? 200, { 'content-type': 'application/json', ...(answer.headers ?? {}) });
    res.end(answer.status === 204 ? undefined : JSON.stringify(answer.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

const runtime = (endpoint, epoch = 1) => ({ generation: GEN.OC1, endpoint, epoch,
  version: '1.2.27', profile: OPENCODE_PROFILE.LEGACY });
const makeOps = (endpoint, dataDir, scope = SCOPE.PRIMARY, extra = {}) => createKernelOperations({
  getRuntime: () => runtime(endpoint), getHeaders: () => ({ authorization: 'Basic fixture' }),
  legacyMetadataStore: dataDir ? createLegacyMetadataStore({ dataDir }) : undefined,
  getStorageScope: () => scope, ...extra,
});

describe('Legacy profile write contracts', () => {
  it('keeps create metadata off the wire, rejects create-time selection, and isolates persisted metadata by scope', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-legacy-kernel-'));
    dirs.push(dataDir);
    const requests = [];
    const endpoint = await serve(({ method, path: route }) => {
      if (method === 'POST' && route === '/session') return { body: { ...SESSION, title: 'created' } };
      return { status: 404, body: { error: 'unexpected' } };
    }, requests);
    const store = createLegacyMetadataStore({ dataDir });
    const ops = makeOps(endpoint, dataDir);
    await expect(ops.createSession({ directory: DIR, title: 'created', metadata: { openchamber: { goal: 'g' } } }))
      .resolves.toMatchObject({ data: { id: SESSION.id, metadata: { openchamber: { goal: 'g' } } } });
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({ title: 'created' });
    await expect(ops.createSession({ directory: DIR, agent: 'build' })).rejects.toMatchObject({ code: 'unsupported-operation' });
    await expect(ops.createSession({ directory: DIR, model: { providerID: 'p', modelID: 'm' } }))
      .rejects.toMatchObject({ code: 'unsupported-operation' });
    expect(requests).toHaveLength(1);

    await store.patch(SCOPE.OTHER, SESSION.id, { owner: 'other' });
    const restarted = createLegacyMetadataStore({ dataDir });
    expect(await restarted.read(SCOPE.PRIMARY, SESSION.id)).toEqual({ openchamber: { goal: 'g' } });
    expect(await restarted.read(SCOPE.OTHER, SESSION.id)).toEqual({ owner: 'other' });
  });

  it('merges metadata patches and keeps successful title writes visible when metadata storage fails', async () => {
    const requests = [];
    let current = { ...SESSION, metadata: { openchamber: { keep: true, remove: true } } };
    const endpoint = await serve(({ method, path: route, body }) => {
      if (route !== `/session/${SESSION.id}`) return { status: 404, body: { error: 'unexpected' } };
      if (method === 'GET') return { body: current };
      if (method === 'PATCH') { current = { ...current, ...body }; return { body: current }; }
      return { status: 404, body: { error: 'unexpected' } };
    }, requests);
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-legacy-kernel-'));
    dirs.push(dataDir);
    const store = createLegacyMetadataStore({ dataDir });
    await store.patch(SCOPE.PRIMARY, SESSION.id, current.metadata, { replace: true });
    const merged = await makeOps(endpoint, dataDir).updateSession({ sessionID: SESSION.id, directory: DIR,
      metadata: { openchamber: { remove: null, added: 2 } } });
    expect(merged.data.metadata).toEqual({ openchamber: { keep: true, added: 2 } });
    expect(await createLegacyMetadataStore({ dataDir }).read(SCOPE.PRIMARY, SESSION.id)).toEqual(merged.data.metadata);

    const failing = makeOps(endpoint, undefined, SCOPE.PRIMARY, {
      legacyMetadataStore: { read: async () => current.metadata, patch: async () => { throw new Error('storage unavailable'); } },
    });
    await expect(failing.updateSession({ sessionID: SESSION.id, directory: DIR, title: 'renamed', metadata: { local: true } }))
      .rejects.toMatchObject({ message: 'storage unavailable', sessionID: SESSION.id, upstreamUpdated: true, partial: true });
    expect(current.title).toBe('renamed');
    expect(requests.some((item) => item.method === 'PATCH' && item.body.title === 'renamed')).toBe(true);
  });

  it('rejects corrupt metadata before an upstream session mutation', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-legacy-kernel-'));
    dirs.push(dataDir);
    const scopeDir = path.join(dataDir, 'legacy-session-metadata');
    await fs.mkdir(scopeDir, { recursive: true });
    const name = `${crypto.createHash('sha256').update(SCOPE.PRIMARY).digest('hex')}.json`;
    await fs.writeFile(path.join(scopeDir, name), '{');
    const requests = [];
    const endpoint = await serve(({ method }) => method === 'GET'
      ? { body: { ...SESSION, metadata: {} } } : { status: 500, body: { error: 'must not write upstream' } }, requests);
    await expect(makeOps(endpoint, dataDir).updateSession({ sessionID: SESSION.id, directory: DIR, title: 'blocked', metadata: { local: true } }))
      .rejects.toThrow('malformed');
    expect(requests.map((item) => item.method)).toEqual(['GET']);
  });

  it('does not write metadata after the captured runtime retires', async () => {
    const requests = [];
    const endpoint = await serve(() => ({ body: { ...SESSION, title: 'created' } }), requests);
    const state = runtime(endpoint);
    const patch = vi.fn();
    const store = { read: vi.fn(async () => ({})), patch };
    const ops = createKernelOperations({ getRuntime: () => state, getHeaders: () => ({}),
      legacyMetadataStore: store, getStorageScope: () => SCOPE.PRIMARY,
      fetchImpl: async (url, init) => {
        const response = await fetch(url, init);
        state.epoch += 1;
        return response;
      },
    });
    await expect(ops.createSession({ directory: DIR, metadata: { local: true } }))
      .rejects.toMatchObject({ code: 'runtime-changed' });
    expect(requests).toHaveLength(1);
    expect(patch).not.toHaveBeenCalled();
  });

  it('reports prompt acceptance without completion and preserves control request wire payloads and abort signals', async () => {
    const requests = [];
    const endpoint = await serve(({ path: route, method }) => {
      if (route.endsWith('/prompt_async') && method === 'POST') return { status: 204 };
      if (route.endsWith('/reply') && method === 'POST') return { body: true };
      if (route.endsWith('/reject') && method === 'POST') return { body: true };
      if (route.endsWith('/abort') && method === 'POST') return { body: true };
      return { status: 404, body: { error: 'unexpected' } };
    }, requests);
    const signals = [];
    const ops = makeOps(endpoint, undefined, SCOPE.PRIMARY, {
      fetchImpl: (url, init) => { signals.push(init?.signal ?? (url instanceof Request ? url.signal : undefined)); return fetch(url, init); },
    });
    const identity = ops.captureIdentity();
    const signal = new AbortController().signal;
    const sent = await ops.sendPrompt({ sessionID: SESSION.id, directory: DIR, signal, request: {
      ...identity, body: { model: { providerID: 'p', modelID: 'm' }, agent: 'build', parts: [{ type: 'text', text: 'hello' }] },
    } });
    expect(sent).toMatchObject({ accepted: true, data: null, profile: OPENCODE_PROFILE.LEGACY });
    await ops.replyPermission({ requestID: 'perm_1', sessionID: SESSION.id, directory: DIR, decision: 'always', signal, expectedIdentity: identity });
    await ops.replyQuestion({ requestID: 'question_1', directory: DIR, answers: [['yes']], signal, expectedIdentity: identity });
    await ops.rejectQuestion({ requestID: 'question_2', directory: DIR, signal, expectedIdentity: identity });
    await ops.interruptSession({ sessionID: SESSION.id, directory: DIR, signal });

    expect(requests.map(({ method, path: route }) => [method, route])).toEqual([
      ['POST', `/session/${SESSION.id}/prompt_async`], ['POST', '/permission/perm_1/reply'],
      ['POST', '/question/question_1/reply'], ['POST', '/question/question_2/reject'],
      ['POST', `/session/${SESSION.id}/abort`],
    ]);
    expect(requests[0].body).toEqual({ model: { providerID: 'p', modelID: 'm' }, agent: 'build',
      parts: [{ type: 'text', text: 'hello' }] });
    expect(requests[1].body).toEqual({ reply: 'always' });
    expect(requests[2].body).toEqual({ answers: [['yes']] });
    expect(requests[3].body).toBeNull();
    expect(requests.every((item) => item.search.get('directory') === DIR
      && item.headers.authorization === 'Basic fixture')).toBe(true);
    expect(signals).toHaveLength(5);
    expect(signals.every((item) => item instanceof AbortSignal && !item.aborted)).toBe(true);
  });

  it('does not retry a failed accepted-send request', async () => {
    const requests = [];
    const endpoint = await serve(() => ({ status: 503, body: { error: 'unavailable' } }), requests);
    const ops = makeOps(endpoint);
    const identity = ops.captureIdentity();
    await expect(ops.sendPrompt({ sessionID: SESSION.id, directory: DIR, request: {
      ...identity, body: { parts: [{ type: 'text', text: 'hello' }] },
    } })).rejects.toBeDefined();
    expect(requests).toHaveLength(1);
  });
});

describe('Legacy supplementary metadata service', () => {
  it('uses the Legacy store through HTTP and conditional service writes without claiming OC2 files', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-legacy-service-')); dirs.push(dataDir);
    const oldFile = path.join(dataDir, 'sessions-metadata.json');
    await fs.writeFile(oldFile, '{"ses_1":{"oc2":true}}');
    const upstream = [];
    const endpoint = await serve(() => ({ body: SESSION }), upstream);
    const kernelOperations = makeOps(endpoint, dataDir);
    const events = [];
    const dependencies = { kernelOperations, dataDir, broadcastGlobalUiEvent: event => events.push(event) };
    const app = express(); registerOpenChamberSessionRoutes(app, dependencies);
    const written = await request(app).post('/api/openchamber/sessions/ses_1/metadata')
      .send({ directory: DIR, patch: { openchamber: { keep: 1, remove: 2 } } }).expect(200);
    expect(written.body.metadata).toEqual({ openchamber: { keep: 1, remove: 2 } });
    const service = createOpenChamberSessionService(dependencies);
    const changed = await service.updateMetadata('ses_1', current => ({ openchamber: { keep: current.openchamber.keep + 1, remove: null } }), { directory: DIR });
    expect(changed).toEqual({ metadata: { openchamber: { keep: 2 } }, changed: true });
    expect(await service.updateMetadata('ses_1', () => null, { directory: DIR }))
      .toEqual({ metadata: changed.metadata, changed: false });
    const read = await request(app).get('/api/openchamber/sessions/ses_1/metadata').query({ directory: DIR }).expect(200);
    expect(read.body.metadata).toEqual(changed.metadata);
    expect(events).toHaveLength(2);
    expect(upstream.every(item => item.method === 'GET')).toBe(true);
    expect(await fs.readFile(oldFile, 'utf8')).toBe('{"ses_1":{"oc2":true}}');
    expect(await fs.readdir(dataDir)).toEqual(expect.arrayContaining(['sessions-metadata.json', 'legacy-session-metadata']));
    expect(await fs.readdir(dataDir)).not.toContain('sessions-storage-owner.json');
  });

  it.each([true, false])('reports create rollback accurately when deletion returns %s', async removed => {
    const requests = [];
    const endpoint = await serve(({ method }) => ({ body: method === 'DELETE' ? removed : SESSION }), requests);
    const ops = makeOps(endpoint, undefined, SCOPE.PRIMARY, {
      legacyMetadataStore: { read: async () => ({}), patch: async () => { throw new Error('disk full'); } },
    });
    await expect(ops.createSession({ directory: DIR, metadata: { local: true } }))
      .rejects.toMatchObject({ message: 'disk full', createdSessionID: SESSION.id, rolledBack: removed, cleanupFailed: !removed, partial: !removed });
    expect(requests.map(item => item.method)).toEqual(['POST', 'DELETE']);
  });
});
