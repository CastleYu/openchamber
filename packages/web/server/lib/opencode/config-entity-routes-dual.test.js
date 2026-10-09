import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_FAMILY } from '../agent/constants.js';
import { OPENCODE_PROFILE } from './compatibility.js';
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

const mutations = [
  ['post', '/api/config/agents/a', 'createAgent'],
  ['patch', '/api/config/agents/a', 'updateAgent'],
  ['delete', '/api/config/agents/a', 'deleteAgent'],
  ['post', '/api/config/commands/c', 'createCommand'],
  ['patch', '/api/config/commands/c', 'updateCommand'],
  ['delete', '/api/config/commands/c', 'deleteCommand'],
  ['post', '/api/config/mcp/m', 'createMcpConfig'],
  ['patch', '/api/config/mcp/m', 'updateMcpConfig'],
  ['delete', '/api/config/mcp/m', 'deleteMcpConfig'],
];

describe('configuration identity across directory resolution', () => {
  it.each(mutations.flatMap(([method, route, operation]) =>
    ['generation', 'profile', 'endpoint', 'epoch', 'family', 'revision'].map((change) =>
      [method, route, operation, change])))('%s %s refuses a changed %s owner (%s)', async (method, route, operation, change) => {
    let runtime = { generation: 'oc1', profile: OPENCODE_PROFILE.OC1, endpoint: 'http://localhost:4096', epoch: 1 };
    let backend = { family: AGENT_FAMILY.OPENCODE, revision: 1 };
    const write = vi.fn();
    const resolve = async () => {
      if (change === 'family') backend = { ...backend, family: AGENT_FAMILY.CAGENT };
      else if (change === 'revision') backend = { ...backend, revision: 2 };
      else runtime = { ...runtime, [change]: {
        generation: 'oc2', profile: OPENCODE_PROFILE.LEGACY, endpoint: 'http://localhost:5096', epoch: 2,
      }[change] };
      return { directory: '/repo' };
    };
    const app = express();
    app.use(express.json());
    registerConfigEntityRoutes(app, {
      getGeneration: () => runtime.generation,
      getKernelRuntime: () => runtime,
      getBackendSelection: () => backend,
      resolveProjectDirectory: resolve,
      resolveOptionalProjectDirectory: resolve,
      [operation]: write,
    });
    await request(app)[method](route).send({ scope: 'project' }).expect(409);
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps snippet writes independent of backend changes during resolution', async () => {
    let runtime = { generation: 'oc1', profile: OPENCODE_PROFILE.OC1 };
    const write = vi.fn(() => ({ name: 'note' }));
    const app = express();
    app.use(express.json());
    registerConfigEntityRoutes(app, {
      getKernelRuntime: () => runtime,
      resolveOptionalProjectDirectory: async () => {
        runtime = { generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY };
        return { directory: '/repo' };
      },
      createSnippet: write,
    });
    await request(app).post('/api/config/snippets/note').send({ content: 'note' }).expect(200);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
