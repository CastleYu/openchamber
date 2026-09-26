import { afterEach, describe, expect, it, mock } from 'bun:test';

const originalFetch = globalThis.fetch;
const { openSseProxy } = await import('./sseProxy');

const createManager = () => ({
  getStatus: () => 'connected',
  getApiUrl: () => 'http://127.0.0.1:4096/',
  getKernelRuntime: () => ({ generation: 'oc1', endpoint: 'http://127.0.0.1:4096', epoch: 1, version: '1.18.32' }),
  refreshKernelRuntime: async () => ({ generation: 'oc1', endpoint: 'http://127.0.0.1:4096', epoch: 1, version: '1.18.32' }),
  getWorkingDirectory: () => '/repo',
  getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
  onStatusChange: () => ({ dispose() {} }),
});

const createSseResponse = (chunks) => {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
};

describe('VS Code SSE proxy', () => {
  it('forwards OC2 wire frames through its API event route without an OC1 directory default', async () => {
    const manager = createManager();
    const descriptor = { generation: 'oc2', endpoint: 'http://127.0.0.1:4096', epoch: 1, version: '2.0.16' };
    manager.getKernelRuntime = () => descriptor;
    manager.refreshKernelRuntime = async () => descriptor;
    const chunks = [];
    let target;
    const wire = 'id: evt_2\ndata: {"id":"evt_2","type":"session.updated","data":{"id":"ses_1"}}\n\n';
    globalThis.fetch = mock(async (url) => {
      target = String(url);
      return createSseResponse([wire]);
    });
    const proxy = await openSseProxy({ manager, path: '/global/event', signal: new AbortController().signal, onChunk: (chunk) => chunks.push(chunk) });
    await proxy.run;
    expect(target).toBe('http://127.0.0.1:4096/api/event');
    expect(chunks.join('')).toBe(wire);
  });

  it('does not deliver an old stream chunk after a same-generation epoch change', async () => {
    const manager = createManager();
    let epoch = 1;
    manager.getKernelRuntime = () => ({ generation: 'oc2', endpoint: 'http://127.0.0.1:4096', epoch, version: '2.0.16' });
    let upstream;
    const body = new ReadableStream({ start(controller) { upstream = controller; } });
    globalThis.fetch = mock(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const chunks = [];
    const proxy = await openSseProxy({ manager, path: '/event', signal: new AbortController().signal, onChunk: (chunk) => chunks.push(chunk) });
    epoch = 2;
    upstream.enqueue(new TextEncoder().encode('data: old\n\n'));
    await expect(proxy.run).rejects.toThrow('connection changed');
    expect(chunks).toEqual([]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('forwards upstream SSE chunks without reserializing event data', async () => {
    const upstreamChunks = [
      'id: evt-1\n',
      'data: {"type":"message.part.delta","properties":{"delta":"hi"}}\n\n',
    ];
    let fetchInput;
    let fetchInit;
    globalThis.fetch = mock((input, init) => {
      fetchInput = input;
      fetchInit = init;
      return Promise.resolve(createSseResponse(upstreamChunks));
    });

    const received = [];
    const controller = new AbortController();
    const proxy = await openSseProxy({
      manager: createManager(),
      path: '/global/event',
      headers: { 'Last-Event-ID': 'evt-0' },
      signal: controller.signal,
      onChunk: (chunk) => received.push(chunk),
    });

    await proxy.run;

    expect(fetchInput).toBe('http://127.0.0.1:4096/global/event');
    expect(fetchInit.headers.Authorization).toBe('Bearer test-token');
    expect(fetchInit.headers['Last-Event-ID']).toBe('evt-0');
    expect(proxy.headers['content-type']).toContain('text/event-stream');
    expect(received.join('')).toBe(upstreamChunks.join(''));
  });

  it('adds the active directory for directory-scoped event streams', async () => {
    let fetchInput;
    globalThis.fetch = mock((input) => {
      fetchInput = input;
      return Promise.resolve(createSseResponse(['data: {"type":"server.connected"}\n\n']));
    });

    const proxy = await openSseProxy({
      manager: createManager(),
      path: '/event?foo=bar',
      signal: new AbortController().signal,
      onChunk: () => {},
    });
    await proxy.run;

    const url = new URL(fetchInput);
    expect(url.pathname).toBe('/event');
    expect(url.searchParams.get('foo')).toBe('bar');
    expect(url.searchParams.get('directory')).toBe('/repo');
  });
});
