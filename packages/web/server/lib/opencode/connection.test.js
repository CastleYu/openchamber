import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { CONNECTION_MODE, describeOpenCodeConnections, parseOpenCodeConnection, prepareOpenCodeConnection, resolveConnectionEnv } from './connection.js';

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

describe('connection migration discovery', () => {
  const resolveBinary = vi.fn(record => record.exe ?? exe);
  it('recommends an available bundle without confirming or mutating input', () => {
    const settings = {}; const env = {};
    const snapshot = describeOpenCodeConnections({ settings, env, resolveBinary });
    expect(snapshot.saved).toBeNull(); expect(snapshot.error).toBeNull();
    expect(snapshot.candidates).toEqual([]);
    expect(snapshot.recommendation).toEqual({ source: 'bundled', mode: 'bundled', resolved: exe });
    expect(snapshot.modes.map(item => item.mode)).toEqual(['external', 'command', 'path', 'configured', 'bundled']);
    expect(settings).toEqual({}); expect(env).toEqual({});
  });
  it('keeps a saved record authoritative despite contradictory legacy inputs', () => {
    const saved = records[2];
    const snapshot = describeOpenCodeConnections({ settings: { opencodeConnection: saved, opencodeBinary: '/old' }, env: { OPENCODE_HOST: 'invalid' }, resolveBinary });
    expect(snapshot.saved).toEqual(saved); expect(snapshot.candidates).toEqual([]); expect(snapshot.error).toBeNull();
    expect(snapshot.recommendation).toBeNull();
  });
  it('retains separate matching source provenance and requires confirmation', () => {
    const snapshot = describeOpenCodeConnections({ settings: { opencodeBinary: exe }, env: { OPENCODE_BINARY: '"' + exe + '"', OPENCODE_PATH: exe }, resolveBinary });
    expect(snapshot.error).toBeNull(); expect(snapshot.recommendation).toBeNull();
    expect(snapshot.candidates.map(item => [item.source, item.key])).toEqual([['environment', 'OPENCODE_BINARY'], ['environment', 'OPENCODE_PATH'], ['settings', 'opencodeBinary']]);
    expect(snapshot.candidates.every(item => item.record.confirmed === false && item.resolved === exe)).toBe(true);
    for (const candidate of snapshot.candidates) expect(() => parseOpenCodeConnection(candidate.record)).toThrow();
  });
  it('shows a conflict instead of choosing endpoint versus executable precedence', () => {
    const snapshot = describeOpenCodeConnections({ settings: {}, env: { OPENCODE_HOST: 'https://example.test/base/', OPENCODE_BINARY: exe }, resolveBinary });
    expect(snapshot.error).toBe('conflict'); expect(snapshot.candidates).toHaveLength(2);
  });
  it.each(['https://user:secret@example.test', 'https://example.test/?token=secret', 'secret', 42])('does not echo malformed or credential-bearing endpoint %s', host => {
    const snapshot = describeOpenCodeConnections({ settings: {}, env: { OPENCODE_HOST: host }, resolveBinary });
    expect(snapshot.error).toBe('invalid'); expect(snapshot.recommendation).toBeNull();
    expect(snapshot.candidates).toEqual([{ source: 'environment', key: 'OPENCODE_HOST', record: null, error: 'invalid' }]);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });
  it('reports absent PATH/bundle and unavailable imported binary without substituting another mode', () => {
    const resolveBinary = vi.fn(() => { throw new Error('fixture detail'); });
    const snapshot = describeOpenCodeConnections({ settings: { opencodeBinary: exe }, env: {}, resolveBinary });
    expect(snapshot.error).toBe('unavailable'); expect(snapshot.recommendation).toBeNull();
    expect(snapshot.modes.filter(item => !item.available).map(item => item.mode)).toEqual(['path', 'bundled']);
    expect(snapshot.candidates[0].record.confirmed).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('fixture detail');
  });
  it('keeps invalid saved state visible while allowing valid imported candidates to be edited', () => {
    const snapshot = describeOpenCodeConnections({ settings: { opencodeConnection: { mode: 'guessed' }, opencodeBinary: exe }, env: {}, resolveBinary });
    expect(snapshot.error).toBe('invalid'); expect(snapshot.saved).toBeNull();
    expect(snapshot.candidates[0].record.exe).toBe(exe); expect(snapshot.recommendation).toBeNull();
  });
});

it.each(['OPENCODE_SKIP_START', 'OPENCHAMBER_SKIP_OPENCODE_START'])('does not recommend a bundle for %s without an endpoint', key => {
  const snapshot = describeOpenCodeConnections({ settings: {}, env: { [key]: 'true' }, resolveBinary: record => record.exe ?? exe });
  expect(snapshot.error).toBe('invalid'); expect(snapshot.recommendation).toBeNull();
  expect(snapshot.candidates[0].key).toBe(key);
});
