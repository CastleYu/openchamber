import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
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

  it('rejects a mutation after the selected connection changes', async () => {
    let epoch = 1;
    let writes = 0;
    const app = express();
    registerOpenCodeRoutes(app, {
      kernelRuntime: { get: () => ({ generation: 'oc2', epoch }) },
      resolveProjectDirectory: async () => { epoch += 1; return { directory: '/repo' }; },
      removeProviderConfig: () => { writes += 1; return true; },
    });
    await request(app).delete('/api/provider/example/auth?scope=user').expect(409);
    expect(writes).toBe(0);
  });
});
