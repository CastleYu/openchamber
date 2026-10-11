import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { acceptDirectoryMessageStreamWsConnection } from './directory-ws-bridge.js';

const LEGACY_RUNTIME = Object.freeze({
  generation: 'oc1',
  endpoint: 'http://127.0.0.1:4096',
  epoch: 3,
  profile: 'legacy-1.2.27',
  version: '1.2.27',
});

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
    this.closeCalls = [];
    this.bufferedAmount = 0;
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  ping() {}

  close(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closeCalls.push({ code, reason });
    this.emit('close');
  }
}

function makeResponse(read) {
  return {
    ok: true,
    body: {
      getReader: () => ({ read }),
    },
  };
}

function eventBlock(type) {
  return `id: ${type}\ndata: {"type":"${type}","directory":"/proj","properties":{}}\n\n`;
}

function connect({ socket, getKernelRuntime, fetchImpl, getOpenCodeAuthHeaders = () => ({ Authorization: 'Bearer test-token' }) }) {
  const wsClients = new Set();
  acceptDirectoryMessageStreamWsConnection({
    socket,
    requestedDirectory: '/proj',
    requestedLastEventId: '',
    buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
    getKernelRuntime,
    getOpenCodeAuthHeaders,
    processForwardedEventPayload() {},
    wsClients,
    heartbeatIntervalMs: 60_000,
    upstreamReconnectDelayMs: 60_000,
    fetchImpl,
  });
  return wsClients;
}

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

describe('legacy OC1 directory stream admission', () => {
  it('opens the admitted 1.2.27 stream with auth and forwards a directory event', async () => {
    const socket = new FakeSocket();
    const headers = { Authorization: 'Bearer preserved' };
    const fetches = [];
    let resolveRead;
    const response = makeResponse(() => new Promise((resolve) => { resolveRead = resolve; }));
    try {
      connect({
        socket,
        getKernelRuntime: () => LEGACY_RUNTIME,
        getOpenCodeAuthHeaders: () => headers,
        fetchImpl: async (url, options) => {
          fetches.push({ url: new URL(url), options });
          return response;
        },
      });
      await waitFor(() => expect(socket.sent.some((frame) => frame.type === 'ready' && frame.scope === 'directory')).toBe(true));
      expect(fetches).toHaveLength(1);
      expect(fetches[0].url.pathname).toBe('/event');
      expect(fetches[0].url.searchParams.get('directory')).toBe('/proj');
      expect(fetches[0].options.headers).toMatchObject(headers);

      resolveRead({ value: new TextEncoder().encode(eventBlock('session.updated')), done: false });
      await waitFor(() => expect(socket.sent.some((frame) => frame.type === 'event' && frame.payload?.type === 'session.updated' && frame.directory === '/proj')).toBe(true));
    } finally {
      socket.close();
    }
  });

  it('keeps the ordinary OC1 profile working', async () => {
    const socket = new FakeSocket();
    const runtime = { ...LEGACY_RUNTIME, profile: 'oc1', version: '1.18.0' };
    let fetchCalls = 0;
    try {
      connect({
        socket,
        getKernelRuntime: () => runtime,
        fetchImpl: async () => {
          fetchCalls += 1;
          return makeResponse(async () => ({ done: true }));
        },
      });
      await waitFor(() => expect(socket.sent.some((frame) => frame.type === 'ready' && frame.scope === 'directory')).toBe(true));
      expect(fetchCalls).toBe(1);
    } finally {
      socket.close();
    }
  });

  it.each([
    ['wrong generation', { ...LEGACY_RUNTIME, generation: 'oc2' }],
    ['wrong version', { ...LEGACY_RUNTIME, version: '1.2.26' }],
    ['missing version', { ...LEGACY_RUNTIME, version: undefined }],
  ])('refuses %s before fetching with credentials', async (_label, runtime) => {
    const socket = new FakeSocket();
    let fetchCalls = 0;
    try {
      connect({
        socket,
        getKernelRuntime: () => runtime,
        fetchImpl: async () => { fetchCalls += 1; return makeResponse(async () => ({ done: true })); },
      });
      await waitFor(() => expect(socket.closeCalls).toHaveLength(1));
      expect(fetchCalls).toBe(0);
      expect(socket.sent.some((frame) => frame.type === 'error')).toBe(true);
    } finally {
      socket.close();
    }
  });

  it.each([
    ['profile', { ...LEGACY_RUNTIME, profile: 'oc1' }],
    ['version', { ...LEGACY_RUNTIME, version: '1.2.26' }],
    ['epoch', { ...LEGACY_RUNTIME, epoch: 4 }],
  ])('drops an event queued by the old reader after the %s changes', async (_label, nextRuntime) => {
    const socket = new FakeSocket();
    let runtime = LEGACY_RUNTIME;
    let resolveRead;
    let fetchSignal;
    const wsClients = connect({
      socket,
      getKernelRuntime: () => runtime,
      fetchImpl: async (_url, options) => {
        fetchSignal = options.signal;
        return makeResponse(() => new Promise((resolve) => { resolveRead = resolve; }));
      },
    });
    try {
      await waitFor(() => expect(socket.sent.some((frame) => frame.type === 'ready')).toBe(true));
      runtime = nextRuntime;
      resolveRead({ value: new TextEncoder().encode(eventBlock('session.stale')), done: false });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(socket.sent.some((frame) => frame.payload?.type === 'session.stale')).toBe(false);
      socket.close();
      expect(fetchSignal.aborted).toBe(true);
      expect(wsClients.has(socket)).toBe(false);
    } finally {
      socket.close();
    }
  });

  it('rejects readiness when the descriptor changes during connection', async () => {
    const socket = new FakeSocket(); let runtime = LEGACY_RUNTIME; let resolveFetch; let fetchSignal;
    try {
      connect({ socket, getKernelRuntime: () => runtime, fetchImpl: (_url, options) => {
        fetchSignal = options.signal;
        return new Promise(resolve => { resolveFetch = resolve; });
      } });
      await waitFor(() => expect(resolveFetch).toBeDefined());
      runtime = { ...LEGACY_RUNTIME, epoch: 5 };
      resolveFetch(makeResponse(async () => ({ done: true })));
      await waitFor(() => expect(fetchSignal.aborted).toBe(true));
      expect(socket.sent.some(frame => frame.type === 'ready')).toBe(false);
    } finally { socket.close(); }
  });

  it('stops the held upstream reader when the browser socket closes', async () => {
    const socket = new FakeSocket();
    let fetchSignal;
    let releaseRead;
    try {
      connect({
        socket,
        getKernelRuntime: () => LEGACY_RUNTIME,
        fetchImpl: async (_url, options) => {
          fetchSignal = options.signal;
          return makeResponse(() => new Promise((resolve) => { releaseRead = resolve; }));
        },
      });
      await waitFor(() => expect(fetchSignal).toBeDefined());
      socket.close();
      expect(fetchSignal.aborted).toBe(true);
      releaseRead({ done: true });
    } finally {
      socket.close();
    }
  });
});
