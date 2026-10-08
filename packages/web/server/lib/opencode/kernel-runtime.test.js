import { describe, expect, it } from 'vitest';
import { createKernelRuntime, KernelRuntimeChangedError } from './kernel-runtime.js';
import { createKernelOperations } from './kernel-operations.js';
import { AGENT_FAMILY } from '../agent/constants.js';

const ready = (endpoint, epoch, version = '1.18.32') => ({
  generation: 'oc1', endpoint, epoch, version,
});

describe('backend kernel identity', () => {
  it.each(['refresh-first', 'reprobe-first'])('shares a valid probe across concurrent consumers: %s', async (order) => {
    let finish;
    let calls = 0;
    const changes = [];
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}),
      detect: (input) => {
        calls += 1;
        return new Promise((resolve) => { finish = () => resolve(ready(input.endpoint, input.epoch)); });
      },
      onChange: (descriptor) => changes.push(descriptor),
    });
    const first = order === 'refresh-first' ? runtime.refresh() : runtime.reprobe();
    const second = order === 'refresh-first' ? runtime.reprobe() : runtime.refresh();
    await Promise.resolve();
    finish();
    const results = await Promise.all([first, second]);
    const descriptor = results[order === 'refresh-first' ? 0 : 1];
    const health = results[order === 'refresh-first' ? 1 : 0];
    expect(health.descriptor).toEqual(descriptor);
    expect(health.generation).toBe('oc1');
    expect(calls).toBe(1);
    expect(changes).toHaveLength(1);
    expect(runtime.get()).toEqual(descriptor);
  });

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

describe('backend family selection', () => {
  const openCode = (revision = 0) => ({ family: AGENT_FAMILY.OPENCODE, revision });
  const cagent = (revision = 0) => ({ family: AGENT_FAMILY.CAGENT, revision });

  it('rejects a pending probe after a family round trip without an intervening read', async () => {
    let selection = openCode();
    let finish;
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}),
      getBackendSelection: () => selection,
      detect: (input) => new Promise((resolve) => { finish = () => resolve(ready(input.endpoint, input.epoch)); }),
    });
    const pending = runtime.refresh();
    await Promise.resolve();
    selection = cagent(1);
    selection = openCode(2);
    finish();
    await expect(pending).rejects.toBeInstanceOf(KernelRuntimeChangedError);
    expect(runtime.get().generation).toBe('unknown');
  });

  it('does not resolve OpenCode while CAgent is selected, including refresh and re-probe', async () => {
    let detections = 0;
    let headers = 0;
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096',
      getHeaders: () => { headers += 1; return {}; },
      getBackendSelection: () => cagent(),
      detect: async () => { detections += 1; return ready('http://127.0.0.1:4096', 0); },
    });

    expect(runtime.get()).toMatchObject({ generation: 'unsupported', endpoint: null, version: null });
    expect(await runtime.refresh()).toMatchObject({ generation: 'unsupported', endpoint: null, version: null });
    expect((await runtime.reprobe()).generation).toBe('unsupported');
    expect(detections).toBe(0);
    expect(headers).toBe(0);
  });

  it('retires a known OpenCode descriptor and rejects a probe when CAgent takes over', async () => {
    let selection = openCode();
    let finish;
    let detections = 0;
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}),
      getBackendSelection: () => selection,
      detect: (input) => {
        detections += 1;
        if (detections === 1) return Promise.resolve(ready(input.endpoint, input.epoch));
        return new Promise((resolve) => { finish = () => resolve(ready(input.endpoint, input.epoch)); });
      },
    });
    expect((await runtime.refresh()).generation).toBe('oc1');
    const pending = runtime.refresh();
    await Promise.resolve();
    selection = cagent();

    expect(runtime.get()).toMatchObject({ generation: 'unsupported', endpoint: null, version: null });
    finish();
    await expect(pending).rejects.toBeInstanceOf(KernelRuntimeChangedError);
    expect((await runtime.refresh()).generation).toBe('unsupported');
    expect((await runtime.reprobe()).generation).toBe('unsupported');
    expect(detections).toBe(2);
  });

  it('retires epochs across a same-endpoint family return and a revision-only change', async () => {
    let selection = openCode(1);
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}),
      getBackendSelection: () => selection,
      detect: async ({ endpoint, epoch }) => ready(endpoint, epoch),
    });
    const initial = await runtime.refresh();

    selection = cagent(1);
    expect(runtime.get().generation).toBe('unsupported');
    selection = openCode(2);
    expect(runtime.get().generation).toBe('unknown');
    const returned = await runtime.refresh();
    expect(returned.endpoint).toBe(initial.endpoint);
    expect(returned.epoch).toBeGreaterThan(initial.epoch);

    selection = openCode(3);
    expect(runtime.get().generation).toBe('unknown');
    const revised = await runtime.refresh();
    expect(revised.epoch).toBeGreaterThan(returned.epoch);
  });
});

describe('CAgent kernel-operation boundary', () => {
  const runtimeDescriptor = (family, epoch = 1) => (family === AGENT_FAMILY.CAGENT
    ? { generation: 'unsupported', endpoint: null, epoch, version: null }
    : { generation: 'oc1', endpoint: 'http://127.0.0.1:4096', epoch, version: '1.18.32' });

  it('refuses session reads and sends before issuing a fetch', async () => {
    let calls = 0;
    const operations = createKernelOperations({
      getRuntime: () => runtimeDescriptor(AGENT_FAMILY.CAGENT), getHeaders: () => ({}),
      fetchImpl: async () => { calls += 1; return new Response('{}'); },
    });
    const request = { generation: 'unsupported', endpoint: null, epoch: 1, body: {} };

    await expect(operations.getSession({ sessionID: 'session-1', directory: 'C:/project' }))
      .rejects.toMatchObject({ code: 'unsupported-generation' });
    await expect(operations.sendPrompt({ sessionID: 'session-1', directory: 'C:/project', request }))
      .rejects.toMatchObject({ code: 'unsupported-generation' });
    expect(calls).toBe(0);
  });

  it('rejects a session read that completes after the backend family changes', async () => {
    let descriptor = runtimeDescriptor(AGENT_FAMILY.OPENCODE);
    let finish;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const operations = createKernelOperations({
      getRuntime: () => descriptor, getHeaders: () => ({}),
      fetchImpl: () => {
        markStarted();
        return new Promise((resolve) => { finish = () => resolve(new Response(JSON.stringify({
          id: 'session-1', directory: 'C:/project',
        }), { status: 200, headers: { 'content-type': 'application/json' } })); });
      },
    });
    const pending = operations.getSession({ sessionID: 'session-1', directory: 'C:/project' });
    await started;
    descriptor = runtimeDescriptor(AGENT_FAMILY.CAGENT, 2);
    finish();

    await expect(pending).rejects.toMatchObject({ code: 'runtime-changed' });
  });
});
