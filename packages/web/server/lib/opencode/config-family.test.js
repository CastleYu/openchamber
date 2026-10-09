import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AGENT_ERROR, AGENT_FAMILY } from '../agent/constants.js';
import { OPENCODE_PROFILE } from './compatibility.js';
import { registerConfigEntityRoutes } from './config-entity-routes.js';
import { registerPluginRoutes } from './plugin-routes.js';
import { registerSkillRoutes } from './skill-routes.js';

const fail = (name) => vi.fn(() => { throw new Error(`Unexpected ${name} call`); });

const createDependencies = (getBackendSelection, overrides = {}) => {
  const calls = {};
  const dependencies = new Proxy({ getBackendSelection, getGeneration: () => 'oc1', getKernelRuntime: () => ({ generation: 'oc1' }), ...overrides }, {
    get(target, name) {
      if (name in target) return target[name];
      if (!(name in calls)) calls[name] = fail(String(name));
      return calls[name];
    },
  });
  return { dependencies, calls };
};

const createApp = (register, getBackendSelection, overrides) => {
  const app = express();
  app.use(express.json());
  const { dependencies, calls } = createDependencies(getBackendSelection, overrides);
  register(app, dependencies);
  return { app, calls };
};

const entityCases = [
  ['agent', 'get', '/api/config/agents/test-agent', 'post', '/api/config/agents/test-agent'],
  ['command', 'get', '/api/config/commands/test-command', 'post', '/api/config/commands/test-command'],
  ['MCP', 'get', '/api/config/mcp', 'post', '/api/config/mcp/test-server'],
];

describe('OpenCode configuration family boundary', () => {
  it.each([
    [registerConfigEntityRoutes, 'get', '/api/config/agents/a'],
    [registerConfigEntityRoutes, 'post', '/api/config/agents/a'],
    [registerConfigEntityRoutes, 'get', '/api/config/commands/c'],
    [registerConfigEntityRoutes, 'post', '/api/config/commands/c'],
    [registerConfigEntityRoutes, 'get', '/api/config/mcp'],
    [registerConfigEntityRoutes, 'post', '/api/config/mcp/m'],
    [registerPluginRoutes, 'get', '/api/config/plugins'],
    [registerPluginRoutes, 'post', '/api/config/plugins/entry'],
    [registerPluginRoutes, 'get', '/api/config/plugins/registry?specs=package'],
    [registerSkillRoutes, 'get', '/api/config/skills'],
    [registerSkillRoutes, 'post', '/api/config/skills/scan'],
    [registerSkillRoutes, 'post', '/api/config/skills/install'],
  ])('refuses unaccepted Legacy configuration before route dependencies', async (register, method, route) => {
    const getKernelRuntime = () => ({ generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY });
    const { app, calls } = createApp(register, () => ({ family: AGENT_FAMILY.OPENCODE }), {
      getKernelRuntime, kernelRuntime: { get: getKernelRuntime },
    });
    const response = await request(app)[method](route).send({ scope: 'user', content: 'test' }).expect(501, {
      error: AGENT_ERROR.UNACCEPTED, profile: OPENCODE_PROFILE.LEGACY,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
  });
  it('reads profile on every configuration request while keeping snippets independent', async () => {
    let profile = OPENCODE_PROFILE.OC1;
    const getAgentSources = vi.fn(() => ({ md: { exists: false }, json: { exists: false } }));
    const { app } = createApp(registerConfigEntityRoutes, () => ({ family: AGENT_FAMILY.OPENCODE }), {
      getKernelRuntime: () => ({ generation: 'oc1', profile }),
      resolveProjectDirectory: async () => ({ directory: '/tmp/project', error: null }),
      resolveOptionalProjectDirectory: async () => ({ directory: null, error: null }),
      getAgentSources, listSnippets: () => [{ name: 'hello' }],
    });
    await request(app).get('/api/config/agents/a').expect(200);
    profile = OPENCODE_PROFILE.LEGACY;
    await request(app).get('/api/config/agents/a').expect(501);
    await request(app).get('/api/config/snippets').expect(200, [{ name: 'hello' }]);
    profile = OPENCODE_PROFILE.OC1;
    await request(app).get('/api/config/agents/a').expect(200);
    expect(getAgentSources).toHaveBeenCalledTimes(2);
  });
  it.each(entityCases)('%s reads and mutations refuse CAgent before dependencies', async (_name, readMethod, readPath, writeMethod, writePath) => {
    const getGeneration = fail('getGeneration');
    const { app, calls } = createApp(registerConfigEntityRoutes, () => ({ family: AGENT_FAMILY.CAGENT }), { getGeneration });
    const read = request(app)[readMethod](readPath).expect(501, { error: AGENT_ERROR.UNMIGRATED });
    const write = request(app)[writeMethod](writePath).send({ name: 'entry', content: 'test' })
      .expect(501, { error: AGENT_ERROR.UNMIGRATED });
    for (const response of await Promise.all([read, write])) {
      expect(response.headers['cache-control']).toBe('no-store');
    }
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
    expect(getGeneration).not.toHaveBeenCalled();
  });

  it('keeps snippet routes available under CAgent', async () => {
    const { app } = createApp(registerConfigEntityRoutes, () => ({ family: AGENT_FAMILY.CAGENT }), {
      resolveOptionalProjectDirectory: async () => ({ directory: null, error: null }),
      listSnippets: () => [{ name: 'hello' }],
    });
    await request(app).get('/api/config/snippets').expect(200, [{ name: 'hello' }]);
  });

  it('refuses plugin reads, mutations, and npm metadata before dependencies', async () => {
    const { app, calls } = createApp(registerPluginRoutes, () => ({ family: AGENT_FAMILY.CAGENT }));
    const responses = await Promise.all([
      request(app).get('/api/config/plugins'),
      request(app).get('/api/config/plugins/registry?specs=example-package'),
      request(app).post('/api/config/plugins/entry').send({ spec: 'example-package', scope: 'user' }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(501);
      expect(response.body).toEqual({ error: AGENT_ERROR.UNMIGRATED });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
  });

  it('refuses skill reads, scan, and install before dependencies', async () => {
    const { app, calls } = createApp(registerSkillRoutes, () => ({ family: AGENT_FAMILY.CAGENT }));
    const responses = await Promise.all([
      request(app).get('/api/config/skills'),
      request(app).post('/api/config/skills/scan').send({ source: 'owner/repo' }),
      request(app).post('/api/config/skills/install').send({ source: 'owner/repo', scope: 'user' }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(501);
      expect(response.body).toEqual({ error: AGENT_ERROR.UNMIGRATED });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
  });

  it('reads the selected backend family for each request', async () => {
    let family = AGENT_FAMILY.CAGENT;
    const getAgentSources = vi.fn(() => ({ md: { exists: false }, json: { exists: false } }));
    const { app } = createApp(registerConfigEntityRoutes, () => ({ family }), {
      resolveProjectDirectory: async () => ({ directory: '/tmp/project', error: null }),
      getAgentSources,
    });
    const rejected = await request(app).get('/api/config/agents/test-agent').expect(501);
    expect(rejected.headers['cache-control']).toBe('no-store');
    family = AGENT_FAMILY.OPENCODE;
    await request(app).get('/api/config/agents/test-agent').expect(200);
    expect(getAgentSources).toHaveBeenCalledOnce();
    family = AGENT_FAMILY.CAGENT;
    await request(app).get('/api/config/agents/test-agent').expect(501, { error: AGENT_ERROR.UNMIGRATED });
    expect(getAgentSources).toHaveBeenCalledOnce();
  });

  it('preserves OpenCode behavior when no backend selection getter is supplied', async () => {
    const getAgentSources = vi.fn(() => ({ md: { exists: false }, json: { exists: false } }));
    const { app } = createApp(registerConfigEntityRoutes, undefined, {
      resolveProjectDirectory: async () => ({ directory: '/tmp/project', error: null }),
      getAgentSources,
    });
    await request(app).get('/api/config/agents/test-agent').expect(200);
    expect(getAgentSources).toHaveBeenCalledOnce();
  });

  it('retains the generation readiness gate for an unresolved OpenCode backend', async () => {
    const getGeneration = vi.fn(() => 'unsupported');
    const { app, calls } = createApp(registerConfigEntityRoutes, () => ({ family: AGENT_FAMILY.OPENCODE }), {
      getGeneration,
    });
    await request(app).post('/api/config/mcp/test-server').send({ type: 'local', command: ['node'] })
      .expect(503, { error: 'OpenCode generation is not ready' });
    expect(getGeneration).toHaveBeenCalledOnce();
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
  });
});
