import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const legacyEvent = mock();
const active = mock();
const subscribe = mock();
mock.module('@opencode-ai/sdk/v2', () => ({ createOpencodeClient: () => ({ global: { event: legacyEvent } }) }));
mock.module('@opencode/client', () => ({ OpenCode: { make: () => ({ session: { active }, event: { subscribe } }) } }));

const { getSessionActivitySnapshot, startGlobalEventWatcher, stopGlobalEventWatcher } = await import('./sessionActivityWatcher');

const manager = (generation) => {
  const descriptor = { generation, endpoint: 'http://127.0.0.1:4096', epoch: 1 };
  return {
    getStatus: () => 'connected',
    getApiUrl: () => descriptor.endpoint,
    getOpenCodeAuthHeaders: () => ({}),
    getKernelRuntime: () => descriptor,
    refreshKernelRuntime: async () => descriptor,
    onStatusChange: () => ({ dispose() {} }),
  };
};

const until = async (condition) => {
  for (let i = 0; i < 50; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('activity event did not arrive');
};

describe('VS Code session activity watcher', () => {
  beforeEach(() => {
    active.mockClear();
    subscribe.mockClear();
    legacyEvent.mockClear();
  });
  afterEach(() => {
    stopGlobalEventWatcher();
  });

  it('uses OC2 active sessions and execution events', async () => {
    const messages = [];
    active.mockImplementation(async () => ({ running: {} }));
    subscribe.mockImplementation(async function* () {
      yield { type: 'session.execution.started', data: { sessionID: 'fresh' } };
      yield { type: 'session.execution.succeeded', data: { sessionID: 'fresh' } };
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await startGlobalEventWatcher(manager('oc2'), { postMessage: (value) => messages.push(value) });
    await until(() => getSessionActivitySnapshot().fresh?.type === 'cooldown');
    expect(getSessionActivitySnapshot().running.type).toBe('busy');
    expect(messages.map((item) => item.properties?.phase)).toEqual(['busy', 'busy', 'cooldown']);
    expect(legacyEvent).not.toHaveBeenCalled();
  });

  it('keeps OC1 status and global event vocabulary', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ old: { type: 'busy' } }), { status: 200 }));
    legacyEvent.mockImplementation(async () => ({ stream: (async function* () {
      yield { payload: { type: 'session.idle', properties: { sessionID: 'old' } } };
      await new Promise((resolve) => setTimeout(resolve, 100));
    })() }));
    try {
      await startGlobalEventWatcher(manager('oc1'), { postMessage: () => undefined });
      await until(() => getSessionActivitySnapshot().old?.type === 'idle');
      expect(active).not.toHaveBeenCalled();
      expect(legacyEvent).toHaveBeenCalled();
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it('does not publish an OC2 active snapshot from a replaced connection', async () => {
    const selected = manager('oc2');
    let epoch = 1;
    selected.getKernelRuntime = () => ({ generation: 'oc2', endpoint: 'http://127.0.0.1:4096', epoch });
    active.mockImplementation(async () => {
      epoch = 2;
      return { stale: {} };
    });
    subscribe.mockImplementation(async function* () {
      yield { type: 'session.execution.started', data: { sessionID: 'stale' } };
    });
    await startGlobalEventWatcher(selected, { postMessage: () => undefined });
    await until(() => active.mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getSessionActivitySnapshot().stale).toBeUndefined();
  });

  it('starts for an external URL with a default HTTPS port', async () => {
    const selected = manager('oc2');
    selected.getApiUrl = () => 'https://opencode.test';
    selected.getKernelRuntime = () => ({ generation: 'oc2', endpoint: 'https://opencode.test', epoch: 1 });
    active.mockImplementation(async () => ({ running: {} }));
    subscribe.mockImplementation(async function* () {
      yield { type: 'session.execution.started', data: { sessionID: 'running' } };
    });
    await startGlobalEventWatcher(selected, { postMessage: () => undefined });
    await until(() => getSessionActivitySnapshot().running?.type === 'busy');
    expect(active).toHaveBeenCalled();
  });
});
