import { describe, expect, test } from 'bun:test';
import { OPEN_CODE_PROFILE, OpenCodeRuntimeBinding, OpenCodeRuntimeChangedError, OpenCodeRuntimeError } from './runtime';

describe('OpenCode runtime binding', () => {
  test('does not guess OC1 before the first descriptor is bound', () => {
    const binding = new OpenCodeRuntimeBinding();
    expect(() => binding.assert('oc1', 'session.list')).toThrow(OpenCodeRuntimeError);
    expect(() => binding.assert('oc2', 'session.list')).toThrow(OpenCodeRuntimeError);
    expect(() => binding.assert('oc1', 'mcp.create')).toThrow(OpenCodeRuntimeError);
    expect(() => binding.assert('oc1', 'mcp.auth')).toThrow(OpenCodeRuntimeError);
  });
  test('rejects OC1 operations on a detected OC2 endpoint', () => {
    const binding = new OpenCodeRuntimeBinding();
    binding.set({ generation: 'oc2', endpoint: 'http://localhost:4099', epoch: 1, version: '2.0.16' });
    expect(() => binding.assert('oc1', 'session.list')).toThrow(OpenCodeRuntimeError);
  });

  test('invalidates an in-flight result after endpoint or epoch changes', async () => {
    const binding = new OpenCodeRuntimeBinding();
    binding.set({ generation: 'oc1', endpoint: 'http://localhost:4099', epoch: 1, version: '1.2.27' });
    let finish!: (value: string) => void;
    const pending = binding.run('oc1', 'session.list', () => new Promise<string>((resolve) => { finish = resolve; }));
    binding.set({ generation: 'oc1', endpoint: 'http://localhost:4100', epoch: 2, version: '1.2.27' });
    finish('stale');
    await expect(pending).rejects.toThrow(OpenCodeRuntimeChangedError);
  });

  test('does not invalidate a request for a duplicate descriptor', async () => {
    const binding = new OpenCodeRuntimeBinding();
    const descriptor = { generation: 'oc1' as const, endpoint: 'http://localhost:4099', epoch: 1, version: '1.2.27' };
    binding.set(descriptor);
    let finish!: (value: string) => void;
    const pending = binding.run('oc1', 'session.list', () => new Promise<string>((resolve) => { finish = resolve; }));
    binding.set({ ...descriptor });
    finish('current');
    expect(await pending).toBe('current');
  });

  test('requires a new descriptor after reconnect', () => {
    const binding = new OpenCodeRuntimeBinding();
    binding.set({ generation: 'oc1', endpoint: 'http://localhost:4099', epoch: 1, version: '1.2.27' });
    binding.clear();
    expect(() => binding.assert('oc1', 'session.list')).toThrow(OpenCodeRuntimeError);
  });
});

describe('OpenCode profile identity', () => {
  test('rejects a stale result when only the resolved profile changes', async () => {
    const binding = new OpenCodeRuntimeBinding();
    const descriptor = { generation: 'oc1' as const, endpoint: 'http://localhost:4099', epoch: 1, version: '1.2.27' };
    binding.set({ ...descriptor, profile: OPEN_CODE_PROFILE.OC1 });
    let finish!: (value: string) => void;
    const pending = binding.run('oc1', 'session.list', () => new Promise<string>(resolve => { finish = resolve; }));
    binding.set({ ...descriptor, profile: OPEN_CODE_PROFILE.LEGACY });
    finish('stale');
    await expect(pending).rejects.toThrow(OpenCodeRuntimeChangedError);
  });
  test('keeps a current request when the resolved profile is unchanged', async () => {
    const binding = new OpenCodeRuntimeBinding();
    const descriptor = { generation: 'oc1' as const, endpoint: 'http://localhost:4099', epoch: 1, version: '1.18.32', profile: OPEN_CODE_PROFILE.OC1 };
    binding.set(descriptor);
    let finish!: (value: string) => void;
    const pending = binding.run('oc1', 'session.list', () => new Promise<string>(resolve => { finish = resolve; }));
    binding.set({ ...descriptor });
    finish('current');
    expect(await pending).toBe('current');
  });
});

test('host and UI admission status constants agree', async () => {
  const { OPEN_CODE_STATUS } = await import('./runtime');
  const { PROFILE_STATUS } = await import('../../../../web/server/lib/opencode/compatibility.js');
  expect(OPEN_CODE_STATUS).toEqual(PROFILE_STATUS);
});

describe('failed completion ownership', () => {
  for (const changed of [false, true]) test('failed request with replacement ' + changed, async () => {
    const binding = new OpenCodeRuntimeBinding();
    const runtime = { generation: 'oc1' as const, endpoint: 'http://kernel.test', epoch: 1, version: '1.18.33' };
    binding.set(runtime);
    let fail!: (error: Error) => void;
    const failure = new Error('upstream unavailable');
    const pending = binding.run('oc1', 'provider.auth', () => new Promise<void>((_resolve, reject) => { fail = reject; }));
    if (changed) binding.set({ ...runtime, epoch: 2 });
    fail(failure);
    if (changed) await expect(pending).rejects.toThrow(OpenCodeRuntimeChangedError);
    else expect(await pending.catch(error => error)).toBe(failure);
  });
});

describe('exact Legacy conversation admission', () => {
  const runtime = { generation: 'oc1' as const, profile: OPEN_CODE_PROFILE.LEGACY, endpoint: 'http://kernel.test', epoch: 1, version: '1.2.27' };
  test('admits conversation, bootstrap, and owned metadata operations', () => {
    const binding = new OpenCodeRuntimeBinding(); binding.set(runtime);
    for (const operation of ['session.list', 'session.create', 'session.update', 'session.delete', 'sync.session.pages', 'sync.permission.list', 'SDK request', 'mcp.status', 'mcp.connect', 'mcp.disconnect']) {
      binding.assert('oc1', operation);
    }
    for (const operation of ['session.share', 'session.fork', 'config.update']) {
      expect(() => binding.assert('oc1', operation)).toThrow(OpenCodeRuntimeError);
    }
    expect(() => binding.assert('oc2', 'session.list')).toThrow(OpenCodeRuntimeError);
    expect(() => binding.assert('oc1', 'mcp.create')).toThrow(OpenCodeRuntimeError);
    expect(() => binding.assert('oc1', 'mcp.auth')).toThrow(OpenCodeRuntimeError);
  });
  test('refuses the same operation when exact version identity is absent or mismatched', () => {
    const binding = new OpenCodeRuntimeBinding();
    for (const version of [null, '1.2.28']) {
      binding.set({ ...runtime, version });
      expect(() => binding.assert('oc1', 'session.list')).toThrow(OpenCodeRuntimeError);
    }
  });
});

describe('exact Legacy MCP epoch admission', () => {
  const runtime = { generation: 'oc1' as const, profile: OPEN_CODE_PROFILE.LEGACY, endpoint: 'http://kernel.test', epoch: 1, version: '1.2.27' };
  test('retires an in-flight MCP result after an epoch change', async () => {
    const binding = new OpenCodeRuntimeBinding(); binding.set(runtime);
    let finish!: (value: string) => void;
    const pending = binding.run('oc1', 'mcp.status', () => new Promise<string>(resolve => { finish = resolve; }));
    binding.set({ ...runtime, epoch: 2 });
    finish('stale');
    await expect(pending).rejects.toThrow(OpenCodeRuntimeChangedError);
  });
  test('requires the exact Legacy generation and version for MCP calls', () => {
    const binding = new OpenCodeRuntimeBinding();
    for (const change of [{ generation: 'oc2' as const }, { version: '1.2.28' }]) {
      binding.set({ ...runtime, ...change });
      expect(() => binding.assert('oc1', 'mcp.status')).toThrow(OpenCodeRuntimeError);
    }
  });
  test('preserves current OC1 MCP operations and OC2 generation separation', () => {
    const binding = new OpenCodeRuntimeBinding();
    binding.set({ ...runtime, profile: OPEN_CODE_PROFILE.OC1, version: '1.18.33' });
    for (const operation of ['mcp.status', 'mcp.connect', 'mcp.disconnect']) {
      binding.assert('oc1', operation);
      expect(() => binding.assert('oc2', operation)).toThrow(OpenCodeRuntimeError);
    }
    binding.set({ ...runtime, generation: 'oc2', profile: OPEN_CODE_PROFILE.OC2, version: '2.0.20' });
    expect(() => binding.assert('oc1', 'mcp.status')).toThrow(OpenCodeRuntimeError);
  });
});
