import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import express from 'express';
import path from 'path';

import { createSseBoundaryTracker, registerOpenCodeProxy, writeSseChunkWithBackpressure } from './lib/opencode/proxy.js';
import { AGENT_ERROR } from './lib/agent/constants.js';
import { OPENCODE_GENERATION, OPENCODE_PROFILE } from './lib/opencode/compatibility.js';

const listen = (app, host = '127.0.0.1') => new Promise((resolve, reject) => {
  const server = app.listen(0, host, () => resolve(server));
  server.once('error', reject);
});

const closeServer = (server) => new Promise((resolve, reject) => {
  if (!server) {
    resolve();
    return;
  }
  server.close((error) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
});

describe('OpenCode proxy SSE forwarding', () => {
  let upstreamServer;
  let proxyServer;

  afterEach(async () => {
    await closeServer(proxyServer);
    await closeServer(upstreamServer);
    proxyServer = undefined;
    upstreamServer = undefined;
  });

  it('refuses unaccepted Legacy forwarding before prefix, readiness, credentials or transport', async () => {
    let reads = 0;
    let requests = 0;
    let prefixes = 0;
    const app = express();
    app.get('/api/health', (_req, res) => res.json({ owned: true }));
    app.get('/api/config/settings', (_req, res) => res.json({ owned: true }));
    registerOpenCodeProxy(app, {
      fs: {}, os: {}, path, OPEN_CODE_READY_GRACE_MS: 6000,
      getRuntime: () => { reads += 1; return { openCodePort: null, isOpenCodeReady: false }; },
      getKernelRuntime: () => ({ generation: OPENCODE_GENERATION.OC1, profile: OPENCODE_PROFILE.LEGACY, endpoint: null, epoch: 1 }),
      getOpenCodeAuthHeaders: () => { throw new Error('must not read credentials'); },
      buildOpenCodeUrl: () => { requests += 1; throw new Error('must not forward'); },
      ensureOpenCodeApiPrefix: () => { prefixes += 1; },
    });
    reads = 0;
    proxyServer = await listen(app);
    const origin = 'http://127.0.0.1:' + proxyServer.address().port;
    for (const [route, method] of [['config', 'GET'], ['config/agents', 'POST'], ['session/s/message', 'POST'], ['event', 'GET'], ['global/event', 'GET'], ['provider/p/oauth/callback', 'POST'], ['mcp/m/auth/authenticate', 'POST']]) {
      const response = await fetch(origin + '/api/' + route, { method });
      expect(response.status).toBe(501);
      expect(await response.json()).toEqual({ error: AGENT_ERROR.UNACCEPTED, profile: OPENCODE_PROFILE.LEGACY });
    }
    for (const route of ['health', 'config/settings']) {
      expect(await (await fetch(origin + '/api/' + route)).json()).toEqual({ owned: true });
    }
    expect(reads).toBe(0);
    expect(requests).toBe(0);
    expect(prefixes).toBe(0);
  });

  it('refuses a held readiness request when its profile becomes Legacy', async () => {
    let profile = OPENCODE_PROFILE.OC1;
    let enter;
    const entered = new Promise((resolve) => { enter = resolve; });
    const app = express();
    registerOpenCodeProxy(app, {
      fs: {}, os: {}, path, OPEN_CODE_READY_GRACE_MS: 6000,
      getRuntime: () => { if (proxyServer) enter(); return { openCodePort: null, isOpenCodeReady: false }; },
      getKernelRuntime: () => ({ generation: OPENCODE_GENERATION.OC1, profile, endpoint: null, epoch: 1 }),
      getOpenCodeAuthHeaders: () => { throw new Error('must not read credentials'); },
      buildOpenCodeUrl: () => { throw new Error('must not forward'); }, ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const response = fetch('http://127.0.0.1:' + proxyServer.address().port + '/api/config');
    await entered;
    profile = OPENCODE_PROFILE.LEGACY;
    const refused = await response;
    expect(refused.status).toBe(501);
    expect(await refused.json()).toEqual({ error: AGENT_ERROR.UNACCEPTED, profile: OPENCODE_PROFILE.LEGACY });
  });

  it('refuses unsupported HTTP, mutation and SSE paths before readiness or upstream work', async () => {
    let reads = 0;
    let requests = 0;
    const app = express();
    app.get('/api/health', (_req, res) => res.json({ owned: true }));
    registerOpenCodeProxy(app, {
      fs: {}, os: {}, path, OPEN_CODE_READY_GRACE_MS: 6000,
      getRuntime: () => { reads += 1; return { openCodePort: null, isOpenCodeReady: false }; },
      getKernelRuntime: () => ({ generation: OPENCODE_GENERATION.UNSUPPORTED, endpoint: null, epoch: 1 }),
      getOpenCodeAuthHeaders: () => { throw new Error('must not read credentials'); },
      buildOpenCodeUrl: () => { requests += 1; throw new Error('must not forward'); },
      ensureOpenCodeApiPrefix: () => {},
    });
    reads = 0; // Registration reads runtime only to choose its diagnostic line.
    proxyServer = await listen(app);
    const origin = `http://127.0.0.1:${proxyServer.address().port}`;
    for (const [route, method] of [['config', 'GET'], ['session/s/message', 'POST'], ['event', 'GET'], ['global/event', 'GET']]) {
      const response = await fetch(`${origin}/api/${route}`, { method });
      expect(response.status).toBe(501);
      expect(await response.json()).toEqual({ error: AGENT_ERROR.UNSUPPORTED });
    }
    expect(await (await fetch(`${origin}/api/health`)).json()).toEqual({ owned: true });
    expect(reads).toBe(0);
    expect(requests).toBe(0);
  });

  it('refuses a held readiness request when its descriptor becomes unsupported', async () => {
    let generation = OPENCODE_GENERATION.UNKNOWN;
    let enter;
    const entered = new Promise((resolve) => { enter = resolve; });
    const app = express();
    registerOpenCodeProxy(app, {
      fs: {}, os: {}, path, OPEN_CODE_READY_GRACE_MS: 6000,
      getRuntime: () => { if (proxyServer) enter(); return { openCodePort: null, isOpenCodeReady: false }; },
      getKernelRuntime: () => ({ generation, endpoint: null, epoch: 1 }),
      getOpenCodeAuthHeaders: () => { throw new Error('must not read credentials'); },
      buildOpenCodeUrl: () => { throw new Error('must not forward'); }, ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const response = fetch(`http://127.0.0.1:${proxyServer.address().port}/api/config`);
    await entered;
    generation = OPENCODE_GENERATION.UNSUPPORTED;
    const refused = await response;
    expect(refused.status).toBe(501);
    expect(await refused.json()).toEqual({ error: AGENT_ERROR.UNSUPPORTED });
  });

  it('discards an upstream SSE result after a profile-only change', async () => {
    let profile = OPENCODE_PROFILE.OC1;
    let enter;
    let finish;
    const entered = new Promise((resolve) => { enter = resolve; });
    const upstream = express();
    upstream.get('/global/event', (_req, res) => {
      finish = () => { res.setHeader('Content-Type', 'text/event-stream'); res.end('data: stale\n\n'); };
      enter();
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const app = express();
    registerOpenCodeProxy(app, {
      fs: {}, os: {}, path, OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({ openCodePort: upstreamPort, isOpenCodeReady: true }),
      getKernelRuntime: () => ({ generation: OPENCODE_GENERATION.OC1, profile, endpoint: 'http://127.0.0.1:' + upstreamPort, epoch: 1 }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => 'http://127.0.0.1:' + upstreamPort + requestPath,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const pending = fetch('http://127.0.0.1:' + proxyServer.address().port + '/api/global/event');
    await entered;
    profile = OPENCODE_PROFILE.LEGACY;
    finish();
    expect(await (await pending).text()).toBe('');
  });

  it('forwards event streams with nginx-safe headers', async () => {
    let seenAuthorization = null;

    const upstream = express();
    upstream.get('/global/event', (req, res) => {
      seenAuthorization = req.headers.authorization ?? null;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'private, max-age=0');
      res.setHeader('X-Upstream-Test', 'ok');
      res.write('data: {"ok":true}\n\n');
      res.end();
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/global/event`, {
      headers: { Accept: 'text/event-stream' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('x-upstream-test')).toBe('ok');
    expect(await response.text()).toBe('data: {"ok":true}\n\n');
    expect(seenAuthorization).toBe('Bearer test-token');
  });

  it('closes downstream SSE when the OpenCode upstream stalls despite proxy heartbeats', async () => {
    let stallTimeoutReads = 0;
    const upstream = express();
    upstream.get('/global/event', (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      res.write(':upstream-alive\n\n');
      res.write('data: still-alive\n\n');
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      SSE_HEARTBEAT_INTERVAL_MS: 10,
      getSseUpstreamStallTimeoutMs: () => {
        stallTimeoutReads += 1;
        return 200;
      },
      getRuntime: () => ({
        openCodePort: upstreamPort,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/global/event`, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(2000),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(':heartbeat\n\n');
    expect(body).toContain(':upstream-alive\n\n');
    expect(body).toContain('data: still-alive\n\n');
    expect(stallTimeoutReads).toBeGreaterThanOrEqual(1);
  });

  it('holds a request through OpenCode warmup and succeeds once ready (no 503/backoff)', async () => {
    const upstream = express();
    upstream.get('/config/providers', (_req, res) => {
      res.json({ ok: true });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const runtime = {
      openCodePort: upstreamPort,
      isOpenCodeReady: false,
      openCodeNotReadySince: 0,
      isRestartingOpenCode: false,
    };
    // OpenCode becomes ready shortly after the request arrives.
    setTimeout(() => { runtime.isOpenCodeReady = true; }, 200);

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 5000,
      getRuntime: () => runtime,
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('returns 503 fast when OpenCode never becomes ready', async () => {
    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      // Zero grace → hold window collapses to nothing → fail fast.
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: 0,
        isOpenCodeReady: false,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:1${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ restarting: true });
  });

  it('waits for drain when writing to a slow SSE response', async () => {
    const writes = [];
    const res = new EventEmitter();
    res.writableEnded = false;
    res.destroyed = false;
    res.write = (value) => {
      writes.push(value);
      return false;
    };
    const controller = new AbortController();

    const write = writeSseChunkWithBackpressure(res, Buffer.from('data: {"ok":true}\n\n'), controller.signal);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toHaveLength(1);

    res.emit('drain');

    await expect(write).resolves.toBe(true);
  });

  it('tracks whether a raw SSE stream is between event blocks', () => {
    const tracker = createSseBoundaryTracker();

    expect(tracker.isAtBoundary()).toBe(true);
    expect(tracker.observe(Buffer.from('id: evt-1\n'))).toBe(false);
    expect(tracker.observe(Buffer.from('data: {"ok"'))).toBe(false);
    expect(tracker.observe(Buffer.from(':true}\n'))).toBe(false);
    expect(tracker.observe(Buffer.from('\n'))).toBe(true);
    expect(tracker.observe(Buffer.from('data: next\r\n\r\n'))).toBe(true);
  });

  it('routes generic API requests through external OpenCode base URL', async () => {
    const upstream = express();
    upstream.get('/config/providers', (_req, res) => {
      res.json({ ok: true, source: 'external-host' });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: 3902,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, source: 'external-host' });
  });

  it('replays parsed urlencoded bodies to generic API proxy requests', async () => {
    const upstream = express();
    upstream.post('/form', express.urlencoded({ extended: true }), (req, res) => {
      res.json({ body: req.body });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    app.use('/api', express.urlencoded({ extended: true }));
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/form`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ messageID: 'msg_1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ body: { messageID: 'msg_1' } });
  });

  it('replays parsed JSON bodies to generic API proxy requests', async () => {
    const upstream = express();
    upstream.post('/session/abc/prompt_async', express.json(), (req, res) => {
      res.json({
        body: req.body,
        authorization: req.headers.authorization,
        contentLength: req.headers['content-length'],
      });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    app.use('/api', express.json());
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer replay-token' }),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const payload = { messageID: 'msg_1', parts: [{ type: 'text', text: 'hello' }] };
    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/session/abc/prompt_async`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.body).toEqual(payload);
    expect(data.authorization).toBe('Bearer replay-token');
    expect(Number(data.contentLength)).toBeGreaterThan(0);
  });

  it('sanitizes experimental session list responses and forwards query params', async () => {
    let seenQuery = null;
    let seenAuth = null;

    const upstream = express();
    upstream.get('/experimental/session', (req, res) => {
      seenQuery = req.query;
      seenAuth = req.headers.authorization ?? null;
      res.setHeader('X-Next-Cursor', '123');
      res.json([
        {
          id: 'ses_1',
          slug: 'alpha',
          projectID: 'proj_1',
          workspaceID: 'ws_1',
          directory: '/repo/app',
          path: '/repo/app',
          parentID: 'ses_parent',
          title: 'Alpha',
          agent: 'build',
          model: { id: 'gpt-5', providerID: 'openai', variant: 'default' },
          version: '1.0.0',
          time: { created: 1, updated: 2 },
          cost: 7,
          tokens: { input: 10, output: 20 },
          share: { url: 'https://share.example/ses_1' },
          project: { id: 'proj_1', worktree: '/repo/app' },
          summary: {
            additions: 5,
            deletions: 3,
            files: 2,
            diffs: [{ patch: '@@ -1 +1 @@', additions: 5, deletions: 3 }],
          },
          metadata: { openchamber: { kind: 'review', originalSessionID: 'ses_original' } },
          permission: [{ permission: 'todowrite', action: 'deny', pattern: '*' }],
          revert: { messageID: 'msg_1', partID: 'part_1', snapshot: 'abc123', diff: 'diff --git a/x b/x' },
        },
      ]);
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {
        promises: {
          realpath: async (value) => value === '/link/repo' ? '/real/repo' : value,
        },
      },
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer session-token' }),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/experimental/session?archived=false&limit=500&cursor=99&roots=true&directory=%2Flink%2Frepo`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-next-cursor')).toBe('123');
    expect(seenAuth).toBe('Bearer session-token');
    expect(seenQuery).toMatchObject({
      archived: 'false',
      limit: '500',
      cursor: '99',
      roots: 'true',
      directory: '/real/repo',
    });

    await expect(response.json()).resolves.toEqual([
      {
        id: 'ses_1',
        slug: 'alpha',
        projectID: 'proj_1',
        workspaceID: 'ws_1',
        directory: '/repo/app',
        path: '/repo/app',
        parentID: 'ses_parent',
        title: 'Alpha',
        agent: 'build',
        model: { id: 'gpt-5', providerID: 'openai', variant: 'default' },
        version: '1.0.0',
        time: { created: 1, updated: 2 },
        cost: 7,
        tokens: { input: 10, output: 20 },
        share: { url: 'https://share.example/ses_1' },
        metadata: { openchamber: { kind: 'review', originalSessionID: 'ses_original' } },
        project: { id: 'proj_1', worktree: '/repo/app' },
        summary: { additions: 5, deletions: 3, files: 2 },
        revert: { messageID: 'msg_1', partID: 'part_1' },
      },
    ]);
  });

  it('sanitizes session list responses without sanitizing session detail responses', async () => {
    let seenListQuery = null;

    const upstream = express();
    upstream.get('/session', (req, res) => {
      seenListQuery = req.query;
      res.json([
        {
          id: 'ses_1',
          directory: '/repo/app',
          title: 'Alpha',
          time: { created: 1, updated: 2 },
          summary: {
            additions: 5,
            deletions: 3,
            files: 2,
            diffs: [{ patch: '@@ -1 +1 @@', additions: 5, deletions: 3 }],
          },
          metadata: { custom: { value: 'kept' } },
          revert: { messageID: 'msg_1', partID: 'part_1', snapshot: 'abc123', diff: 'diff --git a/x b/x' },
        },
      ]);
    });
    upstream.get('/session/abc', (_req, res) => {
      res.json({
        id: 'abc',
        directory: '/repo/app',
        title: 'Detail',
        summary: { diffs: [{ patch: '@@ -1 +1 @@' }] },
        revert: { messageID: 'msg_1', snapshot: 'abc123', diff: 'diff --git a/x b/x' },
      });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {
        promises: {
          realpath: async (value) => value === '/link/repo' ? '/real/repo' : value,
        },
      },
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const listResponse = await fetch(`http://127.0.0.1:${proxyPort}/api/session?directory=%2Flink%2Frepo`);

    expect(listResponse.status).toBe(200);
    expect(seenListQuery).toMatchObject({ directory: '/real/repo' });
    await expect(listResponse.json()).resolves.toEqual([
      {
        id: 'ses_1',
        directory: '/repo/app',
        title: 'Alpha',
        time: { created: 1, updated: 2 },
        summary: { additions: 5, deletions: 3, files: 2 },
        metadata: { custom: { value: 'kept' } },
        revert: { messageID: 'msg_1', partID: 'part_1' },
      },
    ]);

    const detailResponse = await fetch(`http://127.0.0.1:${proxyPort}/api/session/abc`);

    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toEqual({
      id: 'abc',
      directory: '/repo/app',
      title: 'Detail',
      summary: { diffs: [{ patch: '@@ -1 +1 @@' }] },
      revert: { messageID: 'msg_1', snapshot: 'abc123', diff: 'diff --git a/x b/x' },
    });
  });

  it('merges only the unscoped first OC2 session page with Spaces', async () => {
    const upstream = express();
    upstream.get('/api/session', (req, res) => res.json({
      data: [{ id: 'h1', location: { directory: '/repo' }, title: 'host', permissions: {} }],
      cursor: { next: req.query.cursor ? undefined : 'p2' },
    }));
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const merges = [];
    const app = express();
    registerOpenCodeProxy(app, {
      fs: {}, os: {}, path, OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({ openCodePort: upstreamPort, isOpenCodeReady: true, openCodeNotReadySince: 0, isRestartingOpenCode: false }),
      getKernelRuntime: () => ({ generation: 'oc2', endpoint: `http://127.0.0.1:${upstreamPort}`, epoch: 1 }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
      mergeSpaceSessionList: async (payload) => {
        merges.push(payload);
        return { ...payload, data: [...payload.data, { id: 's1', location: { directory: '/spaces/a1b2c3d4e5f6/repo' } }], spaces: [{ id: 'a1b2c3d4e5f6', state: 'complete', sessions: 1 }] };
      },
    });
    proxyServer = await listen(app);
    const base = `http://127.0.0.1:${proxyServer.address().port}`;

    const first = await (await fetch(`${base}/api/session?limit=50`)).json();
    expect(first.data.map((item) => item.id)).toEqual(['h1', 's1']);
    expect(first.spaces).toEqual([{ id: 'a1b2c3d4e5f6', state: 'complete', sessions: 1 }]);
    expect(merges[0].data[0]).not.toHaveProperty('permissions');
    const second = await (await fetch(`${base}/api/session?limit=50&cursor=p2`)).json();
    expect(second.data.map((item) => item.id)).toEqual(['h1']);
    expect(second.spaces).toBeUndefined();
    const scoped = await (await fetch(`${base}/api/session?limit=50&directory=${encodeURIComponent('/repo')}`)).json();
    expect(scoped.spaces).toBeUndefined();
    const scopedByHeader = await (await fetch(`${base}/api/session?limit=50`, { headers: { 'x-opencode-directory': '/repo' } })).json();
    expect(scopedByHeader.spaces).toBeUndefined();
    expect(merges).toHaveLength(1);
  });

  it('interleaves Space events into OC2 global SSE after whole host blocks', async () => {
    const upstream = express();
    let upstreamRes = null;
    upstream.get('/api/event', (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      res.write('data: {"id":"h1","type":"host"}\n\n');
      upstreamRes = res;
      res.on('close', () => { if (upstreamRes === res) upstreamRes = null; });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const subscribers = new Set();
    const spaceEventHub = {
      subscribeEvent: (subscriber, options) => {
        const entry = { subscriber, options };
        subscribers.add(entry);
        return () => subscribers.delete(entry);
      },
    };
    const app = express();
    registerOpenCodeProxy(app, {
      fs: {}, os: {}, path, OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({ openCodePort: upstreamPort, isOpenCodeReady: true, openCodeNotReadySince: 0, isRestartingOpenCode: false }),
      getKernelRuntime: () => ({ generation: 'oc2', endpoint: `http://127.0.0.1:${upstreamPort}`, epoch: 1 }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
      spaceEventHub,
    });
    proxyServer = await listen(app);
    const base = `http://127.0.0.1:${proxyServer.address().port}`;

    const scopedController = new AbortController();
    const scoped = await fetch(`${base}/api/event`, { headers: { Accept: 'text/event-stream', 'x-opencode-directory': '/repo' }, signal: scopedController.signal });
    expect(scoped.status).toBe(200);
    expect(subscribers.size).toBe(0);
    scopedController.abort();

    const controller = new AbortController();
    const response = await fetch(`${base}/api/global/event`, { headers: { Accept: 'text/event-stream' }, signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = '';
    const readUntil = async (needle) => {
      while (!body.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
      }
    };
    await readUntil('"h1"');
    expect(subscribers.size).toBe(1);
    const [{ subscriber, options }] = subscribers;
    expect(options).toEqual({ spaces: true });
    subscriber({ spaceId: null, payload: { id: 'x', type: 'host-from-hub' } });
    subscriber({ spaceId: 'a1b2c3d4e5f6', payload: { id: 's1', type: 'session.execution.started' } });
    await readUntil('"s1"');
    expect(body).not.toContain('host-from-hub');
    upstreamRes.write('data: {"id":"h2",');
    await readUntil('"h2"');
    subscriber({ spaceId: 'a1b2c3d4e5f6', payload: { id: 's2', type: 'session.execution.succeeded' } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(body).not.toContain('"s2"');
    upstreamRes.write('"type":"host"}\n\n');
    await readUntil('"s2"');
    expect(body.indexOf('"h2"')).toBeLessThan(body.indexOf('"s2"'));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(subscribers.size).toBe(0);
  });

  it('forwards unparsed SDK JSON bodies to generic API proxy requests', async () => {
    const upstream = express();
    upstream.post('/session/abc/revert', express.json(), (req, res) => {
      res.json({
        body: req.body,
        contentLength: req.headers['content-length'],
      });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const payload = { messageID: 'msg_1' };
    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/session/abc/revert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.body).toEqual(payload);
    expect(Number(data.contentLength)).toBeGreaterThan(0);
  });

  it('uses the long proxy timeout budget for slow upstream responses', async () => {
    const upstream = express();
    upstream.get('/slow', (_req, _res) => {
      // Leave the response open so the proxy timeout path is exercised.
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      LONG_REQUEST_TIMEOUT_MS: 50,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/slow`, {
      signal: AbortSignal.timeout(2000),
    });

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({ error: 'OpenCode upstream timed out' });
  });

  it('exempts interactive provider OAuth callbacks from the request deadline', async () => {
    const upstream = express();
    // Stands in for upstream blocking until the user finishes signing in.
    upstream.post('/provider/:providerID/oauth/callback', async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      res.json(true);
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      LONG_REQUEST_TIMEOUT_MS: 50,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/provider/github-copilot/oauth/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 0 }),
      signal: AbortSignal.timeout(5000),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBe(true);
  });

  it('still applies the request deadline to the OAuth authorize call', async () => {
    const upstream = express();
    upstream.post('/provider/:providerID/oauth/authorize', (_req, _res) => {
      // Leave the response open so the proxy timeout path is exercised.
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      LONG_REQUEST_TIMEOUT_MS: 50,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/provider/github-copilot/oauth/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 0 }),
      signal: AbortSignal.timeout(2000),
    });

    expect(response.status).toBe(504);
  });
});
