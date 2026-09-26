import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSessionStateStore, overlaySessionResponseBody } from './openchamberSessionState';

const dirs: string[] = [];
const servers: Server[] = [];
after(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
const fixture = async () => {
  let metadata: Record<string, unknown> = { openchamber: { keep: 'yes' } };
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = [];
  const server = createServer(async (req, res) => {
    const raw: Buffer[] = [];
    for await (const chunk of req) raw.push(Buffer.from(chunk));
    const body = raw.length ? JSON.parse(Buffer.concat(raw).toString('utf8')) as Record<string, unknown> : null;
    requests.push({ path: req.url ?? '', method: req.method ?? '', body });
    if (req.url === '/api/session/ses_1' && req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: { id: 'ses_1', metadata, location: { directory: '/repo' } } }));
      return;
    }
    if (req.url === '/api/session/ses_1' && req.method === 'PATCH') {
      metadata = body?.metadata as Record<string, unknown>;
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'missing' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-state-'));
  dirs.push(dataDir);
  let generation: 'oc1' | 'oc2' = 'oc2';
  let epoch = 1;
  let mode: 'managed' | 'external' = 'managed';
  let currentEndpoint = endpoint;
  const manager = {
    getKernelRuntime: () => ({ generation, endpoint: currentEndpoint, epoch, version: generation === 'oc2' ? '2.0.16' : '1.18.32' }),
    getOpenCodeAuthHeaders: () => ({}),
    getDebugInfo: () => ({ mode }),
  };
  const store = createSessionStateStore({ dataDir, manager });
  return { store, dataDir, requests, metadata: () => metadata, setGeneration: (value: 'oc1' | 'oc2') => { generation = value; },
    setEpoch: (value: number) => { epoch = value; }, setMode: (value: 'managed' | 'external') => { mode = value; },
    setEndpoint: (value: string) => { currentEndpoint = value; } };
};

describe('VS Code dual-kernel session state', () => {
  it('claims root files for the first OC2 scope and keeps external state separate', async () => {
    const { store, dataDir, setGeneration, setMode, setEndpoint } = await fixture();
    assert.equal((await store.archive(['ses_1'], 10)).archived[0].archivedAt, 10);
    assert.equal((await store.readArchived()).ses_1, 10);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'sessions-storage-owner.json'), 'utf8')), { version: 1, scope: 'managed' });
    setEndpoint('http://127.0.0.1:1');
    assert.equal((await store.readArchived()).ses_1, 10);
    setMode('external');
    assert.deepEqual(await store.readArchived(), {});
    await store.archive(['ses_1'], 20);
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'sessions-archive.json'), 'utf8')).ses_1, 10);
    setGeneration('oc1');
    await assert.rejects(store.readArchived(), /OC2 session state is unavailable/);
  });

  it('migrates legacy OC2 metadata before read, then applies a null-delete patch', async () => {
    const { store, dataDir, requests, metadata } = await fixture();
    await fs.writeFile(path.join(dataDir, 'sessions-metadata.json'), JSON.stringify({ ses_1: { openchamber: { old: 'yes', remove: 'x' } } }));
    const first = await store.getMetadata('ses_1', '/repo');
    assert.deepEqual(first.openchamber, { old: 'yes', remove: 'x' });
    assert.equal(requests.filter((item) => item.method === 'PATCH').length, 1);
    assert.equal((await fs.readdir(dataDir)).includes('sessions-metadata.json.migrated'), true);
    const next = await store.setMetadata('ses_1', { openchamber: { remove: null, added: true } }, '/repo');
    assert.deepEqual(next.openchamber, { old: 'yes', added: true });
    assert.deepEqual(metadata().openchamber, { old: 'yes', added: true });
  });

  it('rejects an old epoch before a metadata write', async () => {
    const { store, setEpoch, requests } = await fixture();
    const pending = store.getMetadata('ses_1');
    setEpoch(2);
    await assert.rejects(pending, /connection changed/);
    assert.equal(requests.filter((item) => item.method === 'PATCH').length, 0);
  });

  it('overlays archive and pending metadata without treating an unarchive as missing', () => {
    const body = { data: [{ id: 'ses_1', time: { archived: 2 }, metadata: { keep: true } }] };
    assert.deepEqual(overlaySessionResponseBody(body, { ses_1: null }, { ses_1: { other: 'x' } }),
      { data: [{ id: 'ses_1', time: {}, metadata: { keep: true, other: 'x' } }] });
  });
});
