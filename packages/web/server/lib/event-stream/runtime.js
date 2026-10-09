import { WebSocketServer } from 'ws';

import { parseRequestPathname } from '../terminal/terminal-ws-protocol.js';
import {
  MESSAGE_STREAM_DIRECTORY_WS_PATH,
  MESSAGE_STREAM_GLOBAL_WS_PATH,
  MESSAGE_STREAM_WS_HEARTBEAT_INTERVAL_MS,
  serializeMessageStreamWsEvent,
  sendSerializedMessageStreamWsFrame,
} from './protocol.js';
import { createGlobalMessageStreamHub } from './global-hub.js';
import { createGlobalMessageStreamWsBridge } from './global-ws-bridge.js';
import { acceptDirectoryMessageStreamWsConnection, acceptSharedDirectoryMessageStreamWsConnection } from './directory-ws-bridge.js';
import {
  DEFAULT_UPSTREAM_RECONNECT_DELAY_MS,
  DEFAULT_UPSTREAM_STALL_TIMEOUT_MS,
} from './upstream-reader.js';

export function createGlobalUiEventBroadcaster({
  sseClients,
  wsClients,
  writeSseEvent,
}) {
  return (payload, options = {}) => {
    const hasSseClients = sseClients.size > 0;
    const hasWsClients = wsClients.size > 0;
    if (!hasSseClients && !hasWsClients) {
      return;
    }

    if (hasSseClients) {
      const serializedPayload = JSON.stringify(payload);
      for (const res of sseClients) {
        try {
          writeSseEvent(res, payload, serializedPayload);
        } catch {
        }
      }
    }

    if (hasWsClients) {
      const serializedFrame = serializeMessageStreamWsEvent(payload, {
        directory: typeof options.directory === 'string' && options.directory.length > 0 ? options.directory : 'global',
        eventId: typeof options.eventId === 'string' && options.eventId.length > 0 ? options.eventId : undefined,
      });
      for (const socket of Array.from(wsClients)) {
        const sent = sendSerializedMessageStreamWsFrame(socket, serializedFrame);
        if (!sent) {
          wsClients.delete(socket);
        }
      }
    }
  };
}

export function createMessageStreamWsRuntime({
  server,
  uiAuthController,
  isRequestOriginAllowed,
  rejectWebSocketUpgrade,
  buildOpenCodeUrl,
  getKernelRuntime,
  getOpenCodeAuthHeaders,
  processForwardedEventPayload,
  wsClients,
  triggerHealthCheck,
  heartbeatIntervalMs = MESSAGE_STREAM_WS_HEARTBEAT_INTERVAL_MS,
  upstreamStallTimeoutMs = DEFAULT_UPSTREAM_STALL_TIMEOUT_MS,
  upstreamReconnectDelayMs = DEFAULT_UPSTREAM_RECONNECT_DELAY_MS,
  fetchImpl = fetch,
  globalEventHub = null,
}) {
  const wsServer = new WebSocketServer({
    noServer: true,
  });

  const ownsGlobalHub = !globalEventHub;
  const globalHub = globalEventHub ?? createGlobalMessageStreamHub({
    buildOpenCodeUrl,
    getKernelRuntime,
    getOpenCodeAuthHeaders,
    fetchImpl,
    upstreamStallTimeoutMs,
    upstreamReconnectDelayMs,
  });

  const globalBridge = createGlobalMessageStreamWsBridge({
    globalHub,
    ownsGlobalHub,
    wsClients,
    processForwardedEventPayload,
    triggerHealthCheck,
    heartbeatIntervalMs,
  });

  wsServer.on('connection', (socket, req) => {
    const rawUrl = typeof req?.url === 'string' ? req.url : MESSAGE_STREAM_GLOBAL_WS_PATH;
    const pathname = parseRequestPathname(rawUrl);
    const requestUrl = new URL(rawUrl, 'http://127.0.0.1');
    const isGlobalStream = pathname === MESSAGE_STREAM_GLOBAL_WS_PATH;
    const requestedLastEventId = requestUrl.searchParams.get('lastEventId')?.trim() || '';
    const requestedDirectory = requestUrl.searchParams.get('directory')?.trim() || '';

    if (isGlobalStream) {
      globalBridge.accept(socket, {
        requestedLastEventId,
      });
      return;
    }

    if (getKernelRuntime?.()?.generation === 'oc2') {
      acceptSharedDirectoryMessageStreamWsConnection({ socket, requestedDirectory, requestedLastEventId, globalHub, wsClients, heartbeatIntervalMs });
      return;
    }
    if (getKernelRuntime && getKernelRuntime()?.generation !== 'oc1') {
      socket.close(1013, 'OpenCode generation unavailable');
      return;
    }

    acceptDirectoryMessageStreamWsConnection({
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
    });
  });

  const upgradeHandler = (req, socket, head) => {
    const pathname = parseRequestPathname(req.url);
    if (pathname !== MESSAGE_STREAM_GLOBAL_WS_PATH && pathname !== MESSAGE_STREAM_DIRECTORY_WS_PATH) {
      return;
    }

    const handleUpgrade = async () => {
      try {
        if (uiAuthController?.enabled) {
          const sessionToken = await uiAuthController?.ensureSessionToken?.(req, null);
          if (!sessionToken) {
            rejectWebSocketUpgrade(socket, 401, 'UI authentication required');
            return;
          }

          const originAllowed = await isRequestOriginAllowed(req);
          if (!originAllowed) {
            rejectWebSocketUpgrade(socket, 403, 'Invalid origin');
            return;
          }
        }

        wsServer.handleUpgrade(req, socket, head, (ws) => {
          wsServer.emit('connection', ws, req);
        });
      } catch {
        rejectWebSocketUpgrade(socket, 500, 'Upgrade failed');
      }
    };

    void handleUpgrade();
  };

  server.on('upgrade', upgradeHandler);

  return {
    wsServer,
    /**
     * Rebind all upstream readers to the current OpenCode port. Called after
     * a managed process restart: the restart can land on a NEW port while
     * the old process (or an orphaned survivor of it) still holds the
     * previous one, and a healthy-but-pinned SSE connection never notices —
     * so the UI would stop receiving events until the app restarts (#2638).
     * Restarting the shared hub re-dials `buildOpenCodeUrl` (which reads the
     * current port) on its next attempt. Close every client socket so its
     * next attempt verifies the new descriptor before accepting events.
     */
    rebindUpstream() {
      globalHub.stop();
      globalHub.start();
      for (const socket of Array.from(wsServer.clients)) {
        try {
          socket.close(1012, 'OpenCode upstream restarted');
        } catch {
        }
      }
    },
    async close() {
      server.off('upgrade', upgradeHandler);
      globalBridge.close();

      try {
        for (const client of wsServer.clients) {
          try {
            client.terminate();
          } catch {
          }
        }

        await new Promise((resolve) => {
          wsServer.close(() => resolve());
        });
      } catch {
      } finally {
        wsClients.clear();
      }
    },
  };
}
