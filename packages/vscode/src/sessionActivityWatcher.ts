import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import type { OpenCodeEvent } from '@opencode/client';
import { z } from 'zod';
import type { OpenCodeManager } from './opencode';
import { resolveKernelRequest } from './kernelRequest';
import { waitForApiUrl } from './opencode-ready';

// Session activity tracking (mirrors web server and desktop behavior)
type ActivityPhase = 'idle' | 'busy' | 'cooldown';

interface SessionActivity {
  sessionId: string;
  phase: ActivityPhase;
}

const sessionActivityPhases = new Map<string, { phase: ActivityPhase; updatedAt: number }>();
const sessionActivityCooldowns = new Map<string, NodeJS.Timeout>();
const SESSION_COOLDOWN_DURATION_MS = 2000;

let globalEventWatcherAbortController: AbortController | null = null;
let chatViewProvider: { postMessage: (message: unknown) => void } | null = null;
let globalEventWatcherRetryTimer: NodeJS.Timeout | null = null;
let globalEventWatcherStartToken = 0;

const clearGlobalEventWatcherRetry = (): void => {
  if (!globalEventWatcherRetryTimer) {
    return;
  }
  clearTimeout(globalEventWatcherRetryTimer);
  globalEventWatcherRetryTimer = null;
};

const unwrapGlobalEventPayload = (eventData: unknown): Record<string, unknown> | null => {
  if (!eventData || typeof eventData !== 'object') {
    return null;
  }

  const record = eventData as { payload?: unknown };
  if (record.payload && typeof record.payload === 'object') {
    return record.payload as Record<string, unknown>;
  }

  return eventData as Record<string, unknown>;
};

const reconcileSessionActivityFromStatus = async (manager: OpenCodeManager): Promise<void> => {
  const selected = await resolveKernelRequest(manager, '/session/status');
  if (selected.descriptor.generation !== 'oc1') throw new Error('OpenCode 1 status requires OpenCode 1');
  const response = await fetch(selected.url, {
    headers: manager.getOpenCodeAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`session status fetch failed (${response.status})`);
  }

  const statuses = z.record(z.string(), z.object({ type: z.string() })).parse(await response.json());
  selected.assertCurrent();
  const knownSessionIds = new Set(Object.keys(statuses));

  for (const [sessionId, data] of Object.entries(statuses)) {
    const phase: ActivityPhase = data.type === 'busy' || data.type === 'retry' ? 'busy' : 'idle';
    setSessionActivityPhase(sessionId, phase);
  }

  // Drop stale in-memory activity entries not present in authoritative status.
  for (const sessionId of Array.from(sessionActivityPhases.keys())) {
    if (!knownSessionIds.has(sessionId)) {
      setSessionActivityPhase(sessionId, 'idle');
    }
  }
};

const reconcileActiveSessions = async (manager: OpenCodeManager): Promise<void> => {
  const selected = await resolveKernelRequest(manager, '/session/active');
  if (selected.descriptor.generation !== 'oc2') throw new Error('OpenCode 2 active sessions require OpenCode 2');
  const { OpenCode } = await import('@opencode/client');
  const baseUrl = manager.getApiUrl();
  if (!baseUrl) throw new Error('OpenCode API URL not available');
  const client = OpenCode.make({ baseUrl, headers: manager.getOpenCodeAuthHeaders() });
  const active = await client.session.active({ signal: AbortSignal.timeout(8_000) });
  selected.assertCurrent();
  const activeIds = new Set(Object.keys(active));
  for (const sessionId of activeIds) setSessionActivityPhase(sessionId, 'busy');
  for (const sessionId of sessionActivityPhases.keys()) {
    if (!activeIds.has(sessionId)) setSessionActivityPhase(sessionId, 'idle');
  }
};

const setSessionActivityPhase = (sessionId: string, phase: ActivityPhase): void => {
  if (!sessionId) return;

  const existingTimer = sessionActivityCooldowns.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    sessionActivityCooldowns.delete(sessionId);
  }

  const current = sessionActivityPhases.get(sessionId);
  if (current?.phase === phase) return;

  sessionActivityPhases.set(sessionId, { phase, updatedAt: Date.now() });

  chatViewProvider?.postMessage({
    type: 'openchamber:session-activity',
    properties: {
      sessionId,
      phase,
    },
  });

  if (phase === 'cooldown') {
    const timer = setTimeout(() => {
      const now = sessionActivityPhases.get(sessionId);
      if (now?.phase === 'cooldown') {
        sessionActivityPhases.set(sessionId, { phase: 'idle', updatedAt: Date.now() });
        chatViewProvider?.postMessage({
          type: 'openchamber:session-activity',
          properties: {
            sessionId,
            phase: 'idle',
          },
        });
      }
      sessionActivityCooldowns.delete(sessionId);
    }, SESSION_COOLDOWN_DURATION_MS);
    sessionActivityCooldowns.set(sessionId, timer);
  }
};

export const getSessionActivitySnapshot = (): Record<string, { type: ActivityPhase }> => {
  const snapshot: Record<string, { type: ActivityPhase }> = {};
  for (const [sessionId, data] of sessionActivityPhases.entries()) {
    snapshot[sessionId] = { type: data.phase };
  }
  return snapshot;
};

const deriveSessionActivity = (payload: Record<string, unknown>): SessionActivity | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const type = payload.type as string;
  const properties = (payload.properties ?? payload) as Record<string, unknown>;

  if (type === 'session.status') {
    const status = properties?.status as Record<string, unknown> | undefined;
    const info = properties?.info as Record<string, unknown> | undefined;
    const sessionId = (properties?.sessionID ?? properties?.sessionId) as string;
    const statusType = (status?.type ?? info?.type) as string;

    if (typeof sessionId === 'string' && sessionId.length > 0 && typeof statusType === 'string') {
      const phase = statusType === 'busy' || statusType === 'retry' ? 'busy' : 'idle';
      return { sessionId, phase };
    }
  }

  if (type === 'message.updated' || type === 'message.part.updated' || type === 'message.part.delta') {
    const info = properties?.info as Record<string, unknown> | undefined;
    const sessionId = (info?.sessionID ?? info?.sessionId ?? properties?.sessionID ?? properties?.sessionId) as string;
    const role = info?.role as string;
    const finish = info?.finish as string;
    if (typeof sessionId === 'string' && sessionId.length > 0 && role === 'assistant' && finish === 'stop') {
      return { sessionId, phase: 'cooldown' };
    }
  }

  if (type === 'session.idle') {
    const sessionId = (properties?.sessionID ?? properties?.sessionId) as string;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      return { sessionId, phase: 'idle' };
    }
  }

  return null;
};

const deriveV2Activity = (event: OpenCodeEvent): SessionActivity | null => {
  switch (event.type) {
    case 'session.status':
      return { sessionId: event.data.sessionID, phase: event.data.status.type === 'busy' || event.data.status.type === 'retry' ? 'busy' : 'idle' };
    case 'session.execution.started':
      return { sessionId: event.data.sessionID, phase: 'busy' };
    case 'session.execution.succeeded':
      return { sessionId: event.data.sessionID, phase: 'cooldown' };
    case 'session.execution.failed':
    case 'session.execution.interrupted':
    case 'session.idle':
      return { sessionId: event.data.sessionID, phase: 'idle' };
    default:
      return null;
  }
};

export const startGlobalEventWatcher = async (
  manager: OpenCodeManager,
  provider: { postMessage: (message: unknown) => void }
): Promise<void> => {
  if (globalEventWatcherAbortController) {
    return;
  }

  const startToken = ++globalEventWatcherStartToken;
  clearGlobalEventWatcherRetry();
  chatViewProvider = provider;

  const apiUrl = await waitForApiUrl(manager);
  if (startToken !== globalEventWatcherStartToken) {
    return;
  }
  if (!apiUrl) {
    console.warn('[VSCode:Activity] OpenCode API unavailable; will retry');
    globalEventWatcherRetryTimer = setTimeout(() => {
      globalEventWatcherRetryTimer = null;
      if (startToken === globalEventWatcherStartToken) {
        void startGlobalEventWatcher(manager, provider);
      }
    }, 2000);
    return;
  }

  globalEventWatcherAbortController = new AbortController();
  const signal = globalEventWatcherAbortController.signal;

  let attempt = 0;
  let activeIdentity = '';

  const run = async (): Promise<void> => {
    while (!signal.aborted) {
      attempt += 1;

      try {
        const baseUrl = manager.getApiUrl();
        if (!baseUrl) {
          throw new Error('OpenCode API URL not available');
        }

        const selected = await resolveKernelRequest(manager, '/event');
        const identity = `${selected.descriptor.generation}:${selected.descriptor.endpoint}:${selected.descriptor.epoch}`;
        if (identity !== activeIdentity) {
          for (const sessionId of sessionActivityPhases.keys()) setSessionActivityPhase(sessionId, 'idle');
          activeIdentity = identity;
        }
        try {
          if (selected.descriptor.generation === 'oc2') await reconcileActiveSessions(manager);
          else await reconcileSessionActivityFromStatus(manager);
        } catch (error) {
          console.warn(
            '[VSCode:Activity] session status reconcile failed',
            error instanceof Error ? error.message : error,
          );
        }
        if (selected.descriptor.generation === 'oc2') {
          const { OpenCode } = await import('@opencode/client');
          const client = OpenCode.make({ baseUrl, headers: manager.getOpenCodeAuthHeaders() });
          let connected = false;
          for await (const event of client.event.subscribe({ signal })) {
            selected.assertCurrent();
            if (!connected) { connected = true; attempt = 0; console.log('[VSCode:Activity] connected'); }
            const activity = deriveV2Activity(event);
            if (activity) setSessionActivityPhase(activity.sessionId, activity.phase);
            if (signal.aborted) break;
          }
        } else {
          const client = createOpencodeClient({ baseUrl, headers: manager.getOpenCodeAuthHeaders() });
          const result = await client.global.event({ signal, sseMaxRetryAttempts: 0 });
          console.log('[VSCode:Activity] connected');
          attempt = 0;
          for await (const event of result.stream) {
            selected.assertCurrent();
            const payload = unwrapGlobalEventPayload((event as { payload?: unknown }).payload ?? event);
            const activity = payload ? deriveSessionActivity(payload) : null;
            if (activity) setSessionActivityPhase(activity.sessionId, activity.phase);
            if (signal.aborted) break;
          }
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        console.warn('[VSCode:Activity] disconnected', error instanceof Error ? error.message : error);
      }

      const backoffMs = Math.min(1000 * Math.pow(2, Math.min(attempt, 5)), 30000);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  };

  void run();
};

export const stopGlobalEventWatcher = (): void => {
  globalEventWatcherStartToken += 1;
  clearGlobalEventWatcherRetry();

  if (globalEventWatcherAbortController) {
    try {
      globalEventWatcherAbortController.abort();
    } catch {
      // ignore
    }
  }
  globalEventWatcherAbortController = null;
  chatViewProvider = null;

  for (const timer of sessionActivityCooldowns.values()) {
    clearTimeout(timer);
  }
  sessionActivityCooldowns.clear();
  sessionActivityPhases.clear();
};

export const setChatViewProvider = (provider: { postMessage: (message: unknown) => void } | null): void => {
  chatViewProvider = provider;
};
