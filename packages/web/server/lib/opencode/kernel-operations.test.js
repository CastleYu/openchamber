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
  it('normalizes ordered message text and optional model and agent fields for both generations', async () => {
    for (const generation of ['oc1', 'oc2']) {
      const endpoint = await serve(({ path: route }) => {
        if (route.endsWith('/message')) return { body: generation === 'oc1'
          ? [
            { info: { id: 'msg_1', role: 'assistant', mode: 'legacy-agent', variant: 'legacy-variant' },
              parts: [{ type: 'text', text: '' }, { type: 'reasoning', text: 'skip' }, { type: 'text', text: 'one' }, { type: 'text', text: 'two' }] },
            { info: { id: 'msg_2', role: 'user' }, parts: [] },
            { info: { id: 'msg_3', role: 'assistant' }, parts: [] },
          ]
          : { data: [
            { id: 'msg_1', type: 'assistant', agent: 'current-agent', model: { providerID: 'p', modelID: 'm', variant: 'current-variant' },
              content: [{ type: 'text', text: '' }, { type: 'reasoning', text: 'skip' }, { type: 'text', text: 'one' }, { type: 'text', text: 'two' }] },
            { id: 'msg_2', type: 'user', text: '' },
            { id: 'msg_3', type: 'synthetic', text: 'restored' },
          ], cursor: { previous: null, next: null } } };
        return { status: 404, body: { error: 'missing' } };
      });
      const ops = createKernelOperations({ getRuntime: () => runtime(generation, endpoint), getHeaders: () => ({}) });
      const page = (await ops.listMessages({ sessionID: generation === 'oc1' ? 'ses_1' : 'ses_2', directory: 'C:/work' })).data;
      const view = page.items.find((item) => item.id === 'msg_1');
      expect(view).toMatchObject({ text: 'onetwo', textParts: ['', 'one', 'two'],
        agent: generation === 'oc1' ? 'legacy-agent' : 'current-agent',
        variant: generation === 'oc1' ? 'legacy-variant' : 'current-variant' });
      const sparse = page.items.find((item) => item.id === 'msg_2');
      expect(sparse).not.toHaveProperty('agent');
      expect(sparse).not.toHaveProperty('variant');
      expect(sparse.textParts).toEqual(generation === 'oc1' ? [] : ['']);
      if (generation === 'oc2') expect(page.items.find((item) => item.id === 'msg_3')).toMatchObject({ text: 'restored', textParts: ['restored'] });
    }
  });

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
      expect((await ops.getMessage({ sessionID: 'ses_1', messageID: 'msg_1', directory: 'C:/work' })).data).toEqual(generation === 'oc1'
        ? { info: { id: 'msg_1', role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }
        : { id: 'msg_1', type: 'user', text: 'hi' });
      if (generation === 'oc2') await ops.addSynthetic({ sessionID: 'ses_1', directory: 'C:/work', text: 'restored', expectedIdentity: ops.captureIdentity() });
      expect(requests.some((item) => item.path.startsWith(generation === 'oc1' ? '/api/' : '/session/'))).toBe(false);
      if (generation === 'oc2') expect(requests.find((item) => item.path.endsWith('/reply')).body).toEqual({ decision: 'once' });
    }
  });
  it('projects single assistant messages with ordered text parts through both SDK routes', async () => {
    for (const generation of ['oc1', 'oc2']) {
      const requests = [];
      const record = generation === 'oc1'
        ? { info: { id: 'msg_1', role: 'assistant' }, parts: [{ type: 'text', text: '![one](one.png)' }, { type: 'text', text: '![two](two.png)' }] }
        : { id: 'msg_1', type: 'assistant', content: [{ type: 'text', text: '![one](one.png)' }, { type: 'text', text: '![two](two.png)' }] };
      const endpoint = await serve(() => ({ body: generation === 'oc1' ? record : { data: record } }), requests);
      const ops = createKernelOperations({ getRuntime: () => runtime(generation, endpoint), getHeaders: () => ({}) });
      const result = await ops.getMessageView({ sessionID: 'ses_1', messageID: 'msg_1', directory: 'C:/work' });
      expect(result.data).toMatchObject({ id: 'msg_1', role: 'assistant', textParts: ['![one](one.png)', '![two](two.png)'] });
      expect(requests).toHaveLength(1);
      expect(requests[0].path).toBe(generation === 'oc1' ? '/session/ses_1/message/msg_1' : '/api/session/ses_1/message/msg_1');
      if (generation === 'oc1') expect(requests[0].search.get('directory')).toBe('C:/work');
      else expect(requests[0].headers['x-opencode-directory']).toBe(encodeURIComponent('C:/work'));
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

  it('decides OC2 work changes in the same queue as a user metadata write', async () => {
    let metadata = { openchamber: { work: { state: 'open' }, goal: 'keep' } };
    const requests = [];
    const endpoint = await serve(({ method, body }) => {
      if (method === 'PATCH') {
        metadata = body.metadata;
        return { status: 204 };
      }
      return { body: { data: { ...oc2Session, metadata } } };
    }, requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({}) });
    const identity = ops.captureIdentity();
    const done = ops.updateSession({ sessionID: 'ses_2', metadata: { openchamber: { work: { state: 'done' } } }, expectedIdentity: identity });
    const classified = ops.updateSession({ sessionID: 'ses_2', expectedIdentity: identity,
      decideMetadata: (current) => current.openchamber.work.state === 'done' ? null : { openchamber: { work: { state: 'open' } } } });
    const [, result] = await Promise.all([done, classified]);
    expect(result.metadataChanged).toBe(false);
    expect(metadata.openchamber).toEqual({ work: { state: 'done' }, goal: 'keep' });
    expect(requests.filter((request) => request.method === 'PATCH')).toHaveLength(1);
  });

  it('refuses conditional metadata writes on OC1 before fetching', async () => {
    const fetchImpl = vi.fn();
    const ops = createKernelOperations({ getRuntime: () => runtime('oc1', 'http://kernel.test'), getHeaders: () => ({}), fetchImpl });
    await expect(ops.updateSession({ sessionID: 'ses_1', decideMetadata: () => ({ work: 'open' }) }))
      .rejects.toMatchObject({ code: 'unsupported-operation' });
    expect(fetchImpl).not.toHaveBeenCalled();
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
  it('returns the accepted conditional metadata after OC2 replies with no content', async () => {
    const requests = [];
    const endpoint = await serve(({ method }) => method === 'GET'
      ? { body: { data: { ...oc2Session, metadata: { keep: 'value', openchamber: { work: { state: 'closed' } } } } } }
      : { status: 204 }, requests);
    const ops = createKernelOperations({ getRuntime: () => runtime('oc2', endpoint), getHeaders: () => ({}) });
    const result = await ops.updateSession({ sessionID: 'ses_2', directory: 'C:/work', expectedIdentity: ops.captureIdentity(),
      decideMetadata: () => ({ openchamber: { work: { state: 'open' } } }) });
    expect(result.metadataChanged).toBe(true);
    expect(result.data.metadata).toEqual({ keep: 'value', openchamber: { work: { state: 'open' } } });
    expect(requests.map((entry) => entry.method)).toEqual(['GET', 'PATCH']);
  });

  it('does not commit a conditional patch after its fresh read retires the runtime', async () => {
    const requests = [];
    let selected;
    const endpoint = await serve(() => ({ body: { data: oc2Session } }), requests);
    selected = runtime('oc2', endpoint);
    const ops = createKernelOperations({ getRuntime: () => selected, getHeaders: () => ({}), fetchImpl: async (url, init) => {
      const response = await fetch(url, init);
      selected = runtime('oc2', endpoint, 2);
      return response;
    } });
    await expect(ops.updateSession({ sessionID: 'ses_2', decideMetadata: () => ({ work: 'open' }) }))
      .rejects.toMatchObject({ code: 'runtime-changed' });
    expect(requests.map((entry) => entry.method)).toEqual(['GET']);
  });

  it('uses OC2 default model and import routes, and refuses them before dispatch on OC1', async () => {
    const requests = [];
    const endpoint = await serve(({ path: route }) => route === '/api/model/default'
      ? { body: { data: { providerID: 'fixture', id: 'preferred' } } }
      : route === '/api/experimental/session/import' ? { body: { data: { id: 'ses_imported' } } }
      : { status: 404, body: {} }, requests);
    let selected = runtime('oc2', endpoint);
    const ops = createKernelOperations({ getRuntime: () => selected, getHeaders: () => ({}) });
    expect((await ops.getDefaultModel()).data).toEqual({ providerID: 'fixture', id: 'preferred' });
    expect((await ops.importSession({ chat: { fixture: true }, expectedIdentity: ops.captureIdentity() })).data).toEqual({ id: 'ses_imported' });
    selected = runtime('oc1', endpoint);
    await expect(ops.getDefaultModel()).rejects.toMatchObject({ code: 'unsupported-operation' });
    await expect(ops.importSession({ chat: {} })).rejects.toMatchObject({ code: 'unsupported-operation' });
    expect(requests.map((entry) => entry.path)).toEqual(['/api/model/default', '/api/experimental/session/import']);
  });

});

describe('Legacy operation acceptance boundary', () => {
  it('refuses unaccepted operations before headers, transport or preparation', async () => {
    let headerCalls = 0;
    let transportCalls = 0;
    let preparationCalls = 0;
    const ops = createKernelOperations({ getRuntime: () => ({ ...runtime('oc1', 'http://fixture.test'), profile: 'legacy-1.2.27' }),
      getHeaders: () => { headerCalls += 1; return {}; },
      fetchImpl: async () => { transportCalls += 1; return Response.json({}); },
      prepareSession: async () => { preparationCalls += 1; },
    });
    expect(ops.captureIdentity()).toMatchObject({ generation: 'oc1', profile: 'legacy-1.2.27' });
    const identityHeaderCalls = headerCalls;
    const denied = [
      () => ops.addSynthetic({ sessionID: 'ses_1', text: 'blocked' }),
      () => ops.switchSessionSelection({ sessionID: 'ses_1', agent: 'build' }),
      () => ops.importSession({ chat: {} }),
      () => ops.getDefaultModel(),
    ];
    for (const call of denied) await expect(call()).rejects.toMatchObject({ code: 'unsupported-operation' });
    expect(headerCalls).toBe(identityHeaderCalls);
    expect(transportCalls).toBe(0);
    expect(preparationCalls).toBe(0);
  });

  it('serves allowlisted Legacy reads through OC1 routes with projected data and request fidelity', async () => {
    const requests = [];
    const message = { info: { id: 'msg_1', role: 'assistant', mode: 'build', variant: 'fast' },
      parts: [{ type: 'text', text: 'legacy ' }, { type: 'text', text: 'history' }] };
    const child = { ...oc1Session, id: 'ses_child', parentID: 'ses_1' };
    const endpoint = await serve(({ path: route }) => {
      if (route === '/session') return { body: [oc1Session] };
      if (route === '/session/ses_1') return { body: oc1Session };
      if (route === '/session/ses_1/message') return { body: [message], headers: { 'x-next-cursor': '20' } };
      if (route === '/session/ses_1/message/msg_1') return { body: message };
      if (route === '/session/ses_1/children') return { body: [child] };
      if (route === '/session/status') return { body: { ses_1: { type: 'busy' } } };
      if (route === '/permission') return { body: [{ id: 'perm_1', sessionID: 'ses_1', permission: 'bash' }] };
      if (route === '/question') return { body: [{ id: 'question_1', sessionID: 'ses_1', questions: [{ text: 'continue?' }] }] };
      if (route === '/command') return { body: [{ name: 'review', template: 'review $ARGUMENTS' }] };
      if (route === '/config/providers') return { body: { providers: [{ id: 'openai', models: { m: { id: 'm' } } }] } };
      if (route === '/agent') return { body: [{ name: 'build', mode: 'primary' }] };
      if (route === '/config') return { body: { default_agent: 'build', model: 'openai/m' } };
      return { status: 404, body: { error: 'missing' } };
    }, requests);
    const ops = createKernelOperations({ getRuntime: () => ({ ...runtime('oc1', endpoint),
      version: '1.2.27', profile: 'legacy-1.2.27' }), getHeaders: () => ({ authorization: 'Basic fixture' }) });
    const identity = ops.captureIdentity();

    await expect(ops.listSessions({ directory: 'C:/work ü', limit: 25, cursor: 10, search: 'one' }))
      .resolves.toMatchObject({ profile: 'legacy-1.2.27', data: { items: [{ id: 'ses_1', directory: 'C:/work' }] } });
    await expect(ops.getSession({ sessionID: 'ses_1', directory: 'C:/work ü' }))
      .resolves.toMatchObject({ data: { id: 'ses_1', directory: 'C:/work' } });
    await expect(ops.listMessages({ sessionID: 'ses_1', directory: 'C:/work ü', cursor: 'before_1', limit: 30 }))
      .resolves.toMatchObject({ data: { items: [{ id: 'msg_1', text: 'legacy history', textParts: ['legacy ', 'history'], agent: 'build', variant: 'fast' }], cursor: { next: '20' } } });
    await expect(ops.getMessageView({ sessionID: 'ses_1', messageID: 'msg_1', directory: 'C:/work ü' }))
      .resolves.toMatchObject({ data: { id: 'msg_1', text: 'legacy history', textParts: ['legacy ', 'history'] } });
    await expect(ops.listChildren({ sessionID: 'ses_1', directory: 'C:/work ü' }))
      .resolves.toMatchObject({ data: [{ id: 'ses_child', parentID: 'ses_1' }] });
    await expect(ops.getSessionStatus({ sessionID: 'ses_1', directory: 'C:/work ü' })).resolves.toMatchObject({ data: { type: 'busy' } });
    await expect(ops.listPendingPermissions({ directory: 'C:/work ü' })).resolves.toMatchObject({ data: [{ id: 'perm_1', sessionID: 'ses_1' }] });
    await expect(ops.listPendingQuestions({ directory: 'C:/work ü' })).resolves.toMatchObject({ data: [{ id: 'question_1', sessionID: 'ses_1' }] });
    await expect(ops.listCommands({ directory: 'C:/work ü' })).resolves.toMatchObject({ data: [{ name: 'review' }] });
    await expect(ops.getSelectionCatalog({ directory: 'C:/work ü' })).resolves.toMatchObject({
      data: { generation: 'oc1', providers: [{ id: 'openai' }], agents: [{ name: 'build' }], config: { model: 'openai/m' } },
    });

    expect(identity).toMatchObject({ generation: 'oc1', profile: 'legacy-1.2.27', endpoint, epoch: 1 });
    expect(requests.every((request) => request.method === 'GET' && request.headers.authorization === 'Basic fixture')).toBe(true);
    expect(requests.every((request) => request.search.get('directory') === 'C:/work ü')).toBe(true);
    const listQuery = requests.find((request) => request.path === '/session').search;
    expect(Object.fromEntries(listQuery)).toMatchObject({ directory: 'C:/work ü', limit: '25', start: '10', search: 'one' });
    expect(requests.map((request) => request.path).sort()).toEqual([
      '/session', '/session/ses_1', '/session/ses_1/message', '/session/ses_1/message/msg_1',
      '/session/ses_1/children', '/session/status', '/permission', '/question', '/command',
      '/config/providers', '/agent', '/config',
    ].sort());
  });

  it('rejects malformed, failed, canceled and retired Legacy reads', async () => {
    let state;
    let status = 200;
    let body = [];
    const requests = [];
    const endpoint = await serve(() => ({ status, body }), requests);
    state = { ...runtime('oc1', endpoint), version: '1.2.27', profile: 'legacy-1.2.27' };
    const ops = createKernelOperations({ getRuntime: () => state, getHeaders: () => ({ authorization: 'Basic fixture' }) });
    await expect(ops.listSessions()).resolves.toMatchObject({ data: { items: [] } });
    body = [{}];
    await expect(ops.listSessions()).rejects.toMatchObject({ code: 'invalid-response' });
    status = 503;
    await expect(ops.listSessions()).rejects.toBeDefined();
    status = 200;
    body = [];
    await expect(ops.listSessions({ signal: AbortSignal.abort() })).rejects.toBeDefined();

    const changing = createKernelOperations({ getRuntime: () => state, getHeaders: () => ({}), fetchImpl: async (url, init) => {
      const response = await fetch(url, init);
      state = { ...state, epoch: state.epoch + 1 };
      return response;
    } });
    await expect(changing.listSessions()).rejects.toMatchObject({ code: 'runtime-changed' });
    expect(requests).toHaveLength(4);
  });

  it('rejects a read completed after a profile-only change at the same endpoint and epoch', async () => {
    const endpoint = await serve(() => ({ body: [oc1Session] }));
    let selected = { ...runtime('oc1', endpoint), profile: 'oc1' };
    const ops = createKernelOperations({ getRuntime: () => selected, getHeaders: () => ({}), fetchImpl: async (url, init) => {
      const response = await fetch(url, init);
      selected = { ...selected, profile: 'legacy-1.2.27' };
      return response;
    } });
    await expect(ops.listSessions()).rejects.toMatchObject({ code: 'runtime-changed' });
  });
});

describe('Legacy advanced kernel operations', () => {
  const selected = (endpoint) => ({ ...runtime('oc1', endpoint), version: '1.2.27', profile: 'legacy-1.2.27' });

  it('preserves fork boundaries, command bodies, directory and authentication', async () => {
    const requests = [];
    const endpoint = await serve(({ path: route }) => ({ body: route.endsWith('/fork') ? oc1Session : { info: { id: 'msg_command' }, parts: [] } }), requests);
    const ops = createKernelOperations({ getRuntime: () => selected(endpoint), getHeaders: () => ({ authorization: 'Basic fixture' }) });
    const identity = ops.captureIdentity();
    await expect(ops.forkSession({ sessionID: 'ses_1', messageID: 'msg_before', directory: 'C:/work ü', expectedIdentity: identity }))
      .resolves.toMatchObject({ profile: 'legacy-1.2.27', data: { id: 'ses_1' } });
    await expect(ops.sendCommand({ sessionID: 'ses_1', directory: 'C:/work ü', request: { ...identity, body: { command: 'review', arguments: 'one two', agent: 'build' } } }))
      .resolves.toMatchObject({ accepted: true, data: { info: { id: 'msg_command' } } });
    expect(requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'POST', path: '/session/ses_1/fork', body: { messageID: 'msg_before' } },
      { method: 'POST', path: '/session/ses_1/command', body: { command: 'review', arguments: 'one two', agent: 'build' } },
    ]);
    expect(requests.every(({ search, headers }) => search.get('directory') === 'C:/work ü' && headers.authorization === 'Basic fixture')).toBe(true);
  });

  it('refuses Legacy deletion without a metadata owner before upstream work', async () => {
    const requests = [];
    const endpoint = await serve(() => ({ body: true }), requests);
    const ops = createKernelOperations({ getRuntime: () => selected(endpoint), getHeaders: () => ({}) });
    await expect(ops.removeSession({ sessionID: 'ses_1' })).rejects.toMatchObject({ code: 'unsupported-operation' });
    expect(requests).toHaveLength(0);
  });

  it('does not clean metadata when upstream deletion fails or returns malformed success', async () => {
    const patch = vi.fn();
    let answer = { status: 503, body: { error: 'failed' } };
    const endpoint = await serve(() => answer);
    const ops = createKernelOperations({ getRuntime: () => selected(endpoint), getHeaders: () => ({}), legacyMetadataStore: { read: async () => ({}), patch } });
    await expect(ops.removeSession({ sessionID: 'ses_1' })).rejects.toBeDefined();
    answer = { status: 200, body: false };
    await expect(ops.removeSession({ sessionID: 'ses_1' })).rejects.toMatchObject({ code: 'invalid-response' });
    expect(patch).not.toHaveBeenCalled();
  });

  it('reports completed upstream deletion when metadata cleanup fails', async () => {
    const endpoint = await serve(() => ({ body: true }));
    const ops = createKernelOperations({ getRuntime: () => selected(endpoint), getHeaders: () => ({}),
      legacyMetadataStore: { read: async () => ({}), patch: async () => { throw new Error('storage unavailable'); } } });
    await expect(ops.removeSession({ sessionID: 'ses_1' })).rejects.toMatchObject({ sessionID: 'ses_1', upstreamDeleted: true, partial: true });
  });

  it('rejects deletion completed for a retired storage scope without writing to the replacement', async () => {
    const patch = vi.fn();
    let scope = 'first';
    const endpoint = await serve(() => ({ body: true }));
    const ops = createKernelOperations({ getRuntime: () => selected(endpoint), getHeaders: () => ({}), getStorageScope: () => scope,
      legacyMetadataStore: { read: async () => ({}), patch }, fetchImpl: async (url, init) => {
        const response = await fetch(url, init);
        scope = 'replacement';
        return response;
      } });
    await expect(ops.removeSession({ sessionID: 'ses_1' })).rejects.toMatchObject({ code: 'runtime-changed', upstreamDeleted: true, partial: true });
    expect(patch).not.toHaveBeenCalled();
  });

  it('rejects canceled forks and commands captured before a runtime change', async () => {
    const requests = [];
    const endpoint = await serve(() => ({ body: oc1Session }), requests);
    let state = selected(endpoint);
    const ops = createKernelOperations({ getRuntime: () => state, getHeaders: () => ({}) });
    await expect(ops.forkSession({ sessionID: 'ses_1', signal: AbortSignal.abort() })).rejects.toBeDefined();
    const identity = ops.captureIdentity();
    state = { ...state, epoch: state.epoch + 1 };
    await expect(ops.sendCommand({ sessionID: 'ses_1', request: { ...identity, body: { command: 'review' } } })).rejects.toMatchObject({ code: 'runtime-changed' });
    expect(requests).toHaveLength(0);
  });
});

describe('kernel profile identity contract', () => {
  it('retains profile in captured and returned identities', async () => {
    const endpoint = await serve(() => ({ body: [oc1Session] }));
    const ops = createKernelOperations({ getRuntime: () => ({ ...runtime('oc1', endpoint), profile: 'oc1' }), getHeaders: () => ({}) });
    expect(ops.captureIdentity()).toMatchObject({ profile: 'oc1' });
    await expect(ops.listSessions()).resolves.toMatchObject({ profile: 'oc1' });
  });
  it('rejects a request built before the current profile without transport', async () => {
    const fetchImpl = vi.fn();
    const selected = { ...runtime('oc1', 'http://127.0.0.1:9'), profile: 'oc1' };
    const ops = createKernelOperations({ getRuntime: () => selected, getHeaders: () => ({}), fetchImpl });
    const { profile, ...oldIdentity } = selected;
    await expect(ops.createSession({ directory: '/repo', expectedIdentity: oldIdentity })).rejects.toMatchObject({ code: 'runtime-changed' });
    expect(profile).toBe('oc1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('profile preparation and accepted writes', () => {
  it('carries the OC2 profile into session preparation', async () => {
    const endpoint = await serve(() => ({ body: { data: oc2Session } }));
    const prepareSession = vi.fn(async () => {});
    const ops = createKernelOperations({ getRuntime: () => ({ ...runtime('oc2', endpoint), profile: 'oc2' }),
      getHeaders: () => ({}), prepareSession });
    await expect(ops.getSession({ sessionID: 'ses_2' })).resolves.toMatchObject({ profile: 'oc2' });
    expect(prepareSession).toHaveBeenCalledWith(expect.objectContaining({ identity: expect.objectContaining({ profile: 'oc2' }) }));
  });
  it('accepts a write carrying the current profile', async () => {
    const endpoint = await serve(() => ({ body: oc1Session }));
    const ops = createKernelOperations({ getRuntime: () => ({ ...runtime('oc1', endpoint), profile: 'oc1' }), getHeaders: () => ({}) });
    await expect(ops.createSession({ directory: '/repo', expectedIdentity: ops.captureIdentity() }))
      .resolves.toMatchObject({ profile: 'oc1', data: { id: 'ses_1' } });
  });
});

describe('pending question and form inspection', () => {
  it.each(['oc1', 'oc2'])('preserves %s SDK read, auth and directory fidelity', async generation => {
    const requests = [];
    const endpoint = await serve(() => ({ body: generation === 'oc1'
      ? [{ id: 'input_1', sessionID: 'ses_1', questions: [{ text: 'private' }] }]
      : { location: { directory: 'C:/work ü' }, data: [{ id: 'input_1', sessionID: 'ses_1', title: 'private', fields: [] }] } }), requests);
    const ops = createKernelOperations({ getRuntime: () => runtime(generation, endpoint), getHeaders: () => ({ authorization: 'Basic fixture' }) });
    const result = await ops.listPendingQuestions({ directory: 'C:/work ü' });
    expect(result).toMatchObject({ generation, epoch: 1, data: [{ id: 'input_1', sessionID: 'ses_1' }] });
    expect(result.data[0]).not.toHaveProperty('title');
    expect(result.data[0]).not.toHaveProperty('questions');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'GET', path: generation === 'oc1' ? '/question' : '/api/form', headers: { authorization: 'Basic fixture' } });
    if (generation === 'oc1') expect(requests[0].search.get('directory')).toBe('C:/work ü');
    else { expect(requests[0].search.get('location[directory]')).toBe('C:/work ü');
      expect(requests[0].headers['x-opencode-directory']).toBe(encodeURIComponent('C:/work ü')); }
  });
  it.each(['oc1', 'oc2'])('distinguishes empty, malformed and failed %s reads', async generation => {
    let body = generation === 'oc1' ? [] : { data: [] };
    let status = 200;
    const endpoint = await serve(() => ({ body, status }));
    const ops = createKernelOperations({ getRuntime: () => runtime(generation, endpoint), getHeaders: () => ({}) });
    expect((await ops.listPendingQuestions()).data).toEqual([]);
    body = generation === 'oc1' ? [{}] : { data: [{}] };
    await expect(ops.listPendingQuestions()).rejects.toBeDefined();
    status = 503;
    await expect(ops.listPendingQuestions()).rejects.toBeDefined();
  });
  it('rejects retirement, Legacy and canceled reads', async () => {
    let state;
    const requests = [];
    const endpoint = await serve(() => { state = runtime('oc2', endpoint, 2); return { body: { data: [] } }; }, requests);
    state = runtime('oc2', endpoint);
    const ops = createKernelOperations({ getRuntime: () => state, getHeaders: () => ({}) });
    await expect(ops.listPendingQuestions()).rejects.toMatchObject({ code: 'runtime-changed' });
    state = { ...runtime('oc2', endpoint), profile: 'legacy-1.2.27' };
    await expect(ops.listPendingQuestions()).rejects.toMatchObject({ code: 'unsupported-operation' });
    state = runtime('oc2', endpoint);
    await expect(ops.listPendingQuestions({ signal: AbortSignal.abort() })).rejects.toBeDefined();
    expect(requests).toHaveLength(1);
  });
});

describe('exact Legacy configuration snapshot', () => {
  const paths = { home: 'C:/fixture/home', config: 'C:/fixture/config', directory: 'C:/fixture/project/sub', worktree: 'C:/fixture/project' };
  const selected = endpoint => ({ ...runtime('oc1', endpoint), profile: 'legacy-1.2.27', version: '1.2.27' });
  it('preserves SDK directory and authentication for path and effective configuration', async () => {
    const requests = [];
    const mcp = { remote: { type: 'remote', url: 'https://mcp.example', oauth: false, timeout: 3500 }, disabled: { enabled: false } };
    const endpoint = await serve(record => ({ body: record.path === '/path' ? paths : { mcp, model: 'fixture/model' } }), requests);
    const ops = createKernelOperations({ getRuntime: () => selected(endpoint), getHeaders: () => ({ Authorization: 'Basic fixture' }) });
    const result = await ops.getLegacyConfiguration({ directory: paths.directory });
    expect(result.data).toEqual({ paths, mcp });
    expect(requests.map(record => record.path).sort()).toEqual(['/config', '/path']);
    for (const request of requests) {
      expect(request.method).toBe('GET');
      expect(request.search.get('directory')).toBe(paths.directory);
      expect(request.headers.authorization).toBe('Basic fixture');
    }
  });
  it.each([{ profile: 'oc1' }, { generation: 'oc2', profile: 'oc2' }, { version: '1.2.28' }])('refuses a non-exact descriptor before transport %j', async change => {
    let calls = 0;
    const ops = createKernelOperations({ getRuntime: () => ({ ...selected('http://fixture.test'), ...change }), getHeaders: () => ({}), fetchImpl: async () => { calls++; throw new Error('must not transport'); } });
    await expect(ops.getLegacyConfiguration()).rejects.toMatchObject({ code: 'unsupported-operation' });
    expect(calls).toBe(0);
  });
  it('rejects a version change while configuration reads are pending', async () => {
    let current = selected('http://fixture.test');
    const ops = createKernelOperations({ getRuntime: () => current, getHeaders: () => ({}), fetchImpl: async request => {
      current = { ...current, version: '1.2.28' };
      return Response.json(new URL(request.url).pathname === '/path' ? paths : {});
    } });
    await expect(ops.getLegacyConfiguration()).rejects.toMatchObject({ code: 'runtime-changed' });
  });
  it.each([{ mcp: null }, { mcp: { invalid: { type: 'remote', url: 'secret-fixture', timeout: -1 } } }])('refuses invalid effective MCP data without returning secrets', async body => {
    const endpoint = await serve(record => ({ body: record.path === '/path' ? paths : body }));
    const ops = createKernelOperations({ getRuntime: () => selected(endpoint), getHeaders: () => ({}) });
    await expect(ops.getLegacyConfiguration()).rejects.toThrow(/Invalid/);
  });

  it('classifies a failed late read as retired instead of an active-runtime error', async () => {
    let current = selected('http://fixture.test');
    const ops = createKernelOperations({ getRuntime: () => current, getHeaders: () => ({}), fetchImpl: async () => {
      current = { ...current, epoch: 2 };
      return Response.json({ error: 'old instance failure' }, { status: 503 });
    } });
    await expect(ops.getLegacyConfiguration()).rejects.toMatchObject({ code: 'runtime-changed' });
  });

  it('preserves cancellation without returning an authoritative empty configuration', async () => {
    const endpoint = await serve(record => ({ body: record.path === '/path' ? paths : {} }));
    const ops = createKernelOperations({ getRuntime: () => selected(endpoint), getHeaders: () => ({}) });
    await expect(ops.getLegacyConfiguration({ signal: AbortSignal.abort() })).rejects.toBeDefined();
  });

});
