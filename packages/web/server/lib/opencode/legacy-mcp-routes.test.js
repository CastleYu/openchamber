import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { registerConfigEntityRoutes } from './config-entity-routes.js';
import { createLegacyMcpConfig } from './legacy-mcp-config.js';
import { createKernelOperations } from './kernel-operations.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-mcp-routes-'));
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  const paths = { home: path.join(root, 'home'), config: path.join(root, 'config'), directory: path.join(root, 'project'), worktree: path.join(root, 'project') };
  await fs.mkdir(paths.directory, { recursive: true });
  await fs.mkdir(paths.config, { recursive: true });
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(new URL(req.url, 'http://localhost').pathname === '/path' ? paths : { mcp: {} }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const address = server.address();
  const runtime = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', epoch: 1, endpoint: `http://127.0.0.1:${address.port}` };
  const backend = { family: 'opencode', revision: 1 };
  const owner = { id: Symbol('native'), env: {}, cwd: paths.directory };
  const config = createLegacyMcpConfig({ getRuntime: () => runtime, getNativeConfigContext: () => owner, getBackendSelection: () => backend, operations: createKernelOperations({ getRuntime: () => runtime, getHeaders: () => ({}) }) });
  const app = express();
  app.use(express.json());
  registerConfigEntityRoutes(app, {
    getGeneration: () => runtime.generation, getKernelRuntime: () => runtime,
    getBackendSelection: () => backend, legacyMcpConfig: config,
    resolveOptionalProjectDirectory: async () => ({ directory: paths.directory }),
    listMcpConfigs: config.list, getMcpConfig: config.get,
    createMcpConfig: config.create, updateMcpConfig: config.update, deleteMcpConfig: config.remove,
  });
  return { app, paths, runtime, backend, owner };
}

describe('exact Legacy MCP HTTP persistence', () => {
  it('creates, saves twice, deletes and recreates through the production SDK and file owner', async () => {
    const { app, paths } = await fixture();
    const body = { type: 'local', command: ['fixture'], enabled: false, environment: { TOKEN: '{env:TOKEN}' } };
    const created = await request(app).post('/api/config/mcp/example').send({ ...body, scope: 'user' }).expect(200);
    expect(created.body).toMatchObject({ success: true, requiresRestart: true, restartDeferred: true, saved: true });
    expect(created.body).not.toHaveProperty('environment');
    for (const timeout of [1500, 2500]) await request(app).patch('/api/config/mcp/example').send({ ...body, timeout }).expect(200);
    const listed = await request(app).get('/api/config/mcp').expect(200);
    expect(listed.headers['cache-control']).toBe('no-store');
    const raw = await request(app).get('/api/config/mcp/example').expect(200);
    expect(raw.body).toMatchObject({ name: 'example', timeout: 2500, environment: { TOKEN: '{env:TOKEN}' }, readOnly: false });
    expect(await fs.readFile(path.join(paths.config, 'opencode.jsonc'), 'utf8')).toContain('{env:TOKEN}');
    const deleted = await request(app).delete('/api/config/mcp/example').expect(200);
    expect(deleted.body.revealed).toBe(false);
    await request(app).get('/api/config/mcp/example').expect(404);
    await request(app).post('/api/config/mcp/example').send({ ...body, scope: 'user' }).expect(200);
    expect((await fs.readdir(paths.config)).filter(name => name.startsWith('.legacy-mcp-'))).toEqual([]);
  });
  it('keeps other Legacy config routes and CAgent outside the local writer', async () => {
    const { app, backend, paths } = await fixture();
    await request(app).post('/api/config/agents/example').send({}).expect(501);
    backend.family = 'cagent';
    await request(app).post('/api/config/mcp/example').send({ type: 'local', command: ['fixture'], scope: 'user' }).expect(501);
    expect(await fs.readdir(paths.config)).toEqual([]);
  });
  it('rejects a retired native owner without creating a file', async () => {
    const { app, owner, paths } = await fixture();
    owner.id = undefined;
    await request(app).post('/api/config/mcp/example').send({ type: 'local', command: ['fixture'], scope: 'user' }).expect(501);
    expect(await fs.readdir(paths.config)).toEqual([]);
  });
});
