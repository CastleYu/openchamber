import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { acceptDirectoryMessageStreamWsConnection } from './directory-ws-bridge.js';

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

  ping() {
    void 0;
  }

  close(code, reason) {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.closeCalls.push({ code, reason });
    this.emit('close');
  }
}

function createSseResponse({ blocks = [] } = {}) {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
            if (index < blocks.length) {
              return { value: encoder.encode(blocks[index++]), done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    },
  };
}

async function waitForAssertion(assertion) {
  const deadline = Date.now() + 1000;
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

describe('directory message stream bridge', () => {
  it('waits for the kernel generation before opening the directory stream', async () => {
    let runtime = { generation: 'unknown', endpoint: null, epoch: 0 };
    const fetchUrls = [];
    const socket = new FakeSocket();
    try {
      acceptDirectoryMessageStreamWsConnection({
        socket,
        requestedDirectory: '/proj',
        requestedLastEventId: '',
        buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
        getKernelRuntime: () => runtime,
        getOpenCodeAuthHeaders: () => ({}),
        processForwardedEventPayload() {},
        wsClients: new Set(),
        triggerHealthCheck() {},
        heartbeatIntervalMs: 5000,
        upstreamReconnectDelayMs: 60_000,
        fetchImpl: async (url) => {
          fetchUrls.push(String(url));
          return createSseResponse({
            blocks: ['id: evt-1\ndata: {"type":"server.connected","properties":{}}\n\n'],
          });
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(fetchUrls).toHaveLength(0);
      runtime = { generation: 'oc1', endpoint: 'http://127.0.0.1:4096', epoch: 1 };
      await waitForAssertion(() => {
        expect(socket.sent.some((frame) => frame.type === 'ready' && frame.scope === 'directory')).toBe(true);
      });
      expect(new URL(fetchUrls[0]).searchParams.get('directory')).toBe('/proj');
    } finally {
      socket.close();
    }
  });

  it('keeps the OC1 bridge error for a stream that settles on OC2', async () => {
    const socket = new FakeSocket();
    let fetchCalls = 0;
    try {
      acceptDirectoryMessageStreamWsConnection({
        socket,
        requestedDirectory: '/proj',
        requestedLastEventId: '',
        buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
        getKernelRuntime: () => ({ generation: 'oc2', endpoint: 'http://127.0.0.1:4096', epoch: 1 }),
        getOpenCodeAuthHeaders: () => ({}),
        processForwardedEventPayload() {},
        wsClients: new Set(),
        triggerHealthCheck() {},
        heartbeatIntervalMs: 5000,
        upstreamReconnectDelayMs: 60_000,
        fetchImpl: async () => {
          fetchCalls += 1;
          return createSseResponse();
        },
      });
      await waitForAssertion(() => {
        expect(socket.sent.some((frame) => frame.type === 'error')).toBe(true);
      });
      expect(socket.closeCalls).toEqual([{ code: 1011, reason: 'OpenCode service unavailable' }]);
      expect(fetchCalls).toBe(0);
    } finally {
      socket.close();
    }
  });
});
