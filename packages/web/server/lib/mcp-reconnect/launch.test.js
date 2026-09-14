import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { configureMcpLaunch } from './launch.js';

const launch = { guard: 'guard.exe', node: 'node.exe', bgpm: 'fixed/cli.js', states: 'connections' };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const configure = (config, directory = '/a', runtime = launch) => configureMcpLaunch(config, directory, runtime, hash, path.join);
const bgpm = '@waylaidwanderer/background-process-mcp';

describe('managed local MCP launch', () => {
  it('uses fixed BGPM entry, preserves environment/arguments and isolates directories', () => {
    const config = { mcp: { bg: { type: 'local', command: ['npx', '-y', bgpm + '@latest'], environment: { FLAG: 'test' } } } };
    const other = structuredClone(config);
    const background = configure(config);
    configure(other, '/b');
    expect(config.mcp.bg.command.slice(2)).toEqual(['node.exe', 'fixed/cli.js']);
    expect(config.mcp.bg.environment).toEqual({ FLAG: 'test' });
    expect(other.mcp.bg.command[1]).not.toBe(config.mcp.bg.command[1]);
    expect(background.get('bg').inspect).toBe(true);
  });

  it('preserves explicit versions and npx options it cannot reproduce', () => {
    for (const command of [['npx', bgpm + '@1.0.0'], ['npx', '--package=other', bgpm]]) {
      const config = { mcp: { bg: { type: 'local', command } } };
      const background = configure(config);
      expect(config.mcp.bg.command.slice(2)).toEqual(command);
      expect(background.get('bg').inspect).toBe(false);
    }
  });

  it('preserves remote, disabled and non-Windows configuration', () => {
    const config = { mcp: { remote: { type: 'remote', url: 'https://example.test/mcp' }, off: { type: 'local', enabled: false, command: ['tool'] } } };
    const original = structuredClone(config);
    configure(config);
    expect(config).toEqual(original);
    const local = { mcp: { tool: { type: 'local', command: ['tool'] } } };
    configure(local, '/a', null);
    expect(local.mcp.tool.command).toEqual(['tool']);
  });

  it('does not inspect externally shared BGPM ports or wrap a command twice', () => {
    for (const args of [['--port', '1234'], ['--port=1234']]) {
      const config = { mcp: { bg: { type: 'local', command: ['npx', bgpm, ...args] } } };
      expect(configure(config).get('bg').inspect).toBe(false);
      const once = [...config.mcp.bg.command];
      expect(configure(config).has('bg')).toBe(true);
      expect(config.mcp.bg.command).toEqual(once);
    }
  });
});
