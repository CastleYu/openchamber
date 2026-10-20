import test from 'node:test';
import assert from 'node:assert/strict';
import { serverSchema } from './server-transport.js';
import { resolveProjectCwd } from './project-mapping.js';
import { createAgentConnection } from '../opencode/agent-connection.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const server = { mode: 'acp-server', transport: 'websocket', url: 'ws://localhost:1234/acp', cwd: '/remote/default' };

test('server mappings round-trip without changing old server settings', () => {
  assert.deepEqual(serverSchema.parse(server), server);
  const config = { ...server, projectMappings: [{ directory: 'C:\\projects\\one', cwd: '/remote/one' }, { directory: '/local/two', cwd: 'D:\\remote\\two' }] };
  assert.deepEqual(serverSchema.parse(JSON.parse(JSON.stringify(config))), config);
  assert.deepEqual(serverSchema.parse({ ...server, projectMappings: [] }).projectMappings, []);
});

test('mapping lookup matches exactly and keeps the explicit default for other projects', () => {
  const config = serverSchema.parse({ ...server, projectMappings: [{ directory: 'C:\\projects\\one', cwd: '/remote/one' }, { directory: '/local/two', cwd: '/remote/two' }] });
  assert.equal(resolveProjectCwd(config, 'C:\\projects\\one'), '/remote/one');
  assert.equal(resolveProjectCwd(config, '/local/two'), '/remote/two');
  assert.equal(resolveProjectCwd(config, '/local/two/child'), server.cwd);
  assert.equal(resolveProjectCwd(config, '/local/unknown'), server.cwd);
  assert.equal(resolveProjectCwd(server, '/local/two'), server.cwd);
});

test('server boundary rejects duplicate local directories and invalid absolute roots', () => {
  assert.equal(serverSchema.safeParse({ ...server, projectMappings: [{ directory: '/local/one', cwd: '/remote/one' }, { directory: ' /local/one ', cwd: '/remote/two' }] }).success, false);
  for (const invalid of ['', 'relative/project', 'C:relative', '\\rooted', '\\\\host', '\\\\host\\', '/remote\u0000path']) {
    assert.equal(serverSchema.safeParse({ ...server, cwd: invalid }).success, false, invalid);
    assert.equal(serverSchema.safeParse({ ...server, projectMappings: [{ directory: invalid, cwd: '/remote/one' }] }).success, false, invalid);
    assert.equal(serverSchema.safeParse({ ...server, projectMappings: [{ directory: '/local/one', cwd: invalid }] }).success, false, invalid);
  }
  for (const absolute of ['/', 'C:\\', 'C:/', '\\\\host\\share', '/local/one']) {
    assert.equal(serverSchema.safeParse({ ...server, projectMappings: [{ directory: absolute, cwd: absolute }] }).success, true, absolute);
  }
});

test('connection settings persist mappings, bootstrap them and remove them without migrating old settings', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'acp-mapping-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'connection.json');
  const started = [];
  const deps = { filePath, startOpenCode: async () => {}, stopOpenCode: async () => {}, acpRuntime: { start: async (config) => { started.push(config); }, stop: async () => {}, descriptor: () => ({ generation: 'acp' }) } };
  const connection = createAgentConnection(deps);
  const config = { ...server, projectMappings: [{ directory: '/local/one', cwd: '/remote/one' }] };
  assert.deepEqual((await connection.apply(config)).config, config);
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), config);
  const restored = createAgentConnection(deps);
  assert.deepEqual((await restored.bootstrap()).config, config);
  assert.deepEqual(started, [config, config]);
  await restored.apply(server);
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), server);
});
