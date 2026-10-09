import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { OPENCODE_PROFILE } from './compatibility.js';
import { OpenCodeConnectionError, parseOpenCodeConnection } from './connection.js';
import { registerOpenCodeRoutes } from './routes.js';

describe('OpenChamber kernel discovery route', () => {
  it.each([['oc1', '1.18.32'], ['oc2', '2.0.16']])('reads %s health and version from its selected protocol', async (generation, version) => {
    const app = express();
    registerOpenCodeRoutes(app, { kernelRuntime: { refresh: async () => ({ generation, version }) } });
    const health = await request(app).get('/api/opencode/health').expect(200);
    const current = await request(app).get('/api/opencode/version').expect(200);
    expect(health.body).toEqual({ healthy: true });
    expect(current.body).toEqual({ version });
  });

  it('keeps Legacy health and version diagnostics available without admitting operations', async () => {
    const app = express();
    const descriptor = { generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY, version: '1.2.27' };
    registerOpenCodeRoutes(app, { kernelRuntime: { get: () => descriptor, refresh: async () => descriptor } });
    await request(app).get('/api/opencode/health').expect(200, { healthy: true });
    await request(app).get('/api/opencode/version').expect(200, { version: '1.2.27' });
    await request(app).put('/api/provider').send({}).expect(501);
  });

  it('keeps an unknown generation unhealthy', async () => {
    const app = express();
    registerOpenCodeRoutes(app, { kernelRuntime: { refresh: async () => ({ generation: 'unknown', version: null }) } });
    await request(app).get('/api/opencode/health').expect(503, { healthy: false });
  });

  it('returns the backend descriptor without allowing caches to retain an old epoch', async () => {
    const descriptor = { generation: 'oc2', endpoint: 'http://127.0.0.1:4096', epoch: 3, version: '2.0.16' };
    const app = express();
    registerOpenCodeRoutes(app, { kernelRuntime: { refresh: async () => descriptor } });
    const response = await request(app).get('/api/opencode/runtime').expect(200);
    expect(response.body).toEqual(descriptor);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('reports a replaced connection as retryable without exposing the failure contents', async () => {
    const app = express();
    registerOpenCodeRoutes(app, { kernelRuntime: { refresh: async () => { throw new Error('private endpoint details'); } } });
    const response = await request(app).get('/api/opencode/runtime').expect(503);
    expect(response.body.error).toBe('OpenCode connection changed; retry discovery');
  });
});

describe('provider mutation protocol ownership', () => {
  it('rejects unknown kernels before resolving directories or reading files', async () => {
    let reads = 0;
    const app = express();
    app.use(express.json());
    registerOpenCodeRoutes(app, {
      kernelRuntime: { get: () => ({ generation: 'unknown' }) },
      resolveProjectDirectory: async () => { reads += 1; return { directory: '/repo' }; },
      getProviderSources: () => { reads += 1; return {}; },
    });
    await request(app).get('/api/provider/example/source').expect(503);
    await request(app).put('/api/provider').send({ providerID: 'example', config: {}, scope: 'user' }).expect(503);
    await request(app).delete('/api/provider/example/auth').expect(503);
    expect(reads).toBe(0);
  });

  it('does not remove legacy credentials through the OC2 auth route', async () => {
    let writes = 0;
    const app = express();
    registerOpenCodeRoutes(app, {
      kernelRuntime: { get: () => ({ generation: 'oc2', epoch: 1 }) },
      resolveProjectDirectory: async () => ({ directory: '/repo' }),
      removeProviderConfig: () => { writes += 1; return true; },
    });
    const result = await request(app).delete('/api/provider/example/auth?scope=auth').expect(409);
    expect(result.body.code).toBe('PROVIDER_CREDENTIAL_OWNED_BY_OPENCODE');
    expect(writes).toBe(0);
  });

  it.each(['oc1', 'oc2'])('reports the actual apply behavior for %s config removal', async (generation) => {
    const scopes = [];
    const app = express();
    registerOpenCodeRoutes(app, {
      kernelRuntime: { get: () => ({ generation, epoch: 1 }) },
      resolveProjectDirectory: async () => ({ directory: '/repo' }),
      removeProviderConfig: (_provider, _directory, scope) => { scopes.push(scope); return true; },
    });
    const result = await request(app).delete('/api/provider/example/auth?scope=user').expect(200);
    expect(scopes).toEqual(['user']);
    expect(result.body.removed).toBe(true);
    expect(result.body.requiresRestart).toBe(generation === 'oc1' ? true : undefined);
  });

  it.each(['epoch', 'profile'])('rejects a provider mutation after the selected %s changes', async (identity) => {
    let epoch = 1;
    let profile = OPENCODE_PROFILE.OC2;
    let writes = 0;
    const app = express();
    registerOpenCodeRoutes(app, {
      kernelRuntime: { get: () => ({ generation: 'oc2', profile, epoch }) },
      resolveProjectDirectory: async () => {
        if (identity === 'epoch') epoch += 1;
        else profile = undefined;
        return { directory: '/repo' };
      },
      removeProviderConfig: () => { writes += 1; return true; },
    });
    await request(app).delete('/api/provider/example/auth?scope=user').expect(409);
    expect(writes).toBe(0);
  });
});

describe('admission diagnostics over the shared host route', () => {
  it.each(['ready', 'auth', 'unreachable', 'conflict', 'mismatch', 'unsupported', 'unverified', 'invalid-endpoint', 'invalid-selection'])('serializes %s from the kernel owner', async status => {
    const { createKernelRuntime } = await import('./kernel-runtime.js');
    const runtime = createKernelRuntime({ getEndpoint: () => 'http://kernel.test', getHeaders: () => ({}), getRequestedSelection: () => 'auto',
      detectProfile: async ({ endpoint, epoch, selection }) => ({ status, selection, descriptor: { generation: 'oc2', profile: 'oc2', endpoint, epoch, version: '2.0.16' } }),
    });
    const app = express();
    registerOpenCodeRoutes(app, { kernelRuntime: runtime });
    const response = await request(app).get('/api/opencode/runtime').expect(200);
    expect(response.body.status).toBe(status);
    expect(response.body.version).toBe('2.0.16');
    expect(response.body).not.toHaveProperty('headers');
    expect(response.headers['cache-control']).toBe('no-store');
    runtime.invalidate();
    expect(runtime.get().status).toBeUndefined();
  });
});

describe('settings connection HTTP boundary without a global body parser', () => {
  it('parses a real JSON record and returns validation and active-transition errors', async () => {
    const app = express();
    let stored;
    let active = false;
    registerOpenCodeRoutes(app, { persistSettings: async changes => {
      const record = parseOpenCodeConnection(changes.opencodeConnection);
      if (active) throw new OpenCodeConnectionError('Active transition', 409);
      stored = record;
      return { opencodeConnection: record };
    } });
    const record = { version: 1, confirmed: true, mode: 'path' };
    await request(app).put('/api/config/settings').send({ opencodeConnection: { ...record, confirmed: false } }).expect(400);
    expect(stored).toBeUndefined();
    const saved = await request(app).put('/api/config/settings').send({ opencodeConnection: record }).expect(200);
    expect(saved.body).toEqual({ opencodeConnection: record }); expect(stored).toEqual(record);
    active = true;
    await request(app).put('/api/config/settings').send({ opencodeConnection: null }).expect(409);
    expect(stored).toEqual(record);
  });
});

describe('connection setup route', () => {
  it('remains readable with no admitted kernel and never caches machine discovery', async () => {
    const app = express(); let reads = 0;
    registerOpenCodeRoutes(app, { getOpenCodeConnectionOptions: async () => ({ saved: null, error: null, candidates: [], modes: [], recommendation: ++reads }) });
    for (const value of [1, 2]) {
      const result = await request(app).get('/api/config/opencode-connection').expect(200);
      expect(result.body.recommendation).toBe(value); expect(result.headers['cache-control']).toBe('no-store');
    }
  });
  it('distinguishes unsupported discovery and failed authoritative settings reads', async () => {
    const unsupported = express(); registerOpenCodeRoutes(unsupported, {});
    await request(unsupported).get('/api/config/opencode-connection').expect(501, { error: 'unsupported_runtime' });
    const failed = express(); registerOpenCodeRoutes(failed, { getOpenCodeConnectionOptions: async () => { throw new Error('sensitive path'); } });
    await request(failed).get('/api/config/opencode-connection').expect(503, { error: 'settings_unavailable' });
  });
});

describe('connection activity HTTP boundary', () => {
  it('serves read-only uncached evidence before proxy fallback', async () => {
    const app = express(); let calls = 0;
    registerOpenCodeRoutes(app, { getOpenCodeConnectionActivity: async () => ({ state: 'inactive', questions: { state: 'unknown' }, calls: ++calls }) });
    app.use((_req, res) => res.status(418).end());
    const response = await request(app).get('/api/config/opencode-connection/activity').expect(200);
    expect(response.headers['cache-control']).toBe('no-store'); expect(response.body.calls).toBe(1);
    await request(app).post('/api/config/opencode-connection/activity').expect(418);
    expect(calls).toBe(1);
  });
  it('keeps unavailable, unsupported and stale evidence distinct without error detail', async () => {
    const unsupported = express(); registerOpenCodeRoutes(unsupported, {});
    await request(unsupported).get('/api/config/opencode-connection/activity').expect(501, { error: 'unsupported_runtime' });
    for (const [error, status, code] of [[new Error('private endpoint'), 503, 'activity_unavailable'],
      [new OpenCodeConnectionError('private endpoint', 409), 409, 'activity_changed']]) {
      const app = express(); registerOpenCodeRoutes(app, { getOpenCodeConnectionActivity: async () => { throw error; } });
      await request(app).get('/api/config/opencode-connection/activity').expect(status, { error: code });
    }
  });
});
