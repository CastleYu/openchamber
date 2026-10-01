import { describe, expect, it } from 'vitest';
import { createKernelRuntime, KernelRuntimeChangedError } from './kernel-runtime.js';
import { createKernelOperations } from './kernel-operations.js';

const ready = (endpoint, epoch, version = '1.18.32') => ({
  generation: 'oc1', endpoint, epoch, version,
});

describe('backend kernel identity', () => {
  it('notifies stream owners only when identity changes, including invalidation', async () => {
    const changes = [];
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}),
      detect: async ({ endpoint, epoch }) => ready(endpoint, epoch),
      onChange: (descriptor) => changes.push(descriptor),
    });
    await runtime.refresh();
    await runtime.refresh();
    expect(changes).toHaveLength(1);
    runtime.invalidate();
    expect(changes.at(-1).generation).toBe('unknown');
    await runtime.refresh();
    expect(changes).toHaveLength(3);
    expect(changes[2].epoch).toBeGreaterThan(changes[0].epoch);
  });

  it('does not probe an arbitrary endpoint before startup chooses one', async () => {
    let endpoint = null;
    let calls = 0;
    const runtime = createKernelRuntime({
      getEndpoint: () => endpoint, getHeaders: () => ({}),
      detect: async (input) => { calls += 1; return ready(input.endpoint, input.epoch); },
    });
    expect((await runtime.refresh()).generation).toBe('unknown');
    expect(calls).toBe(0);
    endpoint = 'http://127.0.0.1:4096';
    expect((await runtime.refresh()).generation).toBe('oc1');
    expect(calls).toBe(1);
  });

  it('coalesces pending probes and preserves identity on an unchanged refresh', async () => {
    let calls = 0;
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}),
      detect: async ({ endpoint, epoch }) => { calls += 1; return ready(endpoint, epoch); },
    });
    expect(runtime.get().generation).toBe('unknown');
    const first = runtime.refresh();
    expect(runtime.refresh()).toBe(first);
    const descriptor = await first;
    expect(calls).toBe(1);
    expect(await runtime.refresh()).toEqual(descriptor);
    expect(calls).toBe(2);
  });

  it('rejects a probe from an endpoint that was replaced', async () => {
    let endpoint = 'http://127.0.0.1:4096';
    let finish;
    const runtime = createKernelRuntime({
      getEndpoint: () => endpoint, getHeaders: () => ({}),
      detect: (input) => new Promise((resolve) => { finish = () => resolve(ready(input.endpoint, input.epoch)); }),
    });
    const pending = runtime.refresh();
    await Promise.resolve();
    endpoint = 'http://127.0.0.1:4097';
    expect(runtime.get().generation).toBe('unknown');
    finish();
    await expect(pending).rejects.toBeInstanceOf(KernelRuntimeChangedError);
    expect(runtime.get().endpoint).toBeNull();
  });

  it('invalidates on restart or credential changes even at the same URL', async () => {
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}),
      detect: async ({ endpoint, epoch }) => ready(endpoint, epoch),
    });
    const before = await runtime.refresh();
    runtime.invalidate();
    expect(runtime.get().generation).toBe('unknown');
    const after = await runtime.refresh();
    expect(after.epoch).toBeGreaterThan(before.epoch);
  });

  it('does not start a probe after its connection has already changed', async () => {
    let endpoint = 'http://127.0.0.1:4096';
    let calls = 0;
    const runtime = createKernelRuntime({
      getEndpoint: () => endpoint, getHeaders: () => ({}),
      detect: async (input) => { calls += 1; return ready(input.endpoint, input.epoch); },
    });
    const pending = runtime.refresh();
    endpoint = 'http://127.0.0.1:4097';
    await expect(pending).rejects.toBeInstanceOf(KernelRuntimeChangedError);
    expect(calls).toBe(0);
  });

  it('changes identity when the binary version changes at a stable URL', async () => {
    let version = '1.18.32';
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}),
      detect: async ({ endpoint, epoch }) => ready(endpoint, epoch, version),
    });
    const before = await runtime.refresh();
    version = '1.18.33';
    const after = await runtime.refresh();
    expect(after.epoch).toBeGreaterThan(before.epoch);
    expect(after.version).toBe(version);
  });
});

describe('backend kernel re-probe', () => {
  const buildRuntime = (detect) => createKernelRuntime({
    getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}), detect,
  });
  const result = (generation, endpoint, epoch, version = null) => ({ generation, endpoint, epoch, version });

  it('preserves a resolved kernel and its epoch through one transient re-probe', async () => {
    let mode = 'oc2';
    const runtime = buildRuntime(async ({ endpoint, epoch }) => (mode === 'transient'
      ? result('unreachable', endpoint, epoch)
      : result(mode, endpoint, epoch, mode === 'oc2' ? '2.0.20' : '1.18.32')));
    const before = await runtime.refresh();
    expect(before.generation).toBe('oc2');
    mode = 'transient';

    const probe = await runtime.reprobe();

    expect(probe.preserved).toBe(true);
    expect(probe.generation).toBe('unreachable');
    expect(runtime.get()).toEqual(before);
    expect(runtime.get().epoch).toBe(before.epoch);
    // The preserved descriptor still satisfies the kernel-operations readiness
    // guard, so in-flight operations do not start returning 503.
    const operations = createKernelOperations({ getRuntime: runtime.get, getHeaders: () => ({}) });
    expect(() => operations.captureIdentity()).not.toThrow();
    expect(operations.captureIdentity().generation).toBe('oc2');
  });

  it('keeps the resolved kernel through repeated transient re-probes', async () => {
    let mode = 'oc1';
    const runtime = buildRuntime(async ({ endpoint, epoch }) => (mode === 'transient'
      ? result('unknown', endpoint, epoch)
      : result(mode, endpoint, epoch, '1.18.32')));
    const before = await runtime.refresh();
    mode = 'transient';

    for (let attempt = 0; attempt < 25; attempt += 1) {
      expect((await runtime.reprobe()).preserved).toBe(true);
    }

    expect(runtime.get().generation).toBe('oc1');
    expect(runtime.get().epoch).toBe(before.epoch);
  });

  it('updates when a re-probe identifies a different generation', async () => {
    let mode = 'oc1';
    const runtime = buildRuntime(async ({ endpoint, epoch }) => result(
      mode, endpoint, epoch, mode === 'oc1' ? '1.18.32' : '2.0.20',
    ));
    const before = await runtime.refresh();
    mode = 'oc2';

    const probe = await runtime.reprobe();

    expect(probe.preserved).toBe(false);
    expect(runtime.get().generation).toBe('oc2');
    expect(runtime.get().version).toBe('2.0.20');
    expect(runtime.get().epoch).toBeGreaterThan(before.epoch);
  });

  it('does not resurrect a resolved kernel after an explicit invalidation', async () => {
    const runtime = buildRuntime(async ({ endpoint, epoch }) => result('unreachable', endpoint, epoch));
    await runtime.refresh();
    runtime.invalidate();

    const probe = await runtime.reprobe();

    expect(probe.preserved).toBe(false);
    expect(runtime.get().generation).toBe('unreachable');
  });
});
