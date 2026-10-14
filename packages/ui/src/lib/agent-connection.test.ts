import { describe, expect, test } from 'bun:test';
import { ACP_TRANSPORT, CONNECTION_MODE, agentConnectionSchema } from './agent-connection';

const server = {
  mode: CONNECTION_MODE.ACP_SERVER,
  transport: ACP_TRANSPORT.WEBSOCKET,
  url: 'wss://agent.example/agents/acp',
  cwd: '/srv/project',
} as const;

describe('agent connection contract', () => {
  test('preserves explicit transport, full endpoint and remote POSIX or Windows cwd', () => {
    for (const cwd of ['/srv/project', 'C:\\projects\\agent', 'C:/projects/agent', '\\\\server\\share\\project']) {
      expect(agentConnectionSchema.parse({ ...server, cwd })).toEqual({ ...server, cwd });
    }
    const http = { ...server, transport: ACP_TRANSPORT.HTTP, url: 'https://agent.example/acp?version=1' };
    expect(agentConnectionSchema.parse(http)).toEqual(http);
  });

  test('rejects omitted transport, credentials, protocol mismatch and relative remote cwd', () => {
    for (const invalid of [
      { ...server, transport: undefined },
      { ...server, url: 'not-an-endpoint' },
      { ...server, transport: ACP_TRANSPORT.HTTP },
      { ...server, url: 'https://agent.example/acp' },
      { ...server, url: 'wss://user:password@agent.example/acp' },
      { ...server, url: 'wss://agent.example/acp#fragment' },
      { ...server, cwd: undefined },
      { ...server, cwd: '' },
      { ...server, cwd: 'project' },
      { ...server, cwd: 'C:project' },
    ]) expect(() => agentConnectionSchema.parse(invalid)).toThrow();
  });

  test('keeps existing ACP stdio command and optional cwd', () => {
    const stdio = { mode: CONNECTION_MODE.ACP, command: 'opencode', args: ['--pure', 'acp'] };
    expect(agentConnectionSchema.parse(stdio)).toEqual(stdio);
  });
});
