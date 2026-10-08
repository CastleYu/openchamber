import { describe, expect, it } from 'vitest';

import { createAgentHost } from '../agent/host.js';
import { AGENT_FAMILY } from '../agent/constants.js';
import { createGlobalMessageStreamHub } from './global-hub.js';
import { createOpenCodeWatcherRuntime } from '../opencode/watcher.js';

const kernel = { generation: 'oc1', endpoint: 'http://opencode.test', epoch: 4 };
const urlFor = (path) => `http://opencode.test${path}`;
const openCodeHost = () => createAgentHost({ getAcceptance: () => null });

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
