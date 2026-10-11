import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNotificationTriggerRuntime } from './runtime.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const setup = (enterpriseMode, overrides = {}) => {
  const sendPushToAllUiSessions = vi.fn(async () => {});
  const sendApnsToAllUiSessions = vi.fn(async () => {});
  const getIsSessionAutoAccepting = vi.fn(async () => false);
  const emitDesktopNotification = vi.fn(() => true);
  const broadcastUiNotification = vi.fn();
  const readSettingsFromDisk = vi.fn(async () => ({
    notificationMode: 'always',
    nativeNotificationsEnabled: true,
    ...overrides.settings,
  }));
  const buildTemplateVariables = vi.fn(async () => ({ session_name: 'Session name' }));
  const runtime = createNotificationTriggerRuntime({
    isEnterpriseMode: () => enterpriseMode,
    kernelOperations: {
      captureIdentity: () => ({ endpoint: 'test-endpoint', epoch: 0 }),
      getSession: async () => ({ data: { id: 'session', title: 'Private session', parentID: null } }),
      ...overrides.kernelOperations,
    },
    readSettingsFromDisk,
    buildTemplateVariables,
    extractLastMessageText: () => 'Private result',
    fetchLastAssistantMessageText: async () => 'Private result',
    prepareNotificationLastMessage: async ({ message }) => message,
    resolveNotificationTemplate: (template, variables) => template.replace('{last_message}', variables.last_message ?? ''),
    shouldApplyResolvedTemplateMessage: () => true,
    emitDesktopNotification,
    broadcastUiNotification,
    sendPushToAllUiSessions,
    sendApnsToAllUiSessions,
    isAnyInteractiveClientVisible: () => false,
    getIsSessionAutoAccepting,
    ...overrides.dependencies,
  });
  return {
    runtime,
    sendPushToAllUiSessions,
    sendApnsToAllUiSessions,
    getIsSessionAutoAccepting,
    emitDesktopNotification,
    broadcastUiNotification,
    readSettingsFromDisk,
    buildTemplateVariables,
  };
};

const messageTrigger = (finish) => ({
  type: 'message.updated',
  properties: { info: { sessionID: 'session', role: 'assistant', finish, id: `message-${finish}`, parts: [{ type: 'text', text: 'Private result' }] } },
});

afterEach(() => {
  vi.useRealTimers();
});

describe('notification boundary', () => {
  it('strips session and message text from both push channels in enterprise mode', async () => {
    const { runtime, sendPushToAllUiSessions, sendApnsToAllUiSessions } = setup(true);
    await runtime.sendGoalSettlePush({ sessionId: 'session', directory: '/project', status: 'complete', title: 'Private goal', body: 'Private result' });
    expect(sendPushToAllUiSessions.mock.calls[0][0]).toMatchObject({ title: 'Goal complete', body: '', data: { sessionId: 'session', type: 'goal_complete' } });
    expect(sendPushToAllUiSessions.mock.calls[0][0].data).not.toHaveProperty('sessionName');
    expect(sendApnsToAllUiSessions.mock.calls[0][0]).toMatchObject({ title: 'Goal complete', body: '' });
  });

  it('keeps the ordinary notification content outside enterprise mode', async () => {
    const { runtime, sendPushToAllUiSessions, sendApnsToAllUiSessions } = setup(false);
    await runtime.sendGoalSettlePush({ sessionId: 'session', directory: '/project', status: 'complete', title: 'Private goal', body: 'Private result' });
    expect(sendPushToAllUiSessions.mock.calls[0][0]).toMatchObject({ title: 'Private goal', body: 'Private result', data: { sessionName: 'Private session' } });
    expect(sendApnsToAllUiSessions.mock.calls[0][0]).toMatchObject({ body: 'Private session' });
  });

  it('checks the actual permission request before suppressing its notice', async () => {
    const { runtime, getIsSessionAutoAccepting } = setup(false);
    getIsSessionAutoAccepting.mockResolvedValue(true);
    await runtime.maybeSendPushForTrigger({ type: 'permission.asked', properties: { sessionID: 'session', id: 'permission-1', permission: 'edit' } });
    expect(getIsSessionAutoAccepting).toHaveBeenCalledWith('session', undefined, 'permission-1');
  });
});

describe('notification owner isolation', () => {
  it.each(['question.asked', 'permission.asked'])('drops a queued %s notice after the owner changes', async (type) => {
    vi.useFakeTimers();
    let owner = 'owner-A';
    const mocks = setup(false, { dependencies: { getOwner: () => owner } });
    const properties = type === 'question.asked'
      ? { sessionID: 'session', questions: [{ header: 'Question', question: 'Continue?' }] }
      : { sessionID: 'session', id: 'permission-1', permission: 'edit' };

    await mocks.runtime.maybeSendPushForTrigger({ type, properties });
    owner = 'owner-B';
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.emitDesktopNotification).not.toHaveBeenCalled();
    expect(mocks.broadcastUiNotification).not.toHaveBeenCalled();
    expect(mocks.sendPushToAllUiSessions).not.toHaveBeenCalled();
    expect(mocks.sendApnsToAllUiSessions).not.toHaveBeenCalled();
  });

  it.each(['stop', 'error'])('drops a deferred %s template read after the owner changes', async (finish) => {
    const templateRead = deferred();
    let owner = 'owner-A';
    const mocks = setup(false, { dependencies: { getOwner: () => owner } });
    mocks.buildTemplateVariables.mockImplementation(() => templateRead.promise);

    const processing = mocks.runtime.maybeSendPushForTrigger(messageTrigger(finish));
    await vi.waitFor(() => expect(mocks.buildTemplateVariables).toHaveBeenCalled());
    owner = 'owner-B';
    templateRead.resolve({ session_name: 'Old owner session' });
    await processing;

    expect(mocks.emitDesktopNotification).not.toHaveBeenCalled();
    expect(mocks.broadcastUiNotification).not.toHaveBeenCalled();
    expect(mocks.sendPushToAllUiSessions).not.toHaveBeenCalled();
    expect(mocks.sendApnsToAllUiSessions).not.toHaveBeenCalled();
  });

  it.each([
    ['a successful goal lookup', async (request) => request.resolve({ data: { id: 'session', metadata: { openchamber: { goal: { status: 'complete' } } } } })],
    ['a failed goal lookup', async (request) => request.reject(new Error('old owner lookup failed'))],
  ])('does not send a ready fallback after %s completes under another owner', async (_label, settleLookup) => {
    const lookup = deferred();
    let owner = 'owner-A';
    const getSession = vi.fn(() => lookup.promise);
    const mocks = setup(false, {
      dependencies: { getOwner: () => owner },
      kernelOperations: { getSession },
    });

    const processing = mocks.runtime.maybeSendPushForTrigger(messageTrigger('stop'));
    await vi.waitFor(() => expect(getSession).toHaveBeenCalled());
    owner = 'owner-B';
    await settleLookup(lookup);
    await processing;

    expect(mocks.emitDesktopNotification).not.toHaveBeenCalled();
    expect(mocks.broadcastUiNotification).not.toHaveBeenCalled();
    expect(mocks.sendPushToAllUiSessions).not.toHaveBeenCalled();
    expect(mocks.sendApnsToAllUiSessions).not.toHaveBeenCalled();
  });

  it.each([false, true])('drops a direct goal notice after a retired lookup, rejection=%s', async (reject) => {
    const lookup = deferred();
    let owner = 'owner-A';
    const mocks = setup(false, {
      dependencies: { getOwner: () => owner },
      kernelOperations: { getSession: () => lookup.promise },
    });
    const processing = mocks.runtime.sendGoalSettlePush({ sessionId: 'session', status: 'complete', title: 'Old goal', body: 'Old result' });
    owner = 'owner-B';
    if (reject) lookup.reject(new Error('retired lookup'));
    else lookup.resolve({ data: { title: 'Old session' } });
    await processing;
    expect(mocks.sendPushToAllUiSessions).not.toHaveBeenCalled();
    expect(mocks.sendApnsToAllUiSessions).not.toHaveBeenCalled();
  });

  it('does not cache a retired parent result under the new owner', async () => {
    const lookup = deferred();
    let owner = 'owner-A';
    const getSession = vi.fn().mockImplementationOnce(() => lookup.promise)
      .mockResolvedValue({ data: { id: 'session', parentID: null } });
    const mocks = setup(false, {
      settings: { notifyOnSubtasks: false },
      dependencies: { getOwner: () => owner },
      kernelOperations: { getSession },
    });
    const processing = mocks.runtime.maybeSendPushForTrigger(messageTrigger('stop'));
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    owner = 'owner-B';
    lookup.resolve({ data: { id: 'session', parentID: 'old-parent' } });
    await processing;
    await mocks.runtime.maybeSendPushForTrigger(messageTrigger('stop'));
    expect(mocks.emitDesktopNotification.mock.calls.filter(([notice]) => notice.kind === 'ready')).toHaveLength(1);
  });

  it('keeps permission deduplication and ready cooldown independent between owners', async () => {
    vi.useFakeTimers();
    let owner = 'owner-A';
    const mocks = setup(false, { dependencies: { getOwner: () => owner } });

    await mocks.runtime.maybeSendPushForTrigger(messageTrigger('stop'));
    await mocks.runtime.maybeSendPushForTrigger({ type: 'permission.asked', properties: { sessionID: 'session', id: 'permission-1', permission: 'edit' } });
    await vi.advanceTimersByTimeAsync(500);

    owner = 'owner-B';
    await mocks.runtime.maybeSendPushForTrigger(messageTrigger('stop'));
    await mocks.runtime.maybeSendPushForTrigger({ type: 'permission.asked', properties: { sessionID: 'session', id: 'permission-1', permission: 'edit' } });
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.emitDesktopNotification.mock.calls.filter(([notice]) => notice.kind === 'ready')).toHaveLength(2);
    expect(mocks.emitDesktopNotification.mock.calls.filter(([notice]) => notice.kind === 'permission')).toHaveLength(2);
  });

  it('does not carry auto-accept suppression from one owner to another', async () => {
    vi.useFakeTimers();
    let owner = 'owner-A';
    const mocks = setup(false, { dependencies: { getOwner: () => owner } });
    mocks.getIsSessionAutoAccepting.mockImplementation(async () => owner === 'owner-A');
    const request = { type: 'permission.asked', properties: { sessionID: 'session', id: 'permission-1', permission: 'edit' } };

    await mocks.runtime.maybeSendPushForTrigger(request);
    owner = 'owner-B';
    await mocks.runtime.maybeSendPushForTrigger(request);
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.emitDesktopNotification.mock.calls.filter(([notice]) => notice.kind === 'permission')).toHaveLength(1);
  });

  it('preserves same-owner debounce and duplicate suppression', async () => {
    vi.useFakeTimers();
    const mocks = setup(false, { dependencies: { getOwner: () => 'owner-A' } });

    await mocks.runtime.maybeSendPushForTrigger({ type: 'question.asked', properties: { sessionID: 'session', questions: [{ header: 'First', question: 'First question?' }] } });
    await vi.advanceTimersByTimeAsync(250);
    await mocks.runtime.maybeSendPushForTrigger({ type: 'question.asked', properties: { sessionID: 'session', questions: [{ header: 'Second', question: 'Second question?' }] } });
    await vi.advanceTimersByTimeAsync(500);
    const request = { type: 'permission.asked', properties: { sessionID: 'session', id: 'permission-1', permission: 'edit' } };
    await mocks.runtime.maybeSendPushForTrigger(request);
    await vi.advanceTimersByTimeAsync(500);
    await mocks.runtime.maybeSendPushForTrigger(request);
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.emitDesktopNotification.mock.calls.filter(([notice]) => notice.kind === 'question')).toHaveLength(1);
    expect(mocks.emitDesktopNotification.mock.calls.filter(([notice]) => notice.kind === 'permission')).toHaveLength(1);
  });

  it('drops effects when the owner is unavailable', async () => {
    vi.useFakeTimers();
    const mocks = setup(false, { dependencies: { getOwner: () => undefined } });

    await mocks.runtime.maybeSendPushForTrigger(messageTrigger('stop'));
    await mocks.runtime.maybeSendPushForTrigger({ type: 'question.asked', properties: { sessionID: 'session', questions: [{ header: 'Question', question: 'Continue?' }] } });
    await mocks.runtime.maybeSendPushForTrigger({ type: 'permission.asked', properties: { sessionID: 'session', id: 'permission-1', permission: 'edit' } });
    await vi.runAllTimersAsync();

    expect(mocks.readSettingsFromDisk).not.toHaveBeenCalled();
    expect(mocks.emitDesktopNotification).not.toHaveBeenCalled();
    expect(mocks.broadcastUiNotification).not.toHaveBeenCalled();
    expect(mocks.sendPushToAllUiSessions).not.toHaveBeenCalled();
    expect(mocks.sendApnsToAllUiSessions).not.toHaveBeenCalled();
  });
});
