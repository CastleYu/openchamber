import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

import { registerOpenCodeProxy, retireOpenCodeDirectSseStreams } from './proxy.js';

const createApp = () => {
  const routes = new Map();
  const settings = new Map();
  return {
    routes,
    get(key, handler) { if (handler) routes.set(key, handler); else return settings.get(key); },
    set(key, value) { settings.set(key, value); },
    use() {}, post() {},
  };
};

const proxyDeps = (getKernelRuntime, extra = {}) => ({
  fs: { promises: { realpath: async (value) => value } }, os: {}, path: {},
  getRuntime: () => ({ openCodePort: 49303, openCodeBaseUrl: 'http://127.0.0.1:49303' }),
  getKernelRuntime,
  getOpenCodeAuthHeaders: () => ({}),
  buildOpenCodeUrl: (value) => `http://127.0.0.1:49303${value}`,
  ensureOpenCodeApiPrefix() {},
  ...extra,
});

it.each(['getArchivedSessions', 'getStoredSessionMetadata'])(
  'returns 503 when OC2 %s overlay read fails', async (reader) => {
    const app = createApp();
    registerOpenCodeProxy(app, proxyDeps(() => ({ generation: 'oc2', endpoint: 'http://127.0.0.1:49303', epoch: 1 }), {
      getArchivedSessions: async () => ({}),
      getStoredSessionMetadata: async () => ({}),
      [reader]: async () => { throw new Error('disk unavailable'); },
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ id: 's', time: {} }]), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const req = { originalUrl: '/api/session', headers: {}, method: 'GET' };
    const res = {
      statusCode: 200, headersSent: false,
      status(code) { this.statusCode = code; return this; },
      setHeader() {},
      json(value) { this.body = value; this.headersSent = true; return this; },
      end(value) { this.body = value; this.headersSent = true; },
    };
    try {
      await app.routes.get('/api/session')(req, res, () => {});
      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ error: 'OpenCode service unavailable' });
    } finally { fetchSpy.mockRestore(); }
  },
);

it('treats a malformed configured OC2 overlay as failure', async () => {
  const app = createApp();
  registerOpenCodeProxy(app, proxyDeps(() => ({ generation: 'oc2', endpoint: 'http://127.0.0.1:49303', epoch: 1 }), {
    getArchivedSessions: async () => [],
    getStoredSessionMetadata: async () => ({}),
  }));
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ id: 's' }]), {
    headers: { 'content-type': 'application/json' },
  }));
  const res = {
    statusCode: 200, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    setHeader() {}, json(value) { this.body = value; this.headersSent = true; return this; },
    end() {},
  };
  try {
    await app.routes.get('/api/session')({ originalUrl: '/api/session', headers: {}, method: 'GET' }, res, () => {});
    expect(res.statusCode).toBe(503);
  } finally { fetchSpy.mockRestore(); }
});

it('returns 503 for an OC2 session detail when its archive overlay cannot be read', async () => {
  const app = createApp();
  registerOpenCodeProxy(app, proxyDeps(() => ({ generation: 'oc2', endpoint: 'http://127.0.0.1:49303', epoch: 1 }), {
    getArchivedSessions: async () => { throw new Error('archive unavailable'); },
  }));
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 's', time: {} }), {
    headers: { 'content-type': 'application/json' },
  }));
  const res = {
    statusCode: 200, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    setHeader() {}, json(value) { this.body = value; this.headersSent = true; return this; },
    end() {},
  };
  try {
    await app.routes.get('/api/session/:sessionID')({ originalUrl: '/api/session/s', headers: {}, method: 'GET' }, res, () => {});
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'OpenCode service unavailable' });
  } finally { fetchSpy.mockRestore(); }
});

it.each(['oc1', 'oc2'])('retires a direct %s SSE response when the selected kernel changes', async (generation) => {
  let runtime = { generation, endpoint: 'http://127.0.0.1:49303', epoch: 1 };
  const app = createApp();
  registerOpenCodeProxy(app, proxyDeps(() => runtime));
  let upstream;
  let upstreamSignal;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    upstreamSignal = options.signal;
    return new Response(new ReadableStream({ start(controller) { upstream = controller; } }), {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const req = new EventEmitter();
  req.originalUrl = generation === 'oc1' ? '/api/global/event' : '/api/event';
  req.headers = {};
  const chunks = [];
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false, destroyed: false,
    status() { return this; }, setHeader() {}, flushHeaders() {},
    write(value) { chunks.push(String(value)); return true; },
    end() { this.writableEnded = true; this.emit('finish'); },
  });
  try {
    const pending = app.routes.get(req.originalUrl)(req, res);
    await vi.waitFor(() => expect(upstream).toBeTruthy());
    runtime = { ...runtime, epoch: 2 };
    retireOpenCodeDirectSseStreams();
    await vi.waitFor(() => expect(res.writableEnded).toBe(true));
    expect(upstreamSignal.aborted).toBe(true);
    await pending;
    expect(chunks).not.toContain('data: stale\n\n');
  } finally {
    req.emit('close');
    fetchSpy.mockRestore();
  }
});

it('discards an SSE read completed after the selected epoch changed', async () => {
  let runtime = { generation: 'oc2', endpoint: 'http://127.0.0.1:49303', epoch: 1 };
  const app = createApp();
  registerOpenCodeProxy(app, proxyDeps(() => runtime));
  let upstream;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new ReadableStream({
    start(controller) { upstream = controller; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  const req = new EventEmitter();
  req.originalUrl = '/api/event';
  req.headers = {};
  const chunks = [];
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false, destroyed: false,
    status() { return this; }, setHeader() {}, flushHeaders() {},
    write(value) { chunks.push(String(value)); return true; },
    end() { this.writableEnded = true; this.emit('finish'); },
  });
  try {
    const pending = app.routes.get('/api/event')(req, res);
    await vi.waitFor(() => expect(upstream).toBeTruthy());
    runtime = { ...runtime, epoch: 2 };
    upstream.enqueue(new TextEncoder().encode('data: stale\n\n'));
    await pending;
    expect(chunks).toEqual([]);
    expect(res.writableEnded).toBe(true);
  } finally {
    req.emit('close');
    fetchSpy.mockRestore();
  }
});

it.each([
  ['oc1', '/api/global/event', '/global/event', '%2Fwork%20dir', 'uri', '/work dir', null],
  ['oc2', '/api/global/event', '/api/event', '%2Fwork%20dir', 'uri', '%2Fwork%20dir', 'uri'],
])('forwards %s SSE through its own route and directory header contract', async (generation, route, path, header, encoding, forwarded, forwardedEncoding) => {
  const routes = new Map();
  const settings = new Map();
  const app = {
    get(key, handler) { if (handler) routes.set(key, handler); else return settings.get(key); },
    set(key, value) { settings.set(key, value); },
    use() {}, post() {},
  };
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', {
    status: 503, headers: { 'content-type': 'text/plain' },
  }));
  try {
    registerOpenCodeProxy(app, {
      fs: { promises: { realpath: async (value) => value } },
      os: {}, path: {},
      getRuntime: () => ({ openCodePort: 49303, openCodeBaseUrl: 'http://127.0.0.1:49303' }),
      getKernelRuntime: () => ({ generation, endpoint: 'http://127.0.0.1:49303', epoch: 1 }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (value) => `http://127.0.0.1:49303${value}`,
      ensureOpenCodeApiPrefix() {},
    });
    const req = new EventEmitter();
    req.originalUrl = route;
    req.headers = { 'x-opencode-directory': header };
    if (encoding) req.headers['x-opencode-directory-encoding'] = encoding;
    const res = { status() { return this; }, setHeader() {}, end() {} };
    await routes.get(route)(req, res);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe(`http://127.0.0.1:49303${path}`);
    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers['x-opencode-directory']).toBe(forwarded);
    expect(headers['x-opencode-directory-encoding'] ?? null).toBe(forwardedEncoding);
  } finally {
    fetchSpy.mockRestore();
  }
});
