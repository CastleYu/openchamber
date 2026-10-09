import { describe, expect, test } from 'bun:test';
import { OPEN_CODE_PROFILE, OpenCodeRuntimeBinding, OpenCodeRuntimeChangedError, OpenCodeRuntimeError } from './runtime';

describe('OpenCode runtime binding', () => {
  test('does not guess OC1 before the first descriptor is bound', () => {
    const binding = new OpenCodeRuntimeBinding();
    expect(() => binding.assert('oc1', 'session.list')).toThrow(OpenCodeRuntimeError);
    expect(() => binding.assert('oc2', 'session.list')).toThrow(OpenCodeRuntimeError);
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
    const descriptor = { generation: 'oc1' as const, endpoint: 'http://localhost:4099', epoch: 1, version: '1.2.27', profile: OPEN_CODE_PROFILE.LEGACY };
    binding.set(descriptor);
    let finish!: (value: string) => void;
    const pending = binding.run('oc1', 'session.list', () => new Promise<string>(resolve => { finish = resolve; }));
    binding.set({ ...descriptor });
    finish('current');
    expect(await pending).toBe('current');
  });
});
