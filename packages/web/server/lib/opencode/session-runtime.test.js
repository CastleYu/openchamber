import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionRuntime } from './session-runtime.js';

describe('session runtime', () => {
  const runtimes = [];

  afterEach(() => {
    for (const runtime of runtimes) {
      runtime.dispose();
    }
    runtimes.length = 0;
    vi.useRealTimers();
  });

  it('keeps pending permission and question requests until they are answered', () => {
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent: () => {},
    });
    runtimes.push(runtime);
    const permission = { id: 'perm-1', sessionID: 'session-1', permission: 'bash', patterns: ['rm *'], metadata: {}, always: [] };
    const question = { id: 'q-1', sessionID: 'session-2', questions: [{ header: 'Pick', question: 'Which?', options: [] }] };

    runtime.processOpenCodeSsePayload({ type: 'permission.asked', properties: permission });
    runtime.processOpenCodeSsePayload({ type: 'permission.asked', properties: permission });
    runtime.processOpenCodeSsePayload({ type: 'question.asked', properties: question });
    expect(runtime.getPendingBlockingRequestsSnapshot()).toEqual({
      'session-1': { permissions: [permission], questions: [] },
      'session-2': { permissions: [], questions: [question] },
    });

    runtime.processOpenCodeSsePayload({ type: 'permission.replied', properties: { sessionID: 'session-1', requestID: 'perm-1' } });
    runtime.processOpenCodeSsePayload({ type: 'question.rejected', properties: { sessionID: 'session-2' } });
    expect(runtime.getPendingBlockingRequestsSnapshot()).toEqual({});
  });

  it('drops pending requests when the session is deleted or OpenCode restarts', () => {
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent: () => {},
    });
    runtimes.push(runtime);
    const ask = (sessionID, id) => runtime.processOpenCodeSsePayload({
      type: 'permission.asked', properties: { id, sessionID, permission: 'edit', patterns: [], metadata: {}, always: [] },
    });

    ask('session-1', 'perm-1');
    ask('session-2', 'perm-2');
    runtime.processOpenCodeSsePayload({ type: 'session.deleted', properties: { info: { id: 'session-1' } } });
    expect(Object.keys(runtime.getPendingBlockingRequestsSnapshot())).toEqual(['session-2']);

    runtime.interruptBusySessionsAfterRestart();
    expect(runtime.getPendingBlockingRequestsSnapshot()).toEqual({});
  });

  it('clears all cached state on owner change', () => {
    let owner = 'target-a/profile-a/backend-a';
    const runtime = createSessionRuntime({ writeSseEvent() {}, getNotificationClients: () => new Set(), broadcastEvent() {}, getOwner: () => owner });
    runtimes.push(runtime);
    runtime.processOpenCodeSsePayload({ type: 'session.status', properties: { sessionID: 'same', status: { type: 'busy' } } });
    runtime.markUserMessageSent('same');
    runtime.processOpenCodeSsePayload({ type: 'session.status', properties: { sessionID: 'same', status: { type: 'idle' } } });
    runtime.markSessionViewed('same', 'client');
    runtime.processOpenCodeSsePayload({ type: 'permission.asked', properties: { id: 'p', sessionID: 'same', permission: 'edit', patterns: [], metadata: {}, always: [] } });
    runtime.processOpenCodeSsePayload({ type: 'question.asked', properties: { id: 'q', sessionID: 'same', questions: [{ header: 'Pick', question: 'Which?', options: [] }] } });
    owner = 'target-b/profile-b/backend-b';
    expect(runtime.getSessionActivitySnapshot()).toEqual({});
    expect(runtime.getActiveSessionCount()).toBe(0);
    expect(runtime.getSessionStateSnapshot()).toEqual({});
    expect(runtime.getSessionAttentionSnapshot()).toEqual({});
    expect(runtime.getPendingBlockingRequestsSnapshot()).toEqual({});
    expect(runtime.getSessionState('same')).toBeNull();
    expect(runtime.getSessionAttentionState('same')).toBeNull();
  });

  it.each([
    ['configured target', 'target-a', 'target-b'],
    ['profile', 'profile-a', 'profile-b'],
    ['backend revision', 'backend-a', 'backend-b'],
  ])('starts a fresh session for the same ID after changing %s', (_label, before, after) => {
    let owner = before;
    const runtime = createSessionRuntime({ writeSseEvent() {}, getNotificationClients: () => new Set(), broadcastEvent() {}, getOwner: () => owner });
    runtimes.push(runtime);
    runtime.processOpenCodeSsePayload({ type: 'session.status', properties: { sessionID: 'same', status: { type: 'busy', message: 'old' } } });
    runtime.markUserMessageSent('same');
    runtime.processOpenCodeSsePayload({ type: 'permission.asked', properties: { id: 'p', sessionID: 'same', permission: 'edit', patterns: [], metadata: {}, always: [] } });
    owner = after;
    runtime.processOpenCodeSsePayload({ type: 'session.status', properties: { sessionID: 'same', status: { type: 'busy', message: 'new' } } });
    expect(runtime.getSessionState('same')).toEqual(expect.objectContaining({ status: 'busy', metadata: expect.objectContaining({ message: 'new' }) }));
    expect(runtime.getSessionAttentionState('same')).toEqual(expect.objectContaining({ lastUserMessageAt: null, needsAttention: false, isViewed: false }));
    expect(runtime.getPendingBlockingRequestsSnapshot()).toEqual({});
    expect(runtime.getActiveSessionCount()).toBe(1);
  });

  it('cancels an old cooldown before the new owner becomes busy', () => {
    vi.useFakeTimers();
    let owner = 'a';
    const events = [];
    const runtime = createSessionRuntime({ writeSseEvent() {}, getNotificationClients: () => new Set(), broadcastEvent: (event) => events.push(event), getOwner: () => owner });
    runtimes.push(runtime);
    const status = (type) => runtime.processOpenCodeSsePayload({ type: 'session.status', properties: { sessionID: 'same', status: { type } } });
    status('busy');
    status('idle');
    owner = 'b';
    vi.advanceTimersByTime(2000);
    expect(runtime.getSessionActivitySnapshot()).toEqual({});
    expect(runtime.getActiveSessionCount()).toBe(0);
    expect(events.filter((event) => event.type === 'openchamber:session-activity' && event.properties.phase === 'idle')).toHaveLength(0);
  });

  it('preserves same-owner state and interrupts it only once after restart', () => {
    const events = [];
    const runtime = createSessionRuntime({ writeSseEvent() {}, getNotificationClients: () => new Set(), broadcastEvent: (event) => events.push(event), getOwner: () => 'same' });
    runtimes.push(runtime);
    runtime.processOpenCodeSsePayload({ type: 'session.status', properties: { sessionID: 'busy', status: { type: 'busy' } } });
    runtime.processOpenCodeSsePayload({ type: 'permission.asked', properties: { id: 'p', sessionID: 'busy', permission: 'edit', patterns: [], metadata: {}, always: [] } });
    runtime.getSessionActivitySnapshot();
    runtime.getSessionStateSnapshot();
    runtime.getPendingBlockingRequestsSnapshot();
    runtime.processOpenCodeSsePayload({ type: 'session.status', properties: { sessionID: 'other', status: { type: 'idle' } } });
    expect(runtime.getActiveSessionCount()).toBe(1);
    expect(runtime.getPendingBlockingRequestsSnapshot()).toHaveProperty('busy');
    events.length = 0;
    expect(runtime.interruptBusySessionsAfterRestart()).toEqual({ sessionIds: ['busy'] });
    expect(runtime.getPendingBlockingRequestsSnapshot()).toEqual({});
    expect(events.filter((event) => event.type === 'openchamber:session-status' || event.type === 'session.error')).toHaveLength(2);
    expect(runtime.interruptBusySessionsAfterRestart()).toEqual({ sessionIds: [] });
    expect(events.filter((event) => event.type === 'openchamber:session-status' || event.type === 'session.error')).toHaveLength(2);
  });
  it('broadcasts attention clears through the shared broadcaster', () => {
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error('SSE fallback should not be used when broadcastEvent is provided');
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload);
      },
    });
    runtimes.push(runtime);

    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: {
        sessionID: 'session-1',
        status: {
          type: 'busy',
        },
      },
    });
    runtime.markUserMessageSent('session-1');
    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: {
        sessionID: 'session-1',
        status: {
          type: 'idle',
        },
      },
    });
    runtime.markSessionViewed('session-1', 'client-1');

    expect(events).toContainEqual({
      type: 'openchamber:session-status',
      properties: expect.objectContaining({
        sessionID: 'session-1',
        status: 'idle',
        needsAttention: true,
      }),
    });
    expect(events.at(-1)).toEqual({
      type: 'openchamber:session-status',
      properties: {
        sessionID: 'session-1',
        status: 'idle',
        timestamp: expect.any(Number),
        metadata: {},
        needsAttention: false,
      },
    });
  });

  it('accepts legacy session.status info.type payloads', () => {
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error('SSE fallback should not be used when broadcastEvent is provided');
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload);
      },
    });
    runtimes.push(runtime);

    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: {
        sessionID: 'legacy-session-1',
        info: {
          type: 'busy',
        },
      },
    });

    expect(events).toContainEqual({
      type: 'openchamber:session-status',
      properties: expect.objectContaining({
        sessionID: 'legacy-session-1',
        status: 'busy',
      }),
    });
  });

  it('broadcasts idle activity when cooldown expires', () => {
    vi.useFakeTimers();
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error('SSE fallback should not be used when broadcastEvent is provided');
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload);
      },
    });

    try {
      runtime.processOpenCodeSsePayload({
        type: 'session.status',
        properties: {
          sessionID: 'session-activity-1',
          status: {
            type: 'busy',
          },
        },
      });
      runtime.processOpenCodeSsePayload({
        type: 'session.status',
        properties: {
          sessionID: 'session-activity-1',
          status: {
            type: 'idle',
          },
        },
      });

      const activityPhases = () => events
        .filter((event) => event.type === 'openchamber:session-activity')
        .map((event) => event.properties.phase);

      expect(activityPhases()).toEqual(['busy', 'cooldown']);

      vi.advanceTimersByTime(1999);
      expect(activityPhases()).toEqual(['busy', 'cooldown']);

      vi.advanceTimersByTime(1);

      expect(activityPhases()).toEqual(['busy', 'cooldown', 'idle']);
    } finally {
      runtime.dispose();
      vi.useRealTimers();
    }
  });

  it('maintains an idempotent active session count', () => {
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent() {},
    });
    runtimes.push(runtime);
    const status = (sessionID, type) => runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID, status: { type } },
    });

    expect(runtime.getActiveSessionCount()).toBe(0);
    status('session-1', 'busy');
    status('session-1', 'busy');
    status('session-1', 'retry');
    expect(runtime.getActiveSessionCount()).toBe(1);

    status('session-2', 'busy');
    expect(runtime.getActiveSessionCount()).toBe(2);

    status('session-1', 'idle');
    expect(runtime.getActiveSessionCount()).toBe(1);
    status('session-1', 'idle');
    expect(runtime.getActiveSessionCount()).toBe(1);

    runtime.resetAllSessionActivityToIdle();
    expect(runtime.getActiveSessionCount()).toBe(0);
  });

  it('interrupts busy sessions after restart and broadcasts terminal events once', () => {
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent: (event) => events.push(event),
    });
    runtimes.push(runtime);
    const status = (sessionID, type) => runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID, status: { type } },
    });

    status('session-busy-1', 'busy');
    status('session-busy-2', 'retry');
    status('session-busy-3', 'busy');
    status('session-idle', 'idle');
    expect(runtime.getActiveSessionCount()).toBe(3);
    events.length = 0;

    expect(runtime.interruptBusySessionsAfterRestart()).toEqual({
      sessionIds: ['session-busy-1', 'session-busy-2', 'session-busy-3'],
    });

    expect(runtime.getActiveSessionCount()).toBe(0);
    expect(runtime.getSessionActivitySnapshot()).toEqual({
      'session-busy-1': { type: 'idle' },
      'session-busy-2': { type: 'idle' },
      'session-busy-3': { type: 'idle' },
      'session-idle': { type: 'idle' },
    });
    expect(runtime.getSessionStateSnapshot()).toEqual({
      'session-busy-1': expect.objectContaining({
        status: 'idle',
        metadata: expect.objectContaining({
          message: 'Interrupted by OpenCode restart',
          reason: 'opencode-restart',
        }),
      }),
      'session-busy-2': expect.objectContaining({ status: 'idle' }),
      'session-busy-3': expect.objectContaining({ status: 'idle' }),
      'session-idle': expect.objectContaining({ status: 'idle' }),
    });

    const terminalEvents = events.filter((event) => (
      event.type === 'openchamber:session-status' || event.type === 'session.error'
    ));
    expect(terminalEvents).toHaveLength(6);
    for (const sessionId of ['session-busy-1', 'session-busy-2', 'session-busy-3']) {
      expect(terminalEvents).toContainEqual({
        type: 'openchamber:session-status',
        properties: expect.objectContaining({
          sessionID: sessionId,
          status: 'idle',
        }),
      });
      expect(terminalEvents).toContainEqual({
        type: 'session.error',
        properties: {
          sessionID: sessionId,
          error: {
            name: 'MessageAbortedError',
            message: 'The running turn was interrupted when OpenCode restarted.',
          },
        },
      });
    }
    expect(terminalEvents.some((event) => event.properties.sessionID === 'session-idle')).toBe(false);

    events.length = 0;
    expect(runtime.interruptBusySessionsAfterRestart()).toEqual({ sessionIds: [] });
    expect(events).toEqual([]);
  });

  it('restores activity when busy interrupts cooldown without timer underflow', () => {
    vi.useFakeTimers();
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent() {},
    });
    const status = (type) => runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type } },
    });

    try {
      status('busy');
      status('idle');
      expect(runtime.getActiveSessionCount()).toBe(0);

      status('retry');
      expect(runtime.getActiveSessionCount()).toBe(1);
      vi.advanceTimersByTime(2000);

      expect(runtime.getActiveSessionCount()).toBe(1);
      expect(runtime.getSessionActivitySnapshot()['session-1']).toEqual({ type: 'busy' });
    } finally {
      runtime.dispose();
      vi.useRealTimers();
    }
  });

  it('releases retained session state when disposed', () => {
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent() {},
    });
    runtimes.push(runtime);

    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'busy' } },
    });
    runtime.markUserMessageSent('session-1');
    runtime.dispose();

    expect(runtime.getActiveSessionCount()).toBe(0);
    expect(runtime.getSessionActivitySnapshot()).toEqual({});
    expect(runtime.getSessionStateSnapshot()).toEqual({});
    expect(runtime.getSessionAttentionSnapshot()).toEqual({});
  });
});
