import { sendMessageStreamWsEvent, sendMessageStreamWsFrame, sendSerializedMessageStreamWsFrame } from './protocol.js';
import { createUpstreamSseReader } from './upstream-reader.js';

export function acceptSharedDirectoryMessageStreamWsConnection({ socket, requestedDirectory, requestedLastEventId, globalHub, wsClients, heartbeatIntervalMs }) {
  let ready = false;
  const matches = (directory) => !requestedDirectory || directory === requestedDirectory;
  const sendReady = (reset = false) => {
    const replay = reset ? null : globalHub.replayAfter(requestedLastEventId);
    const frame = { type: 'ready', scope: 'directory' };
    if (replay === null) frame.replayReset = true;
    if (!sendMessageStreamWsFrame(socket, frame)) return;
    ready = true;
    wsClients.add(socket);
    for (const entry of replay || []) {
      if (matches(entry.directory)) sendSerializedMessageStreamWsFrame(socket, entry.serializedFrame);
    }
  };
  const unsubscribeEvent = globalHub.subscribeEvent((event) => {
    if (ready && matches(event.directory)) sendSerializedMessageStreamWsFrame(socket, event.serialize());
  });
  const unsubscribeStatus = globalHub.subscribeStatus((status) => {
    if (status.type === 'identity-change' && ready) sendReady(true);
    else if (status.type === 'connect' && !ready) sendReady();
    else if (status.type === 'connect' && status.wasReady) sendMessageStreamWsFrame(socket, { type: 'ready', scope: 'directory' });
  });
  const ping = setInterval(() => { if (socket.readyState === 1) socket.ping(); }, heartbeatIntervalMs);
  socket.on('close', () => {
    clearInterval(ping);
    unsubscribeEvent();
    unsubscribeStatus();
    wsClients.delete(socket);
  });
  globalHub.start();
  if (globalHub.isConnected()) sendReady();
}

function shouldTriggerUpstreamHealthCheck(upstream) {
  if (!upstream) {
    return true;
  }

  if (!upstream.body) {
    return upstream.ok || upstream.status >= 500;
  }

  return upstream.status >= 500;
}

export function acceptDirectoryMessageStreamWsConnection({
  socket,
  requestedLastEventId,
  requestedDirectory,
  buildOpenCodeUrl,
  getKernelRuntime,
  getOpenCodeAuthHeaders,
  processForwardedEventPayload,
  wsClients,
  triggerHealthCheck,
  heartbeatIntervalMs,
  upstreamStallTimeoutMs,
  upstreamReconnectDelayMs,
  fetchImpl,
}) {
  const controller = new AbortController();
  let upstreamConnected = false;
  let streamReady = false;
  let reader = null;
  const generation = getKernelRuntime?.() ?? { generation: 'oc1', endpoint: 'legacy', epoch: 0 };

  const cleanup = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
    reader?.stop();
    wsClients.delete(socket);
  };

  const pingInterval = setInterval(() => {
    if (socket.readyState !== 1) {
      return;
    }

    try {
      socket.ping();
    } catch {
    }
  }, heartbeatIntervalMs);

  const heartbeatInterval = setInterval(() => {
    if (!upstreamConnected) {
      return;
    }

    sendMessageStreamWsEvent(socket, { type: 'openchamber:heartbeat', timestamp: Date.now() }, { directory: 'global' });
  }, heartbeatIntervalMs);

  socket.on('close', () => {
    clearInterval(pingInterval);
    clearInterval(heartbeatInterval);
    upstreamConnected = false;
    cleanup();
  });

  socket.on('error', () => {
    void 0;
  });

  const run = async () => {
    const forwardEvent = ({ envelope, payload }) => {
      const directory = requestedDirectory || envelope?.directory || 'global';

      sendMessageStreamWsEvent(socket, payload, {
        directory,
        eventId: typeof envelope?.eventId === 'string' && envelope.eventId.length > 0 ? envelope.eventId : undefined,
      });

      processForwardedEventPayload(payload, (syntheticPayload) => {
        sendMessageStreamWsEvent(socket, syntheticPayload, { directory: 'global' });
      });
    };

    try {
      let buildUrlFailed = false;
      const closeWithInitialError = ({ message, closeReason = message, triggerHealthCheckFor = null }) => {
        sendMessageStreamWsFrame(socket, { type: 'error', message });
        socket.close(1011, closeReason);
        if (triggerHealthCheckFor === true || (triggerHealthCheckFor && shouldTriggerUpstreamHealthCheck(triggerHealthCheckFor))) {
          triggerHealthCheck?.();
        }
        reader?.stop();
        cleanup();
      };

      reader = createUpstreamSseReader({
        initialLastEventId: requestedLastEventId,
        signal: controller.signal,
        stallTimeoutMs: upstreamStallTimeoutMs,
        reconnectDelayMs: upstreamReconnectDelayMs,
        fetchImpl,
        buildUrl: () => {
          buildUrlFailed = false;
          let targetUrl;
          try {
            if (generation.generation !== 'oc1') throw new Error('OpenCode generation unavailable');
            targetUrl = new URL(buildOpenCodeUrl('/event', ''));
          } catch {
            buildUrlFailed = true;
            throw new Error('OpenCode service unavailable');
          }

          if (requestedDirectory) {
            targetUrl.searchParams.set('directory', requestedDirectory);
          }

          return targetUrl;
        },
        getHeaders: getOpenCodeAuthHeaders,
        getConnectionKey: () => `${generation.endpoint}|${generation.epoch}|${generation.generation}`,
        onConnect() {
          if (!streamReady) {
            sendMessageStreamWsFrame(socket, {
              type: 'ready',
              scope: 'directory',
            });
            streamReady = true;
          }

          upstreamConnected = true;
        },
        onDisconnect() {
          upstreamConnected = false;
        },
        onEvent: forwardEvent,
        onError(error) {
          if (controller.signal.aborted) {
            return;
          }

          if (!streamReady) {
            if (error?.type === 'upstream_unavailable') {
              closeWithInitialError({
                message: `OpenCode event stream unavailable (${error.status})`,
                closeReason: 'OpenCode event stream unavailable',
                triggerHealthCheckFor: error.response,
              });
              return;
            }

            closeWithInitialError({
              message: buildUrlFailed ? 'OpenCode service unavailable' : 'Failed to connect to OpenCode event stream',
              closeReason: buildUrlFailed ? 'OpenCode service unavailable' : 'Failed to connect to OpenCode event stream',
              triggerHealthCheckFor: !buildUrlFailed,
            });
            return;
          }

          if (error?.type === 'stream_error') {
            console.warn('Message stream WS proxy error:', error.error);
          }
        },
      });

      await reader.start();
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn('Message stream WS proxy error:', error);
        sendMessageStreamWsFrame(socket, { type: 'error', message: 'Message stream proxy error' });
        socket.close(1011, 'Message stream proxy error');
      }
    } finally {
      cleanup();
      try {
        if (socket.readyState === 1 || socket.readyState === 0) {
          socket.close();
        }
      } catch {
      }
    }
  };

  void run();
}
