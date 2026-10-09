import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AGENT_ERROR, AGENT_FAMILY } from '../agent/constants.js';
import { OPENCODE_PROFILE } from './compatibility.js';
import { registerOpenCodeRoutes } from './routes.js';

const guardedRoutes = [
  ['get', '/api/config/opencode-resolution'],
  ['post', '/api/opencode/upgrade'],
  ['get', '/api/opencode/upgrade-status'],
  ['get', '/api/opencode/health'],
  ['get', '/api/opencode/version'],
  ['post', '/api/mcp/auth/pending'],
  ['get', '/api/mcp/auth/pending?state=state'],
  ['delete', '/api/mcp/auth/pending?state=state'],
  ['get', '/mcp/oauth/callback?state=state&code=code'],
  ['get', '/api/provider/openai/source'],
  ['put', '/api/provider'],
  ['get', '/api/config/websearch'],
  ['put', '/api/config/websearch'],
  ['put', '/api/config/warming'],
  ['delete', '/api/provider/openai/auth'],
  ['post', '/api/opencode/directory'],
  ['get', '/api/behavior/agents-md'],
  ['put', '/api/behavior/agents-md'],
];

const fail = (name) => vi.fn(() => { throw new Error(`Unexpected ${name} call`); });

const createGuardedApp = (getBackendSelection) => {
  const app = express();
  const calls = {
    get: fail('kernelRuntime.get'),
    refresh: fail('kernelRuntime.refresh'),
  };
  const fsPromises = Object.fromEntries(
    ['access', 'readFile', 'writeFile', 'mkdir', 'stat', 'readdir', 'unlink', 'rename']
      .map((name) => [name, fail(`fsPromises.${name}`)]),
  );
  const dependencies = {
    getBackendSelection,
    kernelRuntime: { get: calls.get, refresh: calls.refresh },
    getOpenCodeResolutionSnapshot: fail('getOpenCodeResolutionSnapshot'),
    getOpenCodeUpgradeCapability: fail('getOpenCodeUpgradeCapability'),
    upgradeOpenCodeCli: fail('upgradeOpenCodeCli'),
    formatSettingsResponse: fail('formatSettingsResponse'),
    readSettingsFromDisk: fail('readSettingsFromDisk'),
    readSettingsFromDiskMigrated: fail('readSettingsFromDiskMigrated'),
    persistSettings: fail('persistSettings'),
    sanitizeProjects: fail('sanitizeProjects'),
    validateDirectoryPath: fail('validateDirectoryPath'),
    resolveProjectDirectory: fail('resolveProjectDirectory'),
    getProviderSources: fail('getProviderSources'),
    removeProviderConfig: fail('removeProviderConfig'),
    upsertProviderConfig: fail('upsertProviderConfig'),
    refreshOpenCodeAfterConfigChange: fail('refreshOpenCodeAfterConfigChange'),
    buildOpenCodeUrl: fail('buildOpenCodeUrl'),
    getOpenCodeAuthHeaders: fail('getOpenCodeAuthHeaders'),
    webSearchConfig: {
      getWebSearchSource: fail('webSearchConfig.getWebSearchSource'),
      setWebSearchSelection: fail('webSearchConfig.setWebSearchSelection'),
    },
    fsPromises,
  };
  registerOpenCodeRoutes(app, dependencies);
  return { app, calls, dependencies, fsPromises };
};

describe('OpenCode route family boundary', () => {
  it.each(guardedRoutes.filter(([, route]) => !['/api/config/opencode-resolution', '/api/opencode/health', '/api/opencode/version'].includes(route)))('%s %s rejects unaccepted Legacy before route work', async (method, route) => {
    const { app, calls, dependencies, fsPromises } = createGuardedApp(() => ({ family: AGENT_FAMILY.OPENCODE }));
    calls.get.mockReturnValue({ generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY });
    const response = await request(app)[method](route).send({ state: 'state', path: '/tmp/project' }).expect(501, {
      error: AGENT_ERROR.UNACCEPTED, profile: OPENCODE_PROFILE.LEGACY,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(calls.refresh).not.toHaveBeenCalled();
    expect(dependencies.buildOpenCodeUrl).not.toHaveBeenCalled();
    expect(dependencies.getOpenCodeAuthHeaders).not.toHaveBeenCalled();
    for (const spy of Object.values(fsPromises)) expect(spy).not.toHaveBeenCalled();
  });
  it('keeps OpenCode resolution diagnostics available under Legacy', async () => {
    const { app, calls, dependencies } = createGuardedApp(() => ({ family: AGENT_FAMILY.OPENCODE }));
    calls.get.mockReturnValue({ generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY });
    dependencies.readSettingsFromDiskMigrated.mockResolvedValue({});
    dependencies.getOpenCodeResolutionSnapshot.mockReturnValue({ profile: OPENCODE_PROFILE.LEGACY });
    await request(app).get('/api/config/opencode-resolution').expect(200, { profile: OPENCODE_PROFILE.LEGACY });
    expect(calls.get).not.toHaveBeenCalled();
  });
  it.each(guardedRoutes)('%s %s rejects CAgent before route work', async (method, route) => {
    const selection = { family: AGENT_FAMILY.CAGENT, revision: 1 };
    const { app, calls, fsPromises } = createGuardedApp(() => selection);
    let call = request(app)[method](route);
    if (method === 'post' && route === '/api/mcp/auth/pending') {
      call = call.set('Content-Type', 'application/json').send('{');
    } else if (method === 'post' || method === 'put') {
      call = call.send({ state: 'state', path: '/tmp/project', content: 'payload' });
    }

    const response = await call.expect(501, { error: AGENT_ERROR.UNMIGRATED });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(calls.get).not.toHaveBeenCalled();
    expect(calls.refresh).not.toHaveBeenCalled();
    for (const spy of Object.values(fsPromises)) expect(spy).not.toHaveBeenCalled();
  });

  it('reads the selected family on every request', async () => {
    let family = AGENT_FAMILY.CAGENT;
    let revision = 1;
    const { app, dependencies } = createGuardedApp(() => ({ family, revision }));
    dependencies.readSettingsFromDiskMigrated.mockResolvedValue({});
    dependencies.getOpenCodeResolutionSnapshot.mockReturnValue({ generation: 'oc2' });

    await request(app).get('/api/config/opencode-resolution')
      .expect(501, { error: AGENT_ERROR.UNMIGRATED });
    family = AGENT_FAMILY.OPENCODE;
    revision += 1;
    await request(app).get('/api/config/opencode-resolution').expect(200, { generation: 'oc2' });
    expect(dependencies.getOpenCodeResolutionSnapshot).toHaveBeenCalledOnce();
    family = AGENT_FAMILY.CAGENT;
    revision += 1;
    await request(app).get('/api/config/opencode-resolution')
      .expect(501, { error: AGENT_ERROR.UNMIGRATED });
    expect(dependencies.getOpenCodeResolutionSnapshot).toHaveBeenCalledOnce();
  });

  it('keeps the runtime descriptor and OpenChamber settings routes available under CAgent', async () => {
    const readSettingsFromDiskMigrated = vi.fn(async () => ({ theme: 'dark' }));
    const formatSettingsResponse = vi.fn((settings) => ({ ...settings, formatted: true }));
    const persistSettings = vi.fn(async (settings) => ({ ...settings, persisted: true }));
    const refresh = vi.fn(async () => ({ family: AGENT_FAMILY.CAGENT, generation: 'unsupported' }));
    const app = express();
    app.use(express.json());
    registerOpenCodeRoutes(app, {
      getBackendSelection: () => ({ family: AGENT_FAMILY.CAGENT, revision: 1 }),
      kernelRuntime: { refresh },
      readSettingsFromDiskMigrated,
      formatSettingsResponse,
      persistSettings,
    });

    const runtime = await request(app).get('/api/opencode/runtime').expect(200);
    expect(runtime.body).toEqual({ family: AGENT_FAMILY.CAGENT, generation: 'unsupported' });
    expect(runtime.headers['cache-control']).toBe('no-store');
    expect(refresh).toHaveBeenCalledOnce();

    await request(app).get('/api/config/settings').expect(200, { theme: 'dark', formatted: true });
    await request(app).put('/api/config/settings').send({ theme: 'light' })
      .expect(200, { theme: 'light', persisted: true });
    expect(readSettingsFromDiskMigrated).toHaveBeenCalledOnce();
    expect(formatSettingsResponse).toHaveBeenCalledOnce();
    expect(persistSettings).toHaveBeenCalledWith({ theme: 'light' }, { surface: null });
  });
});
