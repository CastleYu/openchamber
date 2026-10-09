import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { CONNECTION_MODE, parseOpenCodeConnection, prepareOpenCodeConnection, resolveConnectionEnv } from './connection.js';

const base = { version: 1, confirmed: true };
const exe = path.resolve('opencode.exe');
const cwd = path.resolve('.');
const records = [
  { ...base, mode: CONNECTION_MODE.EXTERNAL, endpoint: 'https://example.test/base/' },
  { ...base, mode: CONNECTION_MODE.COMMAND, exe, args: ['serve', '--port', '0'], cwd, env: [{ name: 'CUSTOM', ref: 'SOURCE' }] },
  { ...base, mode: CONNECTION_MODE.PATH },
  { ...base, mode: CONNECTION_MODE.CONFIGURED, exe },
  { ...base, mode: CONNECTION_MODE.BUNDLED },
];
describe('confirmed OpenCode connection boundary', () => {
  it.each(records)('round-trips $mode with a finite version and explicit confirmation', record => {
    const parsed = parseOpenCodeConnection(JSON.parse(JSON.stringify(record)));
    expect(parsed).toMatchObject(record.mode === CONNECTION_MODE.EXTERNAL ? { ...record, endpoint: 'https://example.test/base' } : record);
  });
  it.each([{}, { ...records[2], confirmed: false }, { ...records[2], version: 2 }, { ...records[2], extra: true },
    { ...records[3], exe: 'opencode' }, { ...records[1], args: [] }, { ...records[1], args: ['bad' + String.fromCharCode(0)] },
    { ...records[1], env: [{ name: 'NAME', ref: 'SOURCE' }, { name: 'name', ref: 'OTHER' }] },
    ...['file:///tmp/server', 'https://user:password@example.test', 'https://example.test/?token=secret', 'https://example.test/#fragment'].map(endpoint => ({ ...records[0], endpoint }))])('rejects malformed, unconfirmed or credential-bearing records', record => {
    expect(() => parseOpenCodeConnection(record)).toThrow('Invalid or unconfirmed');
  });
  it('keeps clearing distinct from an enabled connection', async () => {
    expect(parseOpenCodeConnection(null)).toBeNull();
    await expect(prepareOpenCodeConnection(null, {})).rejects.toThrow('Confirm an OpenCode connection');
  });
  it('resolves deliberate environment references without persisting their values', () => {
    expect(resolveConnectionEnv(records[1].env, { SOURCE: 'value' })).toEqual({ CUSTOM: 'value' });
    expect(records[1].env).toEqual([{ name: 'CUSTOM', ref: 'SOURCE' }]);
    expect(() => resolveConnectionEnv(records[1].env, {})).toThrow('reference is unavailable');
    for (const name of ['PATH', 'path', 'OPENCODE_PASSWORD', 'OPENCODE_SERVER_PASSWORD']) {
      expect(() => resolveConnectionEnv([{ name, ref: 'SOURCE' }], { SOURCE: 'value' })).toThrow('host-owned');
    }
  });
  it('prepares the complete command without inspecting versions or running it', async () => {
    const resolveBinary = vi.fn(() => exe);
    const resolveLaunchSpec = vi.fn(() => ({ binary: exe, args: [] }));
    const stat = vi.fn(async () => ({ isDirectory: () => true }));
    const prepared = await prepareOpenCodeConnection(records[1], { resolveBinary, resolveLaunchSpec, stat, env: { SOURCE: 'value' } });
    expect(prepared).toMatchObject({ binary: exe, args: ['serve', '--port', '0'], cwd, commandEnv: { CUSTOM: 'value' } });
    expect(stat).toHaveBeenCalledExactlyOnceWith(cwd);
    await expect(prepareOpenCodeConnection(records[1], { resolveBinary, resolveLaunchSpec, stat: async () => ({ isDirectory: () => false }), env: {} })).rejects.toThrow('directory is unavailable');
  });
  it('does not resolve executables for an external endpoint', async () => {
    const resolveBinary = vi.fn();
    expect(await prepareOpenCodeConnection(records[0], { resolveBinary })).toMatchObject({ endpoint: 'https://example.test/base' });
    expect(resolveBinary).not.toHaveBeenCalled();
  });
});
