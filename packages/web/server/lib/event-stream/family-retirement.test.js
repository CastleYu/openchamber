import { describe, expect, it } from 'vitest';

import { createAgentHost } from '../agent/host.js';
import { AGENT_FAMILY } from '../agent/constants.js';
import { createGlobalMessageStreamHub } from './global-hub.js';
import { createOpenCodeWatcherRuntime } from '../opencode/watcher.js';
import { OPENCODE_PROFILE } from '../opencode/compatibility.js';

const kernel = { generation: 'oc1', endpoint: 'http://opencode.test', epoch: 4 };
const urlFor = (path) => `http://opencode.test${path}`;
const openCodeHost = () => createAgentHost({ getAcceptance: () => null });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('event stream family retirement', () => {
  it('does no kernel or HTTP work for CAgent hub selection', () => {
    const selection = { family: AGENT_FAMILY.CAGENT, revision: 7 };
    let kernelReads = 0;
    let fetchCalls = 0;
    const hub = createGlobalMessageStreamHub({
      getBackendSelection: () => selection,
      getKernelRuntime: () => { kernelReads += 1; return kernel; },
      buildOpenCodeUrl: urlFor,
      fetchImpl: async () => { fetchCalls += 1; throw new Error('unexpected HTTP'); },
    });
    hub.start();
    hub.injectEvent({ spaceId: 'unavailable-space', payload: { type: 'session.updated' } });
    expect(kernelReads).toBe(0);
    expect(fetchCalls).toBe(0);

  });

  it('does not wait or subscribe for CAgent watcher selection', async () => {
    const selection = { family: AGENT_FAMILY.CAGENT, revision: 7 };
    let kernelReads = 0;
    let waitCalls = 0;
    let subscribeCalls = 0;
    const watcher = createOpenCodeWatcherRuntime({
      getBackendSelection: () => selection,
      waitForOpenCodePort: async () => { waitCalls += 1; },
      buildOpenCodeUrl: urlFor,
      getKernelRuntime: () => { kernelReads += 1; return kernel; },
      onPayload: () => {},
      globalEventHub: {
        subscribeEvent: () => { subscribeCalls += 1; return () => {}; },
        subscribeStatus: () => { subscribeCalls += 1; return () => {}; },
        start: () => {},
      },
    });
    await watcher.start();
    expect(waitCalls).toBe(0);
    expect(subscribeCalls).toBe(0);
    expect(kernelReads).toBe(0);
  });

  it('does not subscribe if selection changes while watcher readiness is pending', async () => {
    const host = openCodeHost();
    let releaseReadiness;
    const readiness = new Promise((resolve) => { releaseReadiness = resolve; });
    let subscriptions = 0;
    let starts = 0;
    const watcher = createOpenCodeWatcherRuntime({
      getBackendSelection: host.getSelection,
      getSelectionSignal: host.getSelectionSignal,
      waitForOpenCodePort: () => readiness,
      buildOpenCodeUrl: urlFor,
      getKernelRuntime: () => kernel,
      onPayload: () => {},
      globalEventHub: {
        subscribeEvent: () => { subscriptions += 1; return () => {}; },
        subscribeStatus: () => { subscriptions += 1; return () => {}; },
        start: () => { starts += 1; },
      },
    });
    const pending = watcher.start();
    host.clear();
    releaseReadiness();
    await pending;
    expect(subscriptions).toBe(0);
    expect(starts).toBe(0);
  });

  it('aborts a retired SSE stream, clears replay, rejects late injections, then starts fresh on OpenCode selection', async () => {
    const host = openCodeHost();
    const statuses = [];
    const events = [];
    const signals = [];
    const descriptor = { ...kernel };
    // Synthetic fetch/reader models an SSE connection that remains open until its signal aborts.
    const hub = createGlobalMessageStreamHub({
      getBackendSelection: host.getSelection,
      getSelectionSignal: host.getSelectionSignal,
      getKernelRuntime: () => descriptor,
      buildOpenCodeUrl: urlFor,
      upstreamReconnectDelayMs: 60_000,
      fetchImpl: async (_url, options) => {
        signals.push(options.signal);
        return {
          ok: true,
          body: {
            getReader() {
              let sent = false;
              return {
                async read() {
                  if (!sent) {
                    sent = true;
                    return { value: new TextEncoder().encode('id: before-clear\ndata: {"type":"session.updated"}\n\n'), done: false };
                  }
                  return new Promise((resolve) => options.signal.addEventListener('abort', () => resolve({ done: true }), { once: true }));
                },
                cancel() {},
              };
            },
          },
        };
      },
    });
    hub.subscribeEvent((event) => events.push(event), { spaces: true });
    hub.subscribeStatus((status) => statuses.push(status.type));
    hub.start();
    await waitFor(() => expect(events.map((event) => event.eventId)).toContain('before-clear'));
    expect(hub.replayAfter('before-clear')).toEqual([]);
    const descriptorBeforeClear = { ...descriptor };

    host.clear();
    expect(signals[0].aborted).toBe(true);
    expect(descriptor).toEqual(descriptorBeforeClear);
    expect(hub.replayAfter('before-clear')).toBeNull();
    expect(statuses).toContain('identity-change');
    hub.injectEvent({ spaceId: 'space-old', payload: { type: 'session.updated', id: 'late-old-event' } });
    expect(events.map((event) => event.payload.id)).not.toContain('late-old-event');

    host.selectOpenCode();
    hub.start();
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[1].aborted).toBe(false);
    await waitFor(() => expect(hub.replayAfter('before-clear')).toEqual([]));
    hub.stop();
    // An unused hub has removed its abort listener. Restart must still retire its stored replay.
    host.selectOpenCode();
    hub.start();
    expect(hub.replayAfter('before-clear')).toBeNull();
    hub.stop();
  });

  it('detaches watcher subscriptions when the selected host is cleared', async () => {
    const host = openCodeHost();
    const activeEvents = new Set();
    const activeStatuses = new Set();
    let starts = 0;
    const hub = {
      subscribeEvent: (subscriber) => { activeEvents.add(subscriber); return () => activeEvents.delete(subscriber); },
      subscribeStatus: (subscriber) => { activeStatuses.add(subscriber); return () => activeStatuses.delete(subscriber); },
      start: () => { starts += 1; },
    };
    const watcher = createOpenCodeWatcherRuntime({
      getBackendSelection: host.getSelection,
      getSelectionSignal: host.getSelectionSignal,
      waitForOpenCodePort: async () => {},
      buildOpenCodeUrl: urlFor,
      getKernelRuntime: () => kernel,
      onPayload: () => {},
      globalEventHub: hub,
    });
    await watcher.start();
    expect(starts).toBe(1);
    expect(activeEvents.size).toBe(1);
    expect(activeStatuses.size).toBe(1);
    host.clear();
    expect(activeEvents.size).toBe(0);
    expect(activeStatuses.size).toBe(0);
  });
});

async function waitFor(assertion) {
  const deadline = Date.now() + 1500;
  let lastError;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

  it('rejects a Legacy hub profile without its exact version, and refuses synthetic injection', async () => {
    const descriptor = { generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY, endpoint: 'http://opencode.test', epoch: 4 };
    let fetchCalls = 0;
    const events = [];
    const hub = createGlobalMessageStreamHub({
      getKernelRuntime: () => descriptor,
      buildOpenCodeUrl: urlFor,
      fetchImpl: async () => { fetchCalls += 1; throw new Error('unexpected HTTP'); },
    });
    hub.subscribeEvent((event) => events.push(event), { spaces: true });
    hub.injectEvent({ payload: { type: 'session.updated', id: 'legacy-injection' } });
    hub.start();
    await wait(10);
    expect(fetchCalls).toBe(0);
    expect(events).toEqual([]);
    expect(hub.replayAfter('legacy-cursor')).toBeNull();
  });

  it('does not wait, subscribe, or fetch for Legacy watcher profiles', async () => {
    const descriptor = { generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY, endpoint: 'http://opencode.test', epoch: 4 };
    let waits = 0;
    let subscriptions = 0;
    let fetchCalls = 0;
    const globalEventHub = {
      subscribeEvent: () => { subscriptions += 1; return () => {}; },
      subscribeStatus: () => { subscriptions += 1; return () => {}; },
      start: () => {},
    };
    const deps = {
      waitForOpenCodePort: async () => { waits += 1; },
      buildOpenCodeUrl: urlFor,
      getKernelRuntime: () => descriptor,
      onPayload: () => {},
      fetchImpl: async () => { fetchCalls += 1; throw new Error('unexpected HTTP'); },
    };
    await createOpenCodeWatcherRuntime({ ...deps, globalEventHub }).start();
    await createOpenCodeWatcherRuntime(deps).start();
    expect(waits).toBe(0);
    expect(subscriptions).toBe(0);
    expect(fetchCalls).toBe(0);
  });

  it('refuses watcher admission when readiness resolves to Legacy', async () => {
    let descriptor = { generation: 'oc1', endpoint: 'http://opencode.test', epoch: 4 };
    let subscriptions = 0;
    const globalEventHub = {
      subscribeEvent: () => { subscriptions += 1; return () => {}; },
      subscribeStatus: () => { subscriptions += 1; return () => {}; },
      start: () => {},
    };
    const watcher = createOpenCodeWatcherRuntime({
      waitForOpenCodePort: async () => { descriptor = { ...descriptor, profile: OPENCODE_PROFILE.LEGACY }; },
      buildOpenCodeUrl: urlFor,
      getKernelRuntime: () => descriptor,
      globalEventHub,
      onPayload: () => {},
    });
    await watcher.start();
    expect(subscriptions).toBe(0);

    let standaloneDescriptor = { generation: 'oc1', endpoint: 'http://opencode.test', epoch: 4 };
    let standaloneFetches = 0;
    const standalone = createOpenCodeWatcherRuntime({
      waitForOpenCodePort: async () => { standaloneDescriptor = { ...standaloneDescriptor, profile: OPENCODE_PROFILE.LEGACY }; },
      buildOpenCodeUrl: urlFor,
      getKernelRuntime: () => standaloneDescriptor,
      fetchImpl: async () => { standaloneFetches += 1; throw new Error('unexpected HTTP'); },
      onPayload: () => {},
    });
    await standalone.start();
    expect(standaloneFetches).toBe(0);
  });

it('retires buffered and replayed events when only the profile changes', () => {
  let descriptor = { generation: 'oc2', profile: OPENCODE_PROFILE.OC2, endpoint: 'http://opencode.test', epoch: 4 };
  const events = [];
  const hub = createGlobalMessageStreamHub({
    getKernelRuntime: () => descriptor,
    buildOpenCodeUrl: urlFor,
    deltaCoalesceWindowMs: 1_000,
  });
  hub.subscribeEvent((event) => events.push(event), { spaces: true });
  hub.injectEvent({ payload: { type: 'session.updated', id: 'before-profile-change' } });
  const cursor = events[0].eventId;
  hub.injectEvent({ payload: { type: 'message.part.delta', properties: { sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: 'first' } } });
  hub.injectEvent({ payload: { type: 'message.part.delta', properties: { sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: 'buffered' } } });
  const deliveredBeforeRetirement = events.length;
  descriptor = { ...descriptor, profile: OPENCODE_PROFILE.LEGACY };
  hub.stop();
  hub.injectEvent({ payload: { type: 'session.updated', id: 'legacy-injection' } });
  expect(events).toHaveLength(deliveredBeforeRetirement);
  expect(hub.replayAfter(cursor)).toBeNull();
});
it('drops a subscribed watcher event after a profile-only retirement', async () => {
  let descriptor = { generation: 'oc2', profile: OPENCODE_PROFILE.OC2, endpoint: 'http://opencode.test', epoch: 4 };
  let receive;
  let translated = 0;
  const payloads = [];
  const watcher = createOpenCodeWatcherRuntime({
    waitForOpenCodePort: async () => {},
    getKernelRuntime: () => descriptor,
    buildOpenCodeUrl: urlFor,
    onPayload: (value) => payloads.push(value),
    globalEventHub: {
      subscribeEvent: (callback) => { receive = callback; return () => {}; },
      subscribeStatus: () => () => {},
      start: () => {},
    },
  });
  await watcher.start();
  descriptor = { ...descriptor, profile: OPENCODE_PROFILE.LEGACY };
  receive({ translated: () => { translated += 1; return [{ type: 'session.updated' }]; } });
  watcher.stop();
  expect(translated).toBe(0);
  expect(payloads).toEqual([]);
});

it('drops standalone watcher data completed after a profile-only retirement', async () => {
  let descriptor = { generation: 'oc2', profile: OPENCODE_PROFILE.OC2, endpoint: 'http://opencode.test', epoch: 4 };
  let respond;
  const payloads = [];
  const watcher = createOpenCodeWatcherRuntime({
    waitForOpenCodePort: async () => {},
    getKernelRuntime: () => descriptor,
    buildOpenCodeUrl: urlFor,
    onPayload: (value) => payloads.push(value),
    fetchImpl: () => new Promise((resolve) => { respond = resolve; }),
  });
  await watcher.start();
  await waitFor(() => expect(respond).toBeDefined());
  descriptor = { ...descriptor, profile: OPENCODE_PROFILE.LEGACY };
  respond(new Response('data: {"type":"session.updated"}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  await wait(10);
  watcher.stop();
  expect(payloads).toEqual([]);
});
it('continues watching committed hub events after a same-target restart', async () => {
  let descriptor = { generation: 'oc2', profile: OPENCODE_PROFILE.OC2, endpoint: 'http://opencode.test', epoch: 4 };
  const payloads = [];
  const hub = createGlobalMessageStreamHub({ getKernelRuntime: () => descriptor, buildOpenCodeUrl: urlFor });
  const watcher = createOpenCodeWatcherRuntime({
    waitForOpenCodePort: async () => {},
    getKernelRuntime: () => descriptor,
    buildOpenCodeUrl: urlFor,
    onPayload: (payload) => payloads.push(payload),
    globalEventHub: { ...hub, start: () => {} },
  });
  await watcher.start();
  hub.injectEvent({ payload: { type: 'session.updated', id: 'before-restart' } });
  descriptor = { ...descriptor, epoch: 5 };
  hub.injectEvent({ payload: { type: 'session.updated', id: 'after-restart' } });
  watcher.stop();
  hub.stop();
  expect(payloads.map((payload) => payload.id)).toEqual(['before-restart', 'after-restart']);
});
