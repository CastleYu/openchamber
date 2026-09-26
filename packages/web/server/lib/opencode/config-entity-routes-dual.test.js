import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerConfigEntityRoutes } from './config-entity-routes.js';

const appFor = (generation) => {
  const app = express();
  app.use(express.json());
  const createAgent = vi.fn(() => ({ path: '/config/agents/reviewer.md', scope: 'project' }));
  const getAgentPermissions = vi.fn(() => ({ agent: [{ action: 'edit', effect: 'deny' }] }));
  registerConfigEntityRoutes(app, {
    getGeneration: () => generation,
    resolveProjectDirectory: async () => ({ directory: '/repo' }),
    resolveOptionalProjectDirectory: async () => ({ directory: '/repo' }),
    createAgent,
    getAgentPermissions,
  });
  return { app, createAgent, getAgentPermissions };
};

describe('dual config entity routes', () => {
  it('keeps OC1 deferred restart response and denies the OC2 permission route', async () => {
    const { app, createAgent } = appFor('oc1');
    const response = await request(app).post('/api/config/agents/reviewer')
      .send({ scope: 'project', description: 'Review' }).expect(200);
    expect(response.body).toMatchObject({ success: true, requiresRestart: true, restartDeferred: true });
    expect(createAgent).toHaveBeenCalledWith('reviewer', { description: 'Review' }, '/repo', 'project');
    await request(app).get('/api/config/agents/reviewer/permissions').expect(404);
  });

  it('returns OC2 applied location and exposes ordered permission details', async () => {
    const { app, getAgentPermissions } = appFor('oc2');
    const response = await request(app).post('/api/config/agents/reviewer')
      .send({ scope: 'project', description: 'Review' }).expect(200);
    expect(response.body).toMatchObject({ success: true, path: '/config/agents/reviewer.md', scope: 'project' });
    expect(response.body).not.toHaveProperty('requiresRestart');
    const permissions = await request(app).get('/api/config/agents/reviewer/permissions').expect(200);
    expect(permissions.body.agent).toEqual([{ action: 'edit', effect: 'deny' }]);
    expect(getAgentPermissions).toHaveBeenCalledWith('reviewer', '/repo');
  });
});
