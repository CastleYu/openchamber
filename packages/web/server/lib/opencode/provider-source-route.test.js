import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { registerOpenCodeRoutes } from './routes.js';
import { configureOpenCodeCredentials } from './auth.js';

const createApp = (getProviderSources = vi.fn(), generation = 'oc1') => {
  const app = express();
  app.use(express.json());
  const descriptor = { generation, endpoint: 'http://local', epoch: 1, version: generation === 'oc2' ? '2.0.20' : '1.18.31' };
  configureOpenCodeCredentials(() => descriptor, { list: async () => [] });
  registerOpenCodeRoutes(app, {
    kernelRuntime: { get: () => descriptor },
    resolveProjectDirectory: async () => ({ directory: '/projects/app' }),
    getProviderSources,
  });
  return app;
};

afterEach(() => configureOpenCodeCredentials(() => ({ generation: 'oc1' }), null));

describe('enterprise provider route boundary', () => {
  it('refuses alternate provider-connect spellings but permits remote MCP OAuth', async () => {
    process.env.OPENCHAMBER_ENTERPRISE_MODE = '1';
    try {
      const agent = request(createApp());
      for (const route of [
        '/API/integration/openai/connect/key',
        '/api//integration/openai/connect/key',
        '/api/integration/openai/%63onnect/key',
        '/api/integration/openai/connect/key;x',
        '/api/credential',
        '/API//credential',
      ]) {
        const response = await agent.post(route).send({ key: 'test' });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('enterprise_mode');
      }
      const mcp = await agent.post('/api/integration/mcp_0123456789abcdef/connect/oauth').send({});
      expect(mcp.status).toBe(404);
    } finally {
      delete process.env.OPENCHAMBER_ENTERPRISE_MODE;
    }
  });
});

describe('credential list proxy boundary', () => {
  it.each([false, true])('returns 403 for GET and HEAD in enterprise=%s', async (enterprise) => {
    if (enterprise) process.env.OPENCHAMBER_ENTERPRISE_MODE = '1';
    try {
      const agent = request(createApp());
      for (const route of ['/api/credential', '/API//credential/', '/api/%63redential']) {
        expect((await agent.get(route)).status).toBe(403);
      }
      expect((await agent.head('/api/credential')).status).toBe(403);
      expect((await agent.get('/api/credential')).body.code).toBe('credential_list_refused');
      expect((await agent.post('/api/credential/cred_1/activate')).status).toBe(404);
    } finally {
      delete process.env.OPENCHAMBER_ENTERPRISE_MODE;
    }
  });
});

describe('GET /api/provider/:providerId/source', () => {
  it.each(['oc1', 'oc2'])('returns a stored provider entry and its layer sources on %s', async (generation) => {
    const config = { name: 'Stored', settings: { baseURL: 'https://gateway.test/v1' } };
    const getProviderSources = vi.fn(() => ({ config, sources: {
      auth: { exists: false },
      user: { exists: false, path: '/user.json' },
      project: { exists: true, path: '/projects/app/opencode.json' },
      custom: { exists: false, path: null },
    } }));
    const response = await request(createApp(getProviderSources, generation))
      .get('/api/provider/stored/source?directory=/projects/app');
    expect(response.status).toBe(200);
    expect(response.body.config).toEqual(config);
    expect(getProviderSources).toHaveBeenCalledWith('stored', '/projects/app');
  });
});
