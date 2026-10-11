import http from 'node:http';
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { opencodeClient } from '../lib/opencode/client';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '../lib/runtime-url';
import { getRuntimeKey } from '../lib/runtime-switch';
import { ChildStoreManager } from './child-store';
import { createEventRoutingIndex, handleEvent, resyncBlockingRequestsForDirectory } from './sync-context';

const DIRECTORY = '/recovery';
const SESSION = 'ses_recovery';
const KIND = Object.freeze({ QUESTION: 'question', PERMISSION: 'permission' });
const previousResolver = getRuntimeUrlResolver();
const previousFrame = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
afterAll(() => { globalThis.requestAnimationFrame = previousFrame; });
const managers = [];
const servers = [];
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
afterEach(async () => {
  opencodeClient.reconnectToRuntimeBaseUrl();
  setRuntimeUrlResolver(previousResolver);
  for (const manager of managers.splice(0)) manager.disposeAll();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
});
const fixture = async (kind, initial, failedDirectory) => {
  const request = kind === KIND.QUESTION ? { id: 'question', sessionID: SESSION, questions: [] }
    : { id: 'permission', sessionID: SESSION, permission: 'read', patterns: ['*'], metadata: {}, always: [] };
  const started = deferred();
  const response = deferred();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (failedDirectory && url.pathname === '/api/' + kind && url.searchParams.get('directory') === failedDirectory) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'directory-unavailable' }));
      return;
    }
    let items = [];
    if (url.pathname === '/api/' + kind) {
      started.resolve();
      items = await response.promise;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(items));
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  configureRuntimeUrlResolver({ apiBaseUrl: endpoint + '/api' });
  opencodeClient.bindRuntime({ generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint, epoch: 1 });
  const manager = new ChildStoreManager();
  managers.push(manager);
  const store = manager.ensureChild(DIRECTORY, { bootstrap: false });
  store.setState({ [kind]: initial ? { [SESSION]: [request] } : {} });
  const routing = createEventRoutingIndex();
  const event = (payload) => handleEvent(DIRECTORY, payload, manager, routing, getRuntimeKey(), true);
  return { store, manager, request, event, started, response };
};

describe('blocking request reconnect reconciliation', () => {
  for (const kind of Object.values(KIND)) {
    test(`${kind} answered during reconnect is not resurrected by stale nonempty HTTP`, async () => {
      const f = await fixture(kind, true);
      const recovery = resyncBlockingRequestsForDirectory(DIRECTORY, f.store, [SESSION]);
      try {
        await f.started.promise;
        f.event({ id: 'reply', type: kind + '.replied', properties: { sessionID: SESSION, requestID: f.request.id,
          ...(kind === KIND.QUESTION ? { answers: [] } : { reply: 'once' }) } });
      } finally { f.response.resolve([f.request]); }
      await recovery;
      expect(f.store.getState()[kind][SESSION] ?? []).toEqual([]);
    });
    test(`${kind} arriving during reconnect survives an older empty HTTP result`, async () => {
      const f = await fixture(kind, false);
      const recovery = resyncBlockingRequestsForDirectory(DIRECTORY, f.store, [SESSION]);
      try {
        await f.started.promise;
        f.event({ id: 'asked', type: kind + '.asked', properties: f.request });
      } finally { f.response.resolve([]); }
      await recovery;
      expect(f.store.getState()[kind][SESSION]).toEqual([f.request]);
    });
    test(`${kind} failure preserves its directory while another complete directory clears`, async () => {
      const f = await fixture(kind, true, DIRECTORY);
      const healthy = f.manager.ensureChild('/healthy', { bootstrap: false });
      healthy.setState({ [kind]: { [SESSION]: [f.request] } });
      const failedRecovery = resyncBlockingRequestsForDirectory(DIRECTORY, f.store, [SESSION]);
      const healthyRecovery = resyncBlockingRequestsForDirectory('/healthy', healthy, [SESSION]);
      f.response.resolve([]);
      await Promise.all([failedRecovery, healthyRecovery]);
      expect(f.store.getState()[kind][SESSION]).toEqual([f.request]);
      expect(healthy.getState()[kind][SESSION] ?? []).toEqual([]);
    });
    test(`${kind} settled without a cached request is not resurrected by HTTP`, async () => {
      const f = await fixture(kind, false);
      const recovery = resyncBlockingRequestsForDirectory(DIRECTORY, f.store, [SESSION]);
      try {
        await f.started.promise;
        f.event({ id: 'reply-uncached', type: kind + '.replied', properties: { sessionID: SESSION, requestID: f.request.id,
          ...(kind === KIND.QUESTION ? { answers: [] } : { reply: 'once' }) } });
      } finally { f.response.resolve([f.request]); }
      await recovery;
      expect(f.store.getState()[kind][SESSION] ?? []).toEqual([]);
    });
  }
});
