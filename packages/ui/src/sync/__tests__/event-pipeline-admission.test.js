import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createEventPipeline } from '../event-pipeline';
import { opencodeClient } from '@/lib/opencode/client';
import { OpenCodeRuntimeChangedError } from '@/lib/opencode/runtime';
import { clearRuntimeUrlAuthToken } from '@/lib/runtime-auth';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '@/lib/runtime-url';

const previousResolver = getRuntimeUrlResolver();
const previousFetch = globalThis.fetch;
const previousSocket = globalThis.WebSocket;
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
class Socket {
  static instances = [];
  readyState = 0;
  onmessage = null;
  onopen = null;
  onclose = null;
  onerror = null;
  constructor() { Socket.instances.push(this); }
  close() { this.readyState = 3; }
  send() {}
  ready() { this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) }); }
}
beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://admission.test' });
  opencodeClient.reconnectToRuntimeBaseUrl();
  clearRuntimeUrlAuthToken();
  globalThis.WebSocket = Socket;
  Socket.instances = [];
  globalThis.fetch = async () => Response.json({ token: 'fixture-token', expiresAt: Date.now() + 600000 });
});
afterEach(() => {
  globalThis.fetch = previousFetch;
  globalThis.WebSocket = previousSocket;
  clearRuntimeUrlAuthToken();
  setRuntimeUrlResolver(previousResolver);
  opencodeClient.reconnectToRuntimeBaseUrl();
});
const sourceWith = (opened) => ({
  generation: 'oc1',
  events: async function* (signal) {
    opened();
    yield { generation: 'oc1', value: { directory: '/repo', payload: {
      type: 'session.status', properties: { sessionID: 'fixture', status: { type: 'idle' } },
    } } };
    await new Promise((resolve) => signal.aborted ? resolve() : signal.addEventListener('abort', resolve, { once: true }));
  },
});
for (const transport of ['sse', 'ws']) {
  test(transport + ' waits for descriptor admission before opening and reporting ready', async () => {
    const gate = deferred();
    let streams = 0;
    let connected = 0;
    const pipeline = createEventPipeline({ source: sourceWith(() => { streams += 1; }), transport,
      beforeConnect: () => gate.promise, onReconnect: () => { connected += 1; } });
    try {
      await pause();
      expect(streams + Socket.instances.length).toBe(0);
      expect(connected).toBe(0);
      gate.resolve();
      await pause();
      if (transport === 'ws') Socket.instances[0].ready();
      expect(streams + Socket.instances.length).toBe(1);
      expect(connected).toBe(1);
    } finally { pipeline.cleanup(); gate.resolve(); }
  });
  test(transport + ' cleanup during admission prevents a late transport opening', async () => {
    const gate = deferred();
    let streams = 0;
    let connected = 0;
    const pipeline = createEventPipeline({ source: sourceWith(() => { streams += 1; }), transport,
      beforeConnect: () => gate.promise, onReconnect: () => { connected += 1; } });
    pipeline.cleanup();
    gate.resolve();
    await pause();
    expect(streams + Socket.instances.length).toBe(0);
    expect(connected).toBe(0);
  });
  test(transport + ' retries failed admission without opening a stale stream', async () => {
    const admitted = deferred();
    let checks = 0;
    let streams = 0;
    let disconnected = 0;
    const pipeline = createEventPipeline({ source: sourceWith(() => { streams += 1; }), transport,
      beforeConnect: async () => { checks += 1; if (checks === 1) throw new Error('descriptor unavailable'); admitted.resolve(); },
      onDisconnect: () => { disconnected += 1; } });
    try {
      await pause();
      expect(checks).toBe(1);
      expect(streams + Socket.instances.length).toBe(0);
      await admitted.promise;
      await pause();
      expect(checks).toBe(2);
      expect(streams + Socket.instances.length).toBe(1);
      expect(disconnected).toBe(1);
    } finally { pipeline.cleanup(); }
  });
  test(transport + ' rechecks each explicit reconnect and never probes per event', async () => {
    const gate = deferred();
    let checks = 0;
    let streams = 0;
    const pipeline = createEventPipeline({ source: sourceWith(() => { streams += 1; }), transport,
      beforeConnect: async () => { checks += 1; if (checks > 1) await gate.promise; } });
    try {
      await pause();
      if (transport === 'ws') Socket.instances[0].ready();
      expect(checks).toBe(1);
      pipeline.reconnect();
      await pause();
      expect(checks).toBe(2);
      expect(streams + Socket.instances.length).toBe(1);
      gate.resolve();
      await pause();
      expect(streams + Socket.instances.length).toBe(2);
    } finally { pipeline.cleanup(); gate.resolve(); }
  });
}
for (const replacement of [
  { generation: 'oc1', endpoint: 'http://kernel.test', epoch: 2, version: '1.18.32' },
  { generation: 'oc2', endpoint: 'http://kernel.test', epoch: 1, version: '2.0.20' },
  { generation: 'unreachable', endpoint: null, epoch: 2, version: null },
  null,
]) {
  test('a peer descriptor change cannot open the retained SDK source: ' + (replacement?.generation ?? 'HTTP failure'), async () => {
    opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'http://kernel.test', epoch: 1, version: '1.18.32' });
    const source = opencodeClient.getSyncSource();
    const disconnected = deferred();
    const requests = [];
    globalThis.fetch = async (input) => {
      requests.push(String(input));
      return replacement ? Response.json(replacement) : new Response(null, { status: 503 });
    };
    let connected = 0;
    const pipeline = createEventPipeline({ source, transport: 'sse',
      beforeConnect: async () => {
        await opencodeClient.discoverRuntime();
        if (!opencodeClient.getBoundRuntime() || opencodeClient.getSyncSource() !== source) throw new OpenCodeRuntimeChangedError();
      }, onReconnect: () => { connected += 1; }, onDisconnect: () => disconnected.resolve() });
    try {
      await disconnected.promise;
      expect(requests).toEqual(['https://admission.test/api/opencode/runtime']);
      expect(connected).toBe(0);
      if (replacement?.generation === 'oc2') expect(opencodeClient.getSyncSource().generation).toBe('oc2');
    } finally { pipeline.cleanup(); }
  });
}
