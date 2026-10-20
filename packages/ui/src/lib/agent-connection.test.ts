import { expect, test } from 'bun:test';
import { agentConnectionSchema, CONNECTION_MODE, ACP_TRANSPORT } from './agent-connection';

const server = { mode: CONNECTION_MODE.ACP_SERVER, transport: ACP_TRANSPORT.WEBSOCKET, url: 'ws://localhost:1234/acp', cwd: '/remote/default' };

test('ACP server settings preserve optional project mappings through serialization', () => {
  expect(agentConnectionSchema.parse(server)).toEqual(server);
  const config = { ...server, projectMappings: [{ directory: 'C:\\projects\\one', cwd: '/remote/one' }, { directory: '/local/two', cwd: 'D:\\remote\\two' }] };
  expect(agentConnectionSchema.parse(JSON.parse(JSON.stringify(config)))).toEqual(config);
  expect(agentConnectionSchema.parse({ ...server, projectMappings: [] })).toEqual({ ...server, projectMappings: [] });
});

test('client boundary rejects duplicate local directories and invalid absolute roots', () => {
  expect(agentConnectionSchema.safeParse({ ...server, projectMappings: [{ directory: '/local/one', cwd: '/remote/one' }, { directory: ' /local/one ', cwd: '/remote/two' }] }).success).toBe(false);
  for (const invalid of ['', 'relative/project', 'C:relative', '\\rooted', '\\\\host', '\\\\host\\', '/remote\u0000path']) {
    expect(agentConnectionSchema.safeParse({ ...server, cwd: invalid }).success).toBe(false);
    expect(agentConnectionSchema.safeParse({ ...server, projectMappings: [{ directory: invalid, cwd: '/remote/one' }] }).success).toBe(false);
    expect(agentConnectionSchema.safeParse({ ...server, projectMappings: [{ directory: '/local/one', cwd: invalid }] }).success).toBe(false);
  }
  for (const absolute of ['/', 'C:\\', 'C:/', '\\\\host\\share', '/local/one']) {
    expect(agentConnectionSchema.safeParse({ ...server, projectMappings: [{ directory: absolute, cwd: absolute }] }).success).toBe(true);
  }
});
