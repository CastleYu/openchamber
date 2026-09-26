import { describe, expect, it } from 'vitest';
import { createKernelRuntime, KernelRuntimeChangedError } from './kernel-runtime.js';

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
