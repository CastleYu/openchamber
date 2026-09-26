import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernelOperations } from './kernel-operations.js';
import { createOpenCodeSessionMetadata, createSessionMetadataStore } from '../openchamber-sessions/session-metadata-store.js';

const servers = [];
const directories = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const serve = async (reply, requests = []) => {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://fixture');
    const record = { method: req.method, path: url.pathname, search: url.searchParams, headers: req.headers, body: body ? JSON.parse(body) : null };
    requests.push(record);
    const answer = await reply(record);
    res.writeHead(answer.status ?? 200, { 'content-type': 'application/json', ...(answer.headers ?? {}) });
    res.end(answer.status === 204 ? undefined : JSON.stringify(answer.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

const oc1Session = { id: 'ses_1', slug: 'one', projectID: 'prj_1', directory: 'C:/work', title: 'one', version: '1.18.32', time: { created: 1, updated: 2 } };
const oc2Session = {
  id: 'ses_2', projectID: 'prj_2', title: 'two', cost: { amount: 0, currency: 'USD' },
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 }, location: { directory: 'C:/work' },
};

const runtime = (generation, endpoint, epoch = 1) => ({ generation, endpoint, epoch, version: generation === 'oc1' ? '1.18.32' : '2.0.16' });

describe('server kernel operations', () => {
  it('keeps permission, message and synthetic operations on their generation routes', async () => {
    for (const generation of ['oc1', 'oc2']) {
      const requests = [];
      const endpoint = await serve(({ path: route, method }) => {
        if (route === '/permission' || route === '/api/permission/request') return { body: generation === 'oc1'
          ? [{ id: 'perm_1', sessionID: 'ses_1' }]
          : { data: [{ id: 'perm_1', sessionID: 'ses_1' }] } };
        if (route.endsWith('/reply')) return { body: generation === 'oc1' ? true : undefined, status: generation === 'oc1' ? 200 : 204 };
        if (route.endsWith('/message/msg_1')) return { body: generation === 'oc1'
          ? { info: { id: 'msg_1', role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }
          : { data: { id: 'msg_1', type: 'user', text: 'hi' } } };
        if (route.endsWith('/synthetic') && method === 'POST') return { body: { data: { id: 'msg_2', type: 'synthetic' } } };
        return { status: 404, body: { error: 'unexpected' } };
      }, requests);
      const ops = createKernelOperations({ getRuntime: () => runtime(generation, endpoint), getHeaders: () => ({}) });
      expect((await ops.listPendingPermissions({ directory: 'C:/work' })).data).toHaveLength(1);
      await ops.replyPermission({ requestID: 'perm_1', sessionID: 'ses_1', directory: 'C:/work', expectedIdentity: ops.captureIdentity() });
      expect((await ops.getMessage({ sessionID: 'ses_1', messageID: 'msg_1', directory: 'C:/work' })).data).toBeTruthy();
      if (generation === 'oc2') await ops.addSynthetic({ sessionID: 'ses_1', directory: 'C:/work', text: 'restored', expectedIdentity: ops.captureIdentity() });
      expect(requests.some((item) => item.path.startsWith(generation === 'oc1' ? '/api/' : '/session/'))).toBe(false);
      if (generation === 'oc2') expect(requests.find((item) => item.path.endsWith('/reply')).body).toEqual({ decision: 'once' });
    }
  });
  it('prepares legacy OC2 metadata once before concurrent autonomous read and delete patch', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc2-kernel-metadata-'));
    directories.push(dataDir);
    await fs.writeFile(path.join(dataDir, 'sessions-metadata.json'), JSON.stringify({
      ses_2: { openchamber: { goal: 'old', assist: 'keep' } },
    }));
    const requests = [];
    let metadata = { stale: true };
    const endpoint = await serve(({ path: route, method, body }) => {
      if (route !== '/api/session/ses_2') return { status: 404, body: { error: 'missing' } };
      if (method === 'GET') return { body: { data: { ...oc2Session, metadata } } };
      if (method === 'PATCH') {
        metadata = body.metadata;
        return { status: 204 };
      }
      return { status: 404, body: { error: 'missing' } };
    }, requests);
    let store;
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({}),
      prepareSession: ({ sessionID, directory, identity: expectedIdentity }) =>
        store.ensureMigrated(sessionID, { directory, expectedIdentity }),
    });
    store = createSessionMetadataStore({ dataDir,
      openCode: createOpenCodeSessionMetadata({ kernelOperations: ops }) });
    const [read] = await Promise.all([
      ops.getSession({ sessionID: 'ses_2', directory: 'C:/work' }),
      ops.updateSession({ sessionID: 'ses_2', directory: 'C:/work',
        metadata: { openchamber: { goal: null, pins: ['a'] } } }),
    ]);
    expect(read.data.metadata.openchamber.assist).toBe('keep');
    expect(metadata).toEqual({ openchamber: { assist: 'keep', pins: ['a'] } });
    expect(requests.filter((item) => item.method === 'PATCH').map((item) => item.body.metadata)).toEqual([
      { openchamber: { goal: 'old', assist: 'keep' } },
      { openchamber: { assist: 'keep', pins: ['a'] } },
    ]);
    expect(await store.listUnmigrated()).toEqual({});
  });

  it('rejects a runtime switch during preparation before reading or mutating the new endpoint', async () => {
    const requests = [];
    const endpoint = await serve(() => ({ status: 500, body: { error: 'must not dispatch' } }), requests);
    let state = runtime('oc2', endpoint, 1);
    const ops = createKernelOperations({ getRuntime: () => state, getHeaders: () => ({}),
      prepareSession: async () => { state = runtime('oc2', endpoint, 2); },
    });
    await expect(ops.getSession({ sessionID: 'ses_2', directory: 'C:/work' }))
      .rejects.toMatchObject({ code: 'runtime-changed' });
    state = runtime('oc2', endpoint, 1);
    await expect(ops.updateSession({ sessionID: 'ses_2', directory: 'C:/work', metadata: { a: 1 } }))
      .rejects.toMatchObject({ code: 'runtime-changed' });
    expect(requests).toEqual([]);
  });

  it('never prepares OC1 session metadata', async () => {
    const endpoint = await serve(({ method }) => method === 'GET'
      ? { body: oc1Session } : { body: oc1Session });
    const prepareSession = vi.fn();
    const ops = createKernelOperations({ getRuntime: () => runtime('oc1', endpoint),
      getHeaders: () => ({}), prepareSession });
    await ops.getSession({ sessionID: 'ses_1', directory: 'C:/work' });
    await ops.updateSession({ sessionID: 'ses_1', directory: 'C:/work', metadata: { openchamber: { goal: 1 } } });
    expect(prepareSession).not.toHaveBeenCalled();
  });
  it('loads a tagged OC1 selection catalog through SDK endpoints', async () => {
    const requests = [];
    const endpoint = await serve(({ path }) => {
      if (path === '/config/providers') return { body: { providers: [{ id: 'openai', models: { m: { id: 'm' } } }] } };
      if (path === '/agent') return { body: [{ name: 'build', mode: 'primary' }] };
      if (path === '/config') return { body: { default_agent: 'build', model: 'openai/m' } };
      return { status: 404, body: { error: 'missing' } };
    }, requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc1', endpoint), getHeaders: () => ({}) });
    const catalog = (await ops.getSelectionCatalog({ directory: 'C:/work' })).data;
    expect(catalog).toMatchObject({ generation: 'oc1', providers: [{ id: 'openai' }],
      agents: [{ name: 'build' }], config: { model: 'openai/m' } });
    expect(requests.map((item) => item.path).sort()).toEqual(['/agent', '/config', '/config/providers']);
  });

  it('loads a tagged OC2 flat model catalog and ordered config entries', async () => {
    const requests = [];
    const endpoint = await serve(({ path }) => {
      if (path === '/api/integration') return { body: { location: { directory: 'C:/work' }, data: [] } };
      if (path === '/api/model') return { body: { location: { directory: 'C:/work' }, data: [{ providerID: 'openai', modelID: 'm' }] } };
      if (path === '/api/agent') return { body: { location: { directory: 'C:/work' }, data: [{ id: 'build', name: 'Build' }] } };
      if (path === '/api/config') return { body: [
        { type: 'directory', path: 'C:/work' },
        { type: 'document', info: { default_agent: 'build' } },
      ] };
      return { status: 404, body: { error: 'missing' } };
    }, requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({}) });
    const catalog = (await ops.getSelectionCatalog({ directory: 'C:/work' })).data;
    expect(catalog).toMatchObject({ generation: 'oc2', models: [{ providerID: 'openai', modelID: 'm' }],
      agents: [{ id: 'build' }], config: [
        { type: 'directory', path: 'C:/work' },
        { type: 'document', info: { default_agent: 'build' } },
      ] });
    expect(requests.every((item) => item.search.get('location[directory]') === 'C:/work')).toBe(true);
    expect(requests.every((item) => item.headers['x-opencode-directory'] === 'C%3A%2Fwork')).toBe(true);
    expect(requests[0].path).toBe('/api/integration');
  });

  it('passes OC2 catalog abort signal as SDK request options and rejects malformed config', async () => {
    const requests = [];
    const signal = new AbortController().signal;
    const runtimeState = runtime('oc2', 'http://127.0.0.1:4097');
    const fetchImpl = async (url, init) => {
      requests.push({ path: new URL(url).pathname, search: new URL(url).searchParams, signal: init.signal });
      if (new URL(url).pathname === '/api/integration') return Response.json({ location: { directory: 'C:/work' }, data: [] });
      if (new URL(url).pathname === '/api/model') return Response.json({ location: { directory: 'C:/work' }, data: [] });
      if (new URL(url).pathname === '/api/agent') return Response.json({ location: { directory: 'C:/work' }, data: [] });
      return Response.json([{ type: 'directory', path: 'C:/work' }, { type: 'document', info: {} }]);
    };
    const ops = createKernelOperations({ getRuntime: () => runtimeState, getHeaders: () => ({}), fetchImpl });
    expect((await ops.getSelectionCatalog({ directory: 'C:/work', signal })).data.config).toEqual([
      { type: 'directory', path: 'C:/work' }, { type: 'document', info: {} },
    ]);
    expect(requests.map((item) => item.path).sort()).toEqual(['/api/agent', '/api/config', '/api/integration', '/api/model']);
    expect(requests.every((item) => item.search.get('location[directory]') === 'C:/work')).toBe(true);
    expect(requests.every((item) => item.signal === signal)).toBe(true);

    const bad = createKernelOperations({ getRuntime: () => runtimeState, getHeaders: () => ({}),
      fetchImpl: async (url, init) => new URL(url).pathname === '/api/config'
        ? Response.json({ wrong: true }) : fetchImpl(url, init) });
    await expect(bad.getSelectionCatalog({ directory: 'C:/work' })).rejects.toThrow();
  });

  it('waits for OC2 plugin activation before reading catalogs and rejects a changed runtime', async () => {
    const requests = [];
    let state = runtime('oc2', 'http://127.0.0.1:4097');
    const fetchImpl = async (url) => {
      const path = new URL(url).pathname;
      requests.push(path);
      if (path === '/api/integration') {
        state = runtime('oc2', state.endpoint, state.epoch + 1);
        return Response.json({ location: { directory: 'C:/work' }, data: [] });
      }
      return Response.json({ location: { directory: 'C:/work' }, data: [] });
    };
    const ops = createKernelOperations({ getRuntime: () => state, getHeaders: () => ({}), fetchImpl });
    await expect(ops.getSelectionCatalog({ directory: 'C:/work' }))
      .rejects.toMatchObject({ code: 'runtime-changed' });
    expect(requests).toEqual(['/api/integration']);
  });

  it('does not treat a failed OC2 activation barrier as an empty catalog', async () => {
    const requests = [];
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', 'http://127.0.0.1:4097'),
      getHeaders: () => ({}), fetchImpl: async (url) => {
        requests.push(new URL(url).pathname);
        return Response.json({ error: 'activation failed' }, { status: 500 });
      } });
    await expect(ops.getSelectionCatalog({ directory: 'C:/work' })).rejects.toThrow();
    expect(requests).toEqual(['/api/integration']);
  });

  it('writes OC1 archived time and rejects that mutation on OC2', async () => {
    const requests = [];
    const endpoint = await serve(({ path, method }) => {
      if (path === '/session/ses_1' && method === 'PATCH') return { body: oc1Session };
      return { status: 404, body: { error: 'missing' } };
    }, requests);
    const legacy = createKernelOperations({ getRuntime: () => runtime('oc1', endpoint), getHeaders: () => ({}) });
    await legacy.updateSession({ sessionID: 'ses_1', directory: 'C:/work', time: { archived: 1700 },
      expectedIdentity: legacy.captureIdentity() });
    expect(requests.find((item) => item.method === 'PATCH').body.time).toEqual({ archived: 1700 });
    const current = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({}) });
    await expect(current.updateSession({ sessionID: 'ses_1', time: { archived: 1700 } }))
      .rejects.toMatchObject({ code: 'unsupported-operation' });
  });
  it('lists OC2 child sessions across authoritative pages', async () => {
    const requests = [];
    const endpoint = await serve(({ path, search }) => path === '/api/session'
      ? { body: search.get('cursor')
        ? { data: [{ ...oc2Session, id: 'ses_child', parentID: 'ses_2' }], cursor: { next: null } }
        : { data: [oc2Session], cursor: { next: 'second' } } }
      : { status: 404, body: { error: 'missing' } }, requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({}) });
    expect(ops.captureIdentity()).toMatchObject({ generation: 'oc2', endpoint, epoch: 1 });
    expect((await ops.listChildren({ sessionID: 'ses_2', directory: 'C:/work' })).data.map((item) => item.id)).toEqual(['ses_child']);
    expect(requests.map((request) => request.search.get('cursor'))).toEqual([null, 'second']);
  });

  it('merges OC2 metadata against a fresh record and applies null deletion', async () => {
    const requests = [];
    const endpoint = await serve(({ path, method }) => path === '/api/session/ses_2' && method === 'GET'
      ? { body: { data: { ...oc2Session, metadata: { openchamber: { assist: 'keep', goal: 'old' }, other: 1 } } } }
      : path === '/api/session/ses_2' && method === 'PATCH' ? { status: 204 }
        : { status: 404, body: { error: 'missing' } }, requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({}) });
    await ops.updateSession({ sessionID: 'ses_2', directory: 'C:/work', metadata: { openchamber: { goal: null, pins: ['a'] } } });
    expect(requests.find((request) => request.method === 'PATCH').body.metadata).toEqual({
      openchamber: { assist: 'keep', pins: ['a'] }, other: 1,
    });
  });

  it('rejects an old goal metadata write before touching the restarted runtime', async () => {
    const requests = [];
    const endpoint = await serve(() => ({ status: 500, body: { error: 'must not dispatch' } }), requests);
    const current = runtime('oc2', endpoint, 2);
    const ops = createKernelOperations({ getRuntime: () => current, getHeaders: () => ({}) });
    await expect(ops.updateSession({ sessionID: 'ses_2', directory: 'C:/work',
      metadata: { openchamber: { goal: { status: 'complete' } } },
      expectedIdentity: { ...current, epoch: 1 } })).rejects.toMatchObject({ code: 'runtime-changed' });
    expect(requests).toEqual([]);
  });
  it('uses OC1 SDK routes, directory query and 204 prompt acceptance', async () => {
    const requests = [];
    const endpoint = await serve(({ method, path }) => {
      if (path === '/session' && method === 'POST') return { body: oc1Session };
      if (path === '/session' && method === 'GET') return { body: [oc1Session] };
      if (path === '/session/ses_1/message') return {
        headers: { 'x-next-cursor': 'old_1' },
        body: [{ info: { id: 'msg_1', role: 'assistant', parentID: 'user_1', time: { created: 5, completed: 6 }, finish: 'stop' },
          parts: [{ id: 'prt_1', type: 'text', text: 'done' }, { id: 'prt_2', type: 'tool', tool: 'read', state: { status: 'completed' } }] }],
      };
      if (path === '/session/status') return { body: { ses_1: { type: 'busy' } } };
      if (path === '/session/ses_1/prompt_async') return { status: 204 };
      return { status: 404, body: { error: 'missing' } };
    }, requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc1', endpoint), getHeaders: () => ({ Authorization: 'Basic fixture' }) });
    expect((await ops.createSession({ directory: 'C:/work', title: 'one' })).data.directory).toBe('C:/work');
    expect((await ops.listSessions({ directory: 'C:/work' })).data.items.map((item) => item.id)).toEqual(['ses_1']);
    await ops.listSessions({ directory: 'C:/work', cursor: 3 });
    const page = (await ops.listMessages({ sessionID: 'ses_1', directory: 'C:/work', limit: 20 })).data;
    expect(page.items[0]).toMatchObject({ id: 'msg_1', role: 'assistant', text: 'done', completed: 6, parentID: 'user_1', tools: [{ name: 'read', status: 'completed' }] });
    expect(page.cursor.next).toBe('old_1');
    expect((await ops.getSessionStatus({ sessionID: 'ses_1', directory: 'C:/work' })).data).toEqual({ type: 'busy' });
    const sent = await ops.sendPrompt({ sessionID: 'ses_1', directory: 'C:/work', request: { generation: 'oc1', endpoint, epoch: 1, body: { model: { providerID: 'p', modelID: 'm' }, parts: [{ type: 'text', text: 'hello' }] } } });
    expect(sent).toMatchObject({ generation: 'oc1', accepted: true });
    expect(sent.data).toBeNull();
    expect(requests.find((request) => request.path.endsWith('/prompt_async'))).toMatchObject({ method: 'POST', body: { model: { providerID: 'p', modelID: 'm' }, parts: [{ type: 'text', text: 'hello' }] } });
    expect(requests.every((request) => request.headers.authorization === 'Basic fixture' && request.search.get('directory') === 'C:/work')).toBe(true);
    expect(requests.find((request) => request.path === '/session' && request.search.get('start') === '3')).toBeDefined();
  });

  it('uses OC2 SDK routes, encoded directory header, cursors and ordered send stages', async () => {
    const requests = [];
    const endpoint = await serve(({ method, path }) => {
      if (path === '/api/session' && method === 'POST') return { body: { data: oc2Session } };
      if (path === '/api/session' && method === 'GET') return { body: { data: [oc2Session], cursor: { next: 'next_1' } } };
      if (path === '/api/session/ses_2/message') return { body: { data: [{ id: 'msg_2', type: 'user', text: 'hello', time: { created: 8 } }], cursor: { next: 'next_2' } } };
      if (path === '/api/session/active') return { body: { data: {} } };
      if (path === '/api/session/ses_2/model' || path === '/api/session/ses_2/agent') return { status: 204 };
      if (path === '/api/session/ses_2/synthetic') return { body: { data: { id: 'inbox_context' } } };
      if (path === '/api/session/ses_2/prompt') return { body: { data: { id: 'inbox_1', type: 'user' } } };
      return { status: 404, body: { error: 'missing' } };
    }, requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => new Headers({ Authorization: 'Bearer fixture' }) });
    expect((await ops.createSession({ directory: 'C:/work', title: 'two' })).data.directory).toBe('C:/work');
    const sessions = (await ops.listSessions({ directory: 'C:/work', cursor: 'start_1' })).data;
    expect(sessions.cursor.next).toBe('next_1');
    const messages = (await ops.listMessages({ sessionID: 'ses_2', directory: 'C:/work', cursor: 'old_2' })).data;
    expect(messages.items[0]).toMatchObject({ id: 'msg_2', role: 'user', text: 'hello', created: 8 });
    expect(messages.cursor.next).toBe('next_2');
    expect((await ops.getSessionStatus({ sessionID: 'ses_2', directory: 'C:/work' })).data).toEqual({ type: 'idle' });
    const sent = await ops.sendPrompt({ sessionID: 'ses_2', directory: 'C:/work', request: {
      generation: 'oc2', endpoint, epoch: 1, model: { id: 'm', providerID: 'p' }, agent: 'build', synthetics: [{ text: 'context', resume: false }], body: { text: 'hello' },
    } });
    expect(sent).toMatchObject({ generation: 'oc2', accepted: true, data: { id: 'inbox_1' } });
    expect(requests.slice(-4).map((request) => request.path)).toEqual([
      '/api/session/ses_2/model', '/api/session/ses_2/agent', '/api/session/ses_2/synthetic', '/api/session/ses_2/prompt',
    ]);
    expect(requests.every((request) => request.headers.authorization === 'Bearer fixture' && request.headers['x-opencode-directory'] === 'C%3A%2Fwork')).toBe(true);
    expect(requests.find((request) => request.path === '/api/session' && request.method === 'GET').search.get('cursor')).toBe('start_1');
    expect(requests.find((request) => request.path.endsWith('/message')).search.get('cursor')).toBe('old_2');
    await expect(ops.listSessions({ directory: 'C:/work', cursor: 3 })).rejects.toMatchObject({ code: 'invalid-cursor' });
  });

  it('throws on HTTP failure instead of returning authoritative empty data', async () => {
    const endpoint = await serve(() => ({ status: 500, body: { error: 'failed' } }));
    for (const generation of ['oc1', 'oc2']) {
      const ops = createKernelOperations({ getRuntime: () => runtime(generation, endpoint), getHeaders: () => ({}) });
      await expect(ops.listMessages({ sessionID: 'ses_1', directory: 'C:/work' })).rejects.toThrow();
    }
  });

  it('rejects a 200 response missing required pagination instead of treating it as empty success', async () => {
    const endpoint = await serve(({ path }) => path === '/api/session'
      ? { body: { data: [] } } : { body: { data: { id: 'ses_2' } } });
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({}) });
    await expect(ops.listSessions({ directory: 'C:/work' })).rejects.toThrow();
  });

  it('maps only a confirmed OC2 running entry to busy', async () => {
    const endpoint = await serve(() => ({ body: { data: { ses_2: { type: 'running' } } } }));
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({}) });
    expect((await ops.getSessionStatus({ sessionID: 'ses_2' })).data).toEqual({ type: 'busy' });
    expect((await ops.getSessionStatus({ sessionID: 'another' })).data).toEqual({ type: 'idle' });
  });

  it('stops an OC2 send before prompt when model selection fails', async () => {
    const requests = [];
    const endpoint = await serve(() => ({ status: 500, body: { error: 'model unavailable' } }), requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({}) });
    await expect(ops.sendPrompt({ sessionID: 'ses_2', directory: 'C:/work', request: {
      generation: 'oc2', endpoint, epoch: 1, model: { id: 'm', providerID: 'p' }, body: { text: 'hello' },
    } })).rejects.toThrow();
    expect(requests.map((request) => request.path)).toEqual(['/api/session/ses_2/model']);
  });

  it('preserves OC1 control routes and original metadata writes', async () => {
    const requests = [];
    const endpoint = await serve(({ method, path }) => {
      if (path === '/session/ses_1' && method === 'GET') return { body: oc1Session };
      if (path === '/session/ses_1' && method === 'PATCH') return { body: { ...oc1Session, title: 'renamed' } };
      if (path === '/session/ses_1/fork') return { body: { ...oc1Session, id: 'ses_child' } };
      if (path === '/session/ses_1/abort') return { body: true };
      if (path === '/session/ses_1/command') return { body: { info: { id: 'cmd_1' }, parts: [] } };
      if (path === '/command') return { body: [{ name: 'review', template: 'review $ARGUMENTS' }] };
      return { status: 404, body: { error: 'missing' } };
    }, requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc1', endpoint), getHeaders: () => ({ Authorization: 'Basic fixture' }) });
    expect((await ops.getSession({ sessionID: 'ses_1', directory: 'C:/work' })).data.id).toBe('ses_1');
    expect((await ops.listCommands({ directory: 'C:/work' })).data[0].template).toBe('review $ARGUMENTS');
    expect((await ops.forkSession({ sessionID: 'ses_1', directory: 'C:/work', messageID: 'msg_1' })).data.id).toBe('ses_child');
    await ops.updateSession({ sessionID: 'ses_1', directory: 'C:/work', title: 'renamed', metadata: { openchamber: { goal: 'test' } } });
    await ops.sendCommand({ sessionID: 'ses_1', directory: 'C:/work', request: { generation: 'oc1', endpoint, epoch: 1, body: { command: 'review', arguments: 'x', model: 'p/m' } } });
    expect((await ops.interruptSession({ sessionID: 'ses_1', directory: 'C:/work' })).data).toBe(true);
    expect(requests.find((request) => request.path.endsWith('/fork')).body).toEqual({ messageID: 'msg_1' });
    expect(requests.find((request) => request.method === 'PATCH').body.metadata).toEqual({ openchamber: { goal: 'test' } });
    expect(requests.find((request) => request.path.endsWith('/command') && request.method === 'POST').body).toMatchObject({ command: 'review', arguments: 'x', model: 'p/m' });
    expect(requests.every((request) => request.search.get('directory') === 'C:/work')).toBe(true);
  });

  it('preserves OC2 control routes and metadata writes', async () => {
    const requests = [];
    const endpoint = await serve(({ method, path }) => {
      if (path === '/api/session/ses_2' && method === 'GET') return { body: { data: oc2Session } };
      if (path === '/api/session/ses_2' && method === 'PATCH') return { status: 204 };
      if (path === '/api/session/ses_2/fork') return { body: { data: { ...oc2Session, id: 'ses_child' } } };
      if (path === '/api/session/ses_2/interrupt') return { body: { interrupted: true } };
      if (path === '/api/session/ses_2/command') return { status: 204 };
      if (path === '/api/command') return { body: { location: { directory: 'C:/work' }, data: [{ name: 'review' }] } };
      return { status: 404, body: { error: 'missing' } };
    }, requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({ Authorization: 'Bearer fixture' }) });
    expect((await ops.getSession({ sessionID: 'ses_2', directory: 'C:/work' })).data.directory).toBe('C:/work');
    expect((await ops.listCommands({ directory: 'C:/work' })).data.map((item) => item.name)).toEqual(['review']);
    expect((await ops.forkSession({ sessionID: 'ses_2', directory: 'C:/work', messageID: 'msg_2' })).data.id).toBe('ses_child');
    await ops.updateSession({ sessionID: 'ses_2', directory: 'C:/work', title: 'renamed' });
    await ops.updateSession({ sessionID: 'ses_2', directory: 'C:/work', metadata: { goal: 'test' } });
    await expect(ops.createSession({ directory: 'C:/work', parentID: 'ses_2' })).rejects.toMatchObject({ code: 'unsupported-operation' });
    await ops.sendCommand({ sessionID: 'ses_2', directory: 'C:/work', request: { generation: 'oc2', endpoint, epoch: 1, body: { name: 'review', text: 'x' } } });
    expect((await ops.interruptSession({ sessionID: 'ses_2', directory: 'C:/work' })).data).toEqual({ interrupted: true });
    expect(requests.find((request) => request.path.endsWith('/fork')).body).toEqual({ before: 'msg_2' });
    expect(requests.find((request) => request.method === 'PATCH').body.title).toBe('renamed');
    expect(requests.find((request) => request.method === 'PATCH' && request.body.metadata).body.metadata).toEqual({ goal: 'test' });
    expect(requests.find((request) => request.path.endsWith('/command') && request.method === 'POST').body).toMatchObject({ name: 'review', text: 'x' });
    expect(requests.every((request) => request.headers['x-opencode-directory'] === 'C%3A%2Fwork')).toBe(true);
  });

  it('removes only an OC2 fork on the captured runtime for rollback', async () => {
    const requests = [];
    const endpoint = await serve(({ method, path }) => path === '/api/session/ses_child' && method === 'DELETE'
      ? { status: 204 } : { status: 404, body: { error: 'missing' } }, requests);
    let selected = runtime('oc2', endpoint, 1);
    const ops = createKernelOperations({ getRuntime: () => selected, getHeaders: () => ({}) });
    const captured = ops.captureIdentity();
    expect((await ops.removeSession({ sessionID: 'ses_child', directory: 'C:/work', expectedIdentity: captured })).data).toBe(true);
    expect(requests.map((request) => [request.method, request.path])).toEqual([['DELETE', '/api/session/ses_child']]);
    expect(requests[0].headers['x-opencode-directory']).toBe('C%3A%2Fwork');
    selected = runtime('oc2', endpoint, 2);
    await expect(ops.removeSession({ sessionID: 'ses_child', directory: 'C:/work', expectedIdentity: captured }))
      .rejects.toMatchObject({ code: 'runtime-changed' });
    expect(requests).toHaveLength(1);
    selected = runtime('oc1', endpoint, 1);
    await expect(ops.removeSession({ sessionID: 'ses_child', directory: 'C:/work', expectedIdentity: ops.captureIdentity() }))
      .rejects.toMatchObject({ code: 'unsupported-operation' });
    expect(requests).toHaveLength(1);
  });

  it('discards a read whose endpoint epoch changes before it returns', async () => {
    const endpoint = await serve(() => ({ body: { data: oc2Session } }));
    let selected = runtime('oc2', endpoint, 1);
    const fetchImpl = async (url, init) => {
      const response = await fetch(url, init);
      selected = runtime('oc2', endpoint, 2);
      return response;
    };
    const ops = createKernelOperations({ getRuntime: () => selected, getHeaders: () => ({}), fetchImpl });
    await expect(ops.getSession({ sessionID: 'ses_2', directory: 'C:/work' })).rejects.toMatchObject({ code: 'runtime-changed' });
  });

  it.each(['sendPrompt', 'sendCommand'])('does not dispatch %s after switching during preparation', async (method) => {
    const requests = [];
    const endpoint = await serve(() => ({ body: {} }), requests);
    let selected = runtime('oc2', endpoint, 1);
    const ops = createKernelOperations({ getRuntime: () => selected, getHeaders: () => ({}) });
    const pending = ops[method]({
      sessionID: 'ses_2',
      request: { ...selected, body: { text: 'must not send', name: 'review' } },
    });
    selected = runtime('oc2', endpoint, 2);
    await expect(pending).rejects.toMatchObject({ code: 'runtime-changed' });
    expect(requests).toEqual([]);
  });

  it('rejects unsupported generation, stale send requests and unknown activity', async () => {
    const endpoint = await serve(({ path }) => path === '/api/session/active'
      ? { body: { data: { ses_2: { type: 'surprise' } } } } : { status: 404, body: {} });
    const getHeaders = () => ({});
    const unsupported = createKernelOperations({ getRuntime: () => runtime('unknown', endpoint), getHeaders });
    await expect(unsupported.getSession({ sessionID: 'ses_2' })).rejects.toMatchObject({ code: 'unsupported-generation' });
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders });
    await expect(ops.sendPrompt({ sessionID: 'ses_2', request: { generation: 'oc1', endpoint, epoch: 1, body: { parts: [] } } })).rejects.toMatchObject({ code: 'runtime-changed' });
    await expect(ops.sendPrompt({ sessionID: 'ses_2', request: { generation: 'oc2', endpoint, epoch: 0, body: { text: 'old' } } })).rejects.toMatchObject({ code: 'runtime-changed' });
    await expect(ops.getSessionStatus({ sessionID: 'ses_2' })).rejects.toMatchObject({ code: 'unknown-status' });
  });
});
