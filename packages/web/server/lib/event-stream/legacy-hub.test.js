import { describe, expect, it } from 'vitest';

import { createGlobalMessageStreamHub } from './global-hub.js';
import { OPENCODE_PROFILE } from '../opencode/compatibility.js';

const LEGACY_RUNTIME = Object.freeze({
  generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY, version: '1.2.27',
  endpoint: 'http://opencode.test', epoch: 4,
});

describe('Legacy global event hub', () => {
  it('reads the OC1 global stream once and preserves upstream events in live delivery and replay', async () => {
    const events = [];
    let fetches = 0;
    const payloads = [
      { type: 'message.part.delta', properties: { sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: 'one' } },
      { type: 'session.updated', properties: { info: { id: 's' } } },
      { type: 'message.part.delta', properties: { sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: 'two' } },
    ];
    const block = payloads.map((payload, index) => `id: legacy-${index}\ndata: ${JSON.stringify(payload)}\n\n`).join('');
    const hub = createGlobalMessageStreamHub({
      getKernelRuntime: () => LEGACY_RUNTIME,
      buildOpenCodeUrl: (path) => `http://127.0.0.1${path}`,
      getOpenCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 60_000,
      fetchImpl: async (url) => {
        fetches += 1;
        expect(url).toBe('http://127.0.0.1/global/event');
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode(block)); },
        }), { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    hub.subscribeEvent((event) => events.push(event));
    try {
      hub.start();
      await waitFor(() => expect(events).toHaveLength(3));
      expect(fetches).toBe(1);
      expect(events.map((event) => event.payload)).toEqual(payloads);
      expect(events[0].translated()).toEqual([payloads[0]]);
      const replay = hub.replayAfter(events[0].eventId);
      expect(replay.map((entry) => JSON.parse(entry.serializedFrame).payload)).toEqual(payloads.slice(1));
    } finally {
      hub.stop();
    }
  });

  it.each(['profile', 'version', 'epoch'])('discards pending deltas after %s retirement', async (field) => {
    let runtime = LEGACY_RUNTIME; const events = []; let reads = 0;
    const payload = { type: 'message.part.delta', properties: { sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: 'old' } };
    const hub = createGlobalMessageStreamHub({
      getKernelRuntime: () => runtime, buildOpenCodeUrl: () => 'http://127.0.0.1/global/event',
      deltaCoalesceWindowMs: 1000,
      fetchImpl: async () => ({ ok: true, body: { getReader: () => ({ read: async () => {
        reads++;
        if (reads === 1) return { value: new TextEncoder().encode(('data: ' + JSON.stringify(payload) + '\n\n').repeat(2)), done: false };
        return new Promise(() => {});
      } }) } }),
    });
    hub.subscribeEvent(event => events.push(event));
    try {
      hub.start(); await waitFor(() => expect(reads).toBe(2));
      runtime = { ...LEGACY_RUNTIME, [field]: field === 'epoch' ? 5 : field === 'profile' ? 'oc1' : '1.2.28' };
      hub.flushPending();
      expect(events).toHaveLength(1); // The leading delta was delivered before retirement.
      expect(hub.replayAfter('old')).toBeNull();
    } finally { hub.stop(); }
  });

  it.each([
    ['wrong generation', { generation: 'oc2' }],
    ['wrong version', { version: '1.2.28' }],
    ['missing version', { version: undefined }],
  ])('refuses Legacy admission before HTTP for %s', async (_label, override) => {
    const runtime = { ...LEGACY_RUNTIME, ...override };
    let fetches = 0;
    const hub = createGlobalMessageStreamHub({
      getKernelRuntime: () => runtime,
      buildOpenCodeUrl: (path) => `http://127.0.0.1${path}`,
      fetchImpl: async () => { fetches += 1; throw new Error('unexpected HTTP'); },
    });
    hub.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetches).toBe(0);
    expect(hub.replayAfter('legacy-cursor')).toBeNull();
    hub.stop();
  });
});

async function waitFor(assertion) {
  const deadline = Date.now() + 1500;
  let lastError;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}
