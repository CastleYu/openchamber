import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createAgentConnection, parseAgentConnection, registerAgentConnectionRoutes } from './agent-connection.js';
import { createOpenCodeEnvRuntime } from './env-runtime.js';
import { registerOpenCodeRoutes } from './routes.js';

const fixture = async (run) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-connection-'));
  const calls = [];
  let descriptor = { generation: 'unreachable' };
  const acpRuntime = {
    start: async (config) => { calls.push(['acp-start', config]); descriptor = { generation: 'acp' }; },
    stop: async () => { calls.push(['acp-stop']); descriptor = { generation: 'unreachable' }; },
    descriptor: () => descriptor,
  };
  const filePath = path.join(directory, 'agent-connection.json');
  const deps = { filePath, acpRuntime, startOpenCode: async (config) => calls.push(['oc-start', config]), stopOpenCode: async () => calls.push(['oc-stop']) };
  try { await run({ directory, filePath, calls, deps }); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
};

describe('explicit agent connection', () => {
  it('validates remote transport, credentials and a required cross-platform absolute cwd', () => {
    const config = { mode: 'acp-server', transport: 'websocket', url: 'wss://agent.example/acp', cwd: '/workspace/project' };
    expect(parseAgentConnection(config)).toEqual(config);
    expect(parseAgentConnection({ ...config, cwd: 'C:\\workspace\\project' }).cwd).toBe('C:\\workspace\\project');
    for (const changes of [{ cwd: undefined }, { cwd: 'relative' }, { cwd: '\\project' }, { cwd: 'C:project' }, { url: 'https://agent.example/acp' }, { url: 'ws://user:secret@agent.example/acp' }, { url: 'ws://agent.example/acp#secret' }]) {
      expect(() => parseAgentConnection({ ...config, ...changes })).toThrow();
    }
    expect(parseAgentConnection({ ...config, transport: 'http', url: 'https://agent.example/acp' }).transport).toBe('http');
  });
  it('starts the remote owner, persists the exact selection and applies ACP route guards', () => fixture(async ({ deps, calls, filePath }) => {
    const connection = createAgentConnection(deps);
    const config = { mode: 'acp-server', transport: 'http', url: 'https://agent.example/acp', cwd: '/workspace' };
    expect((await connection.apply(config)).status).toBe('ready');
    expect(calls).toEqual([['oc-stop'], ['acp-stop'], ['acp-start', config]]);
    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual(config);
    let guard;
    registerAgentConnectionRoutes({ get: () => {}, post: () => {}, use: (value) => { guard = value; } }, { express: { json: () => () => {} }, connection });
    const res = { status: (code) => { expect(code).toBe(409); return res; }, json: (value) => value };
    expect(guard({ path: '/api/provider' }, res, () => 'allowed').error).toMatch(/OpenCode/);
    expect(guard({ path: '/api/acp/sessions' }, res, () => 'allowed')).toBe('allowed');
    await deps.acpRuntime.stop();
    expect(connection.snapshot().status).toBe('failed');
  }));
  it('boots unconfigured without starting either runtime', () => fixture(async ({ deps, calls }) => {
    const connection = createAgentConnection(deps);
    expect((await connection.bootstrap()).status).toBe('unconfigured');
    expect(calls.filter(([name]) => name.endsWith('start'))).toEqual([]);
  }));
  it('persists a failed selection and never starts another mode', () => fixture(async ({ deps, calls, filePath }) => {
    deps.startOpenCode = async (config) => { calls.push(['external', config]); throw new Error('Server refused connection'); };
    const connection = createAgentConnection(deps);
    await expect(connection.apply({ mode: 'external', url: 'http://127.0.0.1:9999' })).rejects.toThrow('refused');
    expect(connection.snapshot()).toMatchObject({ status: 'failed', config: { mode: 'external' } });
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).mode).toBe('external');
    expect(calls.some(([name]) => name === 'acp-start')).toBe(false);
  }));
  it('starts only the selected ACP command and stops it before selecting OpenCode', () => fixture(async ({ deps, calls }) => {
    const connection = createAgentConnection(deps);
    const config = { mode: 'acp', command: 'my-agent', args: ['--acp'], cwd: path.resolve('/project') };
    await connection.apply(config);
    expect(calls).toEqual([['oc-stop'], ['acp-stop'], ['acp-start', config]]);
    await connection.apply({ mode: 'path' });
    expect(calls.slice(3)).toEqual([['oc-stop'], ['acp-stop'], ['oc-start', { mode: 'path' }]]);
  }));
  it('reports a disconnected ACP agent as failed', () => fixture(async ({ deps }) => {
    const connection = createAgentConnection(deps);
    await connection.apply({ mode: 'acp', command: 'agent', args: [] });
    await deps.acpRuntime.stop();
    expect(connection.snapshot().status).toBe('failed');
  }));
  it('keeps the settings route readable after failure', () => fixture(async ({ deps }) => {
    deps.startOpenCode = async () => { throw new Error('unavailable'); };
    const connection = createAgentConnection(deps);
    await connection.apply({ mode: 'path' }).catch(() => {});
    const routes = new Map();
    registerAgentConnectionRoutes({ get: (route, handler) => routes.set(route, handler), post: () => {}, use: () => {} }, { express: { json: () => () => {} }, connection });
    let body;
    routes.get('/api/agent/connection')({}, { setHeader: () => {}, json: (value) => { body = value; } });
    expect(body.status).toBe('failed');
  }));
  it('rejects a missing command and credentials in external URLs', () => {
    expect(() => parseAgentConnection({ mode: 'command', command: '', args: [] })).toThrow('executable');
    expect(() => parseAgentConnection({ mode: 'external', url: 'http://user:secret@localhost:4096' })).toThrow('credentials');
  });
  it('saves and passes an absolute default ACP directory when omitted', () => fixture(async ({ deps, calls, filePath, directory }) => {
    const connection = createAgentConnection({ ...deps, defaultCwd: directory });
    await connection.apply({ mode: 'acp', command: 'agent', args: [] });
    expect(calls.at(-1)[1].cwd).toBe(directory);
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).cwd).toBe(directory);
    expect(connection.snapshot().prefill.cwd).toBe(directory);
  }));
  it('rejects OpenCode operations for ACP while allowing settings and the runtime descriptor', () => fixture(async ({ deps }) => {
    const connection = createAgentConnection(deps);
    await connection.apply({ mode: 'acp', command: 'agent', args: [] });
    let guard;
    registerAgentConnectionRoutes({ get: () => {}, post: () => {}, use: (handler) => { guard = handler; } }, { express: { json: () => () => {} }, connection });
    const check = (url) => {
      let result = 'allowed';
      guard({ path: url }, { status: (code) => ({ json: () => { result = code; } }) }, () => {});
      return result;
    };
    for (const url of ['/api/opencode/session', '/api/config/agents', '/api/config/agents/custom', '/api/config/commands', '/api/config/mcp', '/api/config/snippets', '/api/config/skills', '/api/config/plugins', '/api/config/websearch', '/api/config/warming', '/api/config/reload', '/api/config/opencode-resolution', '/api/provider']) expect(check(url)).toBe(409);
    for (const url of ['/api/opencode/runtime', '/api/config/themes', '/api/config/themes/catalog/search', '/api/agent/connection', '/api/config/settings', '/api/acp/session']) expect(check(url)).toBe('allowed');
    await connection.apply({ mode: 'path' });
    expect(check('/api/acp/session')).toBe(409);
    expect(check('/api/opencode/session')).toBe('allowed');
  }));
  it('loads and saves application settings through their real routes with ACP selected', () => fixture(async ({ deps }) => {
    const connection = createAgentConnection(deps);
    await connection.apply({ mode: 'acp', command: 'agent', args: [] });
    const app = express();
    app.use(express.json());
    registerAgentConnectionRoutes(app, { express, connection });
    let settings = { theme: 'dark' };
    registerOpenCodeRoutes(app, {
      readSettingsFromDiskMigrated: async () => settings,
      formatSettingsResponse: (value) => value,
      persistSettings: async (changes) => { settings = { ...settings, ...changes }; return settings; },
    });
    await request(app).get('/api/config/settings?surface=desktop').expect(200, { theme: 'dark' });
    await request(app).put('/api/config/settings?surface=desktop').send({ theme: 'light' }).expect(200, { theme: 'light' });
    await request(app).get('/api/config/settings?surface=desktop').expect(200, { theme: 'light' });
    await request(app).put('/api/config/warming').send({ enabled: true }).expect(409);
    await request(app).get('/api/provider').expect(409);
  }));
  it('never resolves a missing chosen command through environment or bundled fallback', () => {
    const previous = process.env.OPENCODE_BINARY;
    process.env.OPENCODE_BINARY = process.execPath;
    try {
      const runtime = createOpenCodeEnvRuntime({ state: {} });
      expect(() => runtime.resolveSelectedBinary({ mode: 'command', command: 'openchamber-test-missing-command' })).toThrow('unavailable');
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_BINARY;
      else process.env.OPENCODE_BINARY = previous;
    }
  });
});
