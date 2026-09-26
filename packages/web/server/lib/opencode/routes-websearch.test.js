import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerOpenCodeRoutes } from './routes.js';

function createApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  const descriptor = { generation: 'oc2', endpoint: 'http://127.0.0.1:4097', epoch: 1 };
  const webSearchConfig = {
    getWebSearchSource: vi.fn(() => ({ projectPath: null })),
    setWebSearchSelection: vi.fn(() => ({ changed: true })),
  };
  registerOpenCodeRoutes(app, {
    kernelRuntime: { get: () => descriptor },
    resolveProjectDirectory: async () => ({ directory: '/repo' }),
    webSearchConfig,
    ...overrides,
  });
  return { app, descriptor, webSearchConfig };
}

describe('OC2 web search settings routes', () => {
  it('returns source and saves a parsed selection', async () => {
    const { app, webSearchConfig } = createApp();
    await request(app).get('/api/config/websearch?directory=%2Frepo').expect(200, { projectPath: null });
    await request(app).put('/api/config/websearch').send({ selection: '  provider-one  ' })
      .expect(200, { success: true, changed: true });
    expect(webSearchConfig.getWebSearchSource).toHaveBeenCalledWith('/repo');
    expect(webSearchConfig.setWebSearchSelection).toHaveBeenCalledWith('provider-one');
  });

  it('rejects OC1 and unknown before reading or writing config', async () => {
    for (const generation of ['oc1', 'unknown']) {
      const { app, webSearchConfig } = createApp({ kernelRuntime: { get: () => ({ generation, epoch: 1 }) } });
      const status = generation === 'oc1' ? 409 : 503;
      await request(app).get('/api/config/websearch').expect(status);
      await request(app).put('/api/config/websearch').send({ selection: false }).expect(status);
      expect(webSearchConfig.getWebSearchSource).not.toHaveBeenCalled();
      expect(webSearchConfig.setWebSearchSelection).not.toHaveBeenCalled();
    }
  });

  it('rejects invalid selection and a changed epoch before dispatch', async () => {
    const { app, webSearchConfig } = createApp();
    await request(app).put('/api/config/websearch').send({ selection: '' }).expect(400);
    expect(webSearchConfig.setWebSearchSelection).not.toHaveBeenCalled();

    let epoch = 1;
    const switched = createApp({
      kernelRuntime: { get: () => ({ generation: 'oc2', endpoint: 'http://127.0.0.1:4097', epoch }) },
      resolveProjectDirectory: async () => { epoch += 1; return { directory: '/repo' }; },
    });
    await request(switched.app).get('/api/config/websearch').expect(409);
    expect(switched.webSearchConfig.getWebSearchSource).not.toHaveBeenCalled();
  });

  it('reports read/write failure without claiming empty or successful settings', async () => {
    const { app } = createApp({ webSearchConfig: {
      getWebSearchSource: () => { throw new Error('private config content'); },
      setWebSearchSelection: () => { throw new Error('private config content'); },
    } });
    await request(app).get('/api/config/websearch').expect(500, { error: 'Failed to read web search settings' });
    await request(app).put('/api/config/websearch').send({ selection: 'provider-one' })
      .expect(500, { error: 'Failed to save web search settings' });
  });
});
