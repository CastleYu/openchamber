import { createUpstreamSseReader } from '../event-stream/upstream-reader.js';
import { translateWireEvent } from '../event-stream/translate-v2.js';

export const createOpenCodeWatcherRuntime = (deps) => {
  const {
    waitForOpenCodePort,
    buildOpenCodeUrl,
    getKernelRuntime,
    getOpenCodeAuthHeaders,
    onPayload,
    fetchImpl = fetch,
    upstreamStallTimeoutMs,
    upstreamReconnectDelayMs = 1000,
    globalEventHub = null,
  } = deps;

  let abortController = null;
  let reader = null;
  let unsubscribeEvent = null;
  let unsubscribeStatus = null;

  const unwrapGlobalEventPayload = (eventData) => {
    if (!eventData || typeof eventData !== 'object') {
      return null;
    }

    if (eventData.payload && typeof eventData.payload === 'object') {
      return eventData.payload;
    }

    return eventData;
  };

  const start = async () => {
    if (abortController) {
      return;
    }

    await waitForOpenCodePort();

    abortController = new AbortController();
    const signal = abortController.signal;

    if (globalEventHub) {
      unsubscribeEvent = globalEventHub.subscribeEvent((event) => {
        for (const value of event.translated()) {
          const payload = unwrapGlobalEventPayload(value);
          if (payload) onPayload(payload);
        }
      });
      unsubscribeStatus = globalEventHub.subscribeStatus((status) => {
        if (signal.aborted) {
          return;
        }
        if (status.type === 'connect') {
          console.log('[PushWatcher] connected');
          return;
        }
        if (status.type === 'error' || status.type === 'initial-error') {
          console.warn('[PushWatcher] disconnected', status.error?.error?.message ?? status.error?.message ?? status.error);
        }
      });
      globalEventHub.start();
      return;
    }

    let attached;
    reader = createUpstreamSseReader({
      signal,
      buildUrl: () => {
        attached = getKernelRuntime?.() ?? { generation: 'oc1', endpoint: 'legacy', epoch: 0 };
        if (attached.generation !== 'oc1' && attached.generation !== 'oc2') throw new Error('OpenCode generation unavailable');
        return buildOpenCodeUrl(attached.generation === 'oc2' ? '/api/event' : '/global/event', '');
      },
      getConnectionKey: () => `${attached.endpoint}|${attached.epoch}|${attached.generation}`,
      getHeaders: getOpenCodeAuthHeaders,
      fetchImpl,
      stallTimeoutMs: upstreamStallTimeoutMs,
      reconnectDelayMs: upstreamReconnectDelayMs,
      onConnect() {
        console.log('[PushWatcher] connected');
      },
      onEvent(event) {
        const current = getKernelRuntime?.() ?? attached;
        if (current.endpoint !== attached.endpoint || current.epoch !== attached.epoch || current.generation !== attached.generation) return;
        const payload = unwrapGlobalEventPayload(event.payload);
        for (const value of attached.generation === 'oc2' ? translateWireEvent(payload) : [payload]) {
          if (value) onPayload(value);
        }
      },
      onError(error) {
        if (signal.aborted) {
          return;
        }
        console.warn('[PushWatcher] disconnected', error?.error?.message ?? error?.message ?? error);
      },
    });

    void reader.start();
  };

  const stop = () => {
    if (!abortController) {
      return;
    }
    try {
      abortController.abort();
      reader?.stop();
      unsubscribeEvent?.();
      unsubscribeStatus?.();
    } catch {
    }
    reader = null;
    unsubscribeEvent = null;
    unsubscribeStatus = null;
    abortController = null;
  };

  return {
    start,
    stop,
  };
};
