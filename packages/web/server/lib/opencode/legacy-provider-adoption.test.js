import express from 'express';
import { spawn } from 'node:child_process';
import { createFsSearchRuntime } from '../fs/search.js';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createFeatureRoutesRuntime } from './feature-routes-runtime.js';
import { describe, expect, it, vi } from 'vitest';
import { createGracefulShutdownRuntime } from './shutdown-runtime.js';

describe('legacy provider Web adoption', () => {
  it('disposes the host owner through graceful shutdown', async () => {
    const dispose = vi.fn();
    const runtime = createGracefulShutdownRuntime({
      process: { exit: vi.fn() }, shutdownTimeoutMs: 100, getExitOnShutdown: () => false,
      getIsShuttingDown: () => false, setIsShuttingDown: vi.fn(), syncToHmrState: vi.fn(),
      openCodeWatcherRuntime: { stop: vi.fn() }, sessionRuntime: { dispose: vi.fn() },
      scheduledTasksRuntime: { stop: vi.fn() }, getHealthCheckInterval: () => null,
      clearHealthCheckInterval: vi.fn(), getTerminalRuntime: () => null, setTerminalRuntime: vi.fn(),
      getMessageStreamRuntime: () => null, setMessageStreamRuntime: vi.fn(), shouldSkipOpenCodeStop: () => true,
      getOpenCodePort: () => null, getOpenCodeProcess: () => null, setOpenCodeProcess: vi.fn(),
      killProcessOnPort: vi.fn(), waitForPortRelease: vi.fn(async () => true), getServer: () => null,
      getUiAuthController: () => null, setUiAuthController: vi.fn(), getActiveTunnelController: () => null,
      setActiveTunnelController: vi.fn(), tunnelAuthController: { clearActiveTunnel: vi.fn() },
      beginGuestServiceShutdown: vi.fn(), stopAllGuestServices: vi.fn(), getGuestSurfaceRuntime: () => null,
      getRealtimeProxyRuntime: () => null, getDictationRuntime: () => null, getRelayService: () => null,
      getRelayReconcileTimer: () => null, getLegacyProviderRuntime: () => ({ dispose }),
    });
    await runtime.gracefulShutdown();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

});

it('registers and serves the real feature host with composed credential headers', async () => {
  const servers = [];
  const listen = async app => {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return 'http://127.0.0.1:' + server.address().port;
  };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-provider-entry-'));
  let feature;
  const ownerId = Symbol('native');
  const listeners = new Set();
  const headers = [];
  try {
    await fs.writeFile(path.join(directory, 'registry.json'), JSON.stringify({ version: 1, extensions: [] }));
    const upstream = express();
    upstream.get('/provider/auth', (req, res) => {
      headers.push(req.get('authorization'));
      res.json({ openai: [{ type: 'api', label: 'API key' }] });
    });
    const endpoint = await listen(upstream);
    const identity = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint, epoch: 1 };
    feature = createFeatureRoutesRuntime({
      getNativeConfigContext: () => ({ id: ownerId, env: {}, cwd: directory }),
      subscribeCredentialOwner: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      getUiAuth: () => ({ enabled: false, requireAuth: (_req, _res, next) => next(),
        resolveVerifiedAuthContext: async () => ({ type: 'client', clientId: 'entry-test' }) }),
    });
    const app = express();
    app.use(express.json());
    await feature.registerRoutes(app, {
      crypto, fs: await import('node:fs'), os, path, fsPromises: fs, spawn, createFsSearchRuntime,
      openchamberDataDir: directory, openchamberUserConfigRoot: directory, managedChatsRoot: directory,
      builtInExtensionsDir: directory,
      kernelRuntime: { get: () => identity }, kernelOperations: {}, openChamberSessionService: {}, openChamberControlService: {},
      getBackendSelection: () => ({ family: 'opencode', revision: 1 }),
      getOpenCodeAuthHeaders: () => ({ authorization: 'Bearer fixture-only' }),
    });
    const url = await listen(app);
    const response = await fetch(url + '/api/legacy/providers/methods', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity, directory }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ openai: [{ type: 'api', label: 'API key' }] });
    expect(headers).toEqual(['Bearer fixture-only']);
    expect(listeners.size).toBe(1);
    feature.getLegacyProviderRuntime().dispose();
    expect(listeners.size).toBe(0);
  } finally {
    feature?.getLegacyProviderRuntime()?.dispose();
    await Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
