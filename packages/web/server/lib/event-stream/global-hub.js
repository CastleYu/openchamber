import { randomUUID } from 'node:crypto';

import { createUpstreamSseReader } from './upstream-reader.js';
import { serializeMessageStreamWsEvent } from './protocol.js';
import { createDeltaCoalescer, DELTA_COALESCE_WINDOW_MS } from './delta-coalescer.js';
import { translateWireEvent } from './translate-v2.js';

// Raised from 512 → 2048 to improve recovery after brief disconnects during
// long-running agent sessions where many events accumulate quickly.
const MESSAGE_STREAM_GLOBAL_REPLAY_LIMIT = 2048;
const MESSAGE_STREAM_GLOBAL_REPLAY_BYTES = 8 * 1024 * 1024;

export function createGlobalMessageStreamHub({
  buildOpenCodeUrl,
  getKernelRuntime,
  getOpenCodeAuthHeaders,
  fetchImpl = fetch,
  upstreamStallTimeoutMs,
  upstreamReconnectDelayMs,
  replayLimit = MESSAGE_STREAM_GLOBAL_REPLAY_LIMIT,
  replayByteLimit = MESSAGE_STREAM_GLOBAL_REPLAY_BYTES,
  deltaCoalesceWindowMs = DELTA_COALESCE_WINDOW_MS,
}) {
  if (!Number.isSafeInteger(replayLimit) || replayLimit < 0 || !Number.isSafeInteger(replayByteLimit) || replayByteLimit < 0) {
    throw new RangeError('Replay limits must be nonnegative safe integers');
  }
  const eventSubscribers = new Set();
  const statusSubscribers = new Set();
  const replay = [];
  let replayBytes = 0;
  let latestEventId;
  // OpenCode's event stream carries no SSE ids (verified on 1.18.30: not one
  // frame in a full response), and an event without an id never entered the
  // replay buffer, so a reconnecting browser had no cursor and every event in
  // the gap was gone. The replay log is this hub's own, so the hub numbers
  // what upstream leaves unnumbered. The per-process prefix makes a cursor
  // from before a restart miss instead of matching an unrelated sequence
  // number, which reports `replayReset` and sends the client to repair.
  const replayIdPrefix = `oc-${randomUUID().slice(0, 8)}-`;
  let replaySequence = 0;

  let controller = null;
  let reader = null;
  let connected = false;
  let everConnected = false;
  let buildUrlFailed = false;
  let connectionKey;
  let attached;
  const descriptor = () => getKernelRuntime?.() ?? { generation: 'oc1', endpoint: 'legacy', epoch: 0 };
  const keyOf = (value) => `${value.endpoint}|${value.generation}|${value.epoch}`;

  const notifySubscriber = (kind, subscriber, payload) => {
    try {
      const result = subscriber(payload);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => {
          console.warn(`Global message stream ${kind} subscriber failed:`, error);
        });
      }
    } catch (error) {
      console.warn(`Global message stream ${kind} subscriber failed:`, error);
    }
  };

  const notifyStatus = (status) => {
    for (const subscriber of Array.from(statusSubscribers)) {
      notifySubscriber('status', subscriber, status);
    }
  };

  const normalizeEvent = ({ envelope, payload }) => {
    const directory =
      typeof envelope?.directory === 'string' && envelope.directory.length > 0 ? envelope.directory : 'global';
    const eventId = typeof envelope?.eventId === 'string' && envelope.eventId.length > 0
      ? envelope.eventId
      : `${replayIdPrefix}${String(++replaySequence).padStart(12, '0')}`;
    let serializedFrame;
    let translated;
    const generation = attached?.generation;
    return {
      envelope,
      payload,
      directory,
      eventId,
      translated() {
        translated ??= generation === 'oc2' ? translateWireEvent(payload) : [payload];
        return translated;
      },
      serialize() {
        serializedFrame ??= serializeMessageStreamWsEvent(payload, { directory, eventId });
        return serializedFrame;
      },
    };
  };

  // Replay and fan-out see the same committed sequence: an event enters the
  // replay buffer in the same step that delivers it, so a client's cursor
  // always names a frame the buffer can find.
  const commitEvent = (event) => {
    // A timer or stop() may flush after the upstream epoch was retired.
    // Same-identity stop still commits pending text for replay continuity.
    if (connectionKey !== keyOf(descriptor())) return;
    const normalized = normalizeEvent(event);
    latestEventId = normalized.eventId;
    const serializedFrame = normalized.serialize();
    const bytes = Buffer.byteLength(serializedFrame);
    if (bytes > replayByteLimit) {
      // An oversized live event creates a hole: retain only a contiguous
      // suffix after it, never replay an older prefix across the gap.
      replay.length = 0;
      replayBytes = 0;
    } else {
      replay.push({ eventId: normalized.eventId, directory: normalized.directory, serializedFrame, bytes });
      replayBytes += bytes;
      while (replay.length > replayLimit || replayBytes > replayByteLimit) {
        replayBytes -= replay.shift().bytes;
      }
    }

    for (const subscriber of Array.from(eventSubscribers)) {
      notifySubscriber('event', subscriber, normalized);
    }
  };

  const coalescer = createDeltaCoalescer({ emit: commitEvent, windowMs: deltaCoalesceWindowMs });

  const start = () => {
    if (reader) {
      return;
    }

    controller = new AbortController();
    const readerController = controller;
    reader = createUpstreamSseReader({
      signal: readerController.signal,
      stallTimeoutMs: upstreamStallTimeoutMs,
      reconnectDelayMs: upstreamReconnectDelayMs,
      fetchImpl,
      buildUrl: () => {
        buildUrlFailed = false;
        try {
          const next = descriptor();
          if (next.generation !== 'oc1' && next.generation !== 'oc2') throw new Error('OpenCode generation unavailable');
          const nextKey = keyOf(next);
          if (connectionKey !== undefined && connectionKey !== nextKey) {
            coalescer.flush();
            replay.length = 0;
            replayBytes = 0;
            latestEventId = undefined;
            notifyStatus({ type: 'identity-change' });
          }
          connectionKey = nextKey;
          attached = next;
          return new URL(buildOpenCodeUrl(next.generation === 'oc2' ? '/api/event' : '/global/event', ''));
        } catch {
          buildUrlFailed = true;
          throw new Error('OpenCode service unavailable');
        }
      },
      getHeaders: getOpenCodeAuthHeaders,
      getConnectionKey: () => connectionKey,
      onConnect() {
        if (controller !== readerController || readerController.signal.aborted) return;
        connected = true;
        const wasReady = everConnected;
        everConnected = true;
        notifyStatus({ type: 'connect', wasReady });
      },
      onDisconnect({ reason }) {
        if (controller !== readerController) return;
        connected = false;
        notifyStatus({ type: 'disconnect', reason });
      },
      onEvent(event) {
        if (controller !== readerController || readerController.signal.aborted) return;
        if (keyOf(descriptor()) !== connectionKey) return;
        coalescer.push(event);
      },
      onError(error) {
        if (controller !== readerController || readerController.signal.aborted) {
          return;
        }

        notifyStatus({
          type: everConnected ? 'error' : 'initial-error',
          error,
          buildUrlFailed,
        });
      },
    });

    void reader.start();
  };

  const stop = () => {
    connected = false;
    // Text that already arrived belongs in the retained replay suffix.
    coalescer.flush();
    reader?.stop();
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    reader = null;
    controller = null;
    everConnected = false;
    buildUrlFailed = false;
  };

  return {
    start,
    stop,
    isConnected() {
      return connected;
    },
    hasConnected() {
      return everConnected;
    },
    subscribeEvent(subscriber) {
      eventSubscribers.add(subscriber);
      return () => {
        eventSubscribers.delete(subscriber);
      };
    },
    subscribeStatus(subscriber) {
      statusSubscribers.add(subscriber);
      return () => {
        statusSubscribers.delete(subscriber);
      };
    },
    // A client that becomes ready must not receive text from before it was
    // ready merged into its first live delta, so the bridge commits pending
    // deltas before it reads the replay tail.
    flushPending() {
      coalescer.flush();
    },
    replayAfter(eventId) {
      if (!eventId) {
        return [];
      }

      if (connectionKey !== keyOf(descriptor())) return null;

      const index = replay.findIndex((entry) => entry.eventId === eventId);
      if (eventId === latestEventId) return [];
      return index === -1 ? null : replay.slice(index + 1);
    },
  };
}
