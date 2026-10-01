import { describe, expect, it, vi } from 'vitest';

import { createNotificationTriggerRuntime } from './runtime.js';

const setup = (enterpriseMode) => {
  const sendPushToAllUiSessions = vi.fn(async () => {});
  const sendApnsToAllUiSessions = vi.fn(async () => {});
  const getIsSessionAutoAccepting = vi.fn(async () => false);
  const runtime = createNotificationTriggerRuntime({
    isEnterpriseMode: () => enterpriseMode,
    kernelOperations: { getSession: async () => ({ data: { id: 'session', title: 'Private session' } }) },
    readSettingsFromDisk: async () => ({ notificationMode: 'always' }),
    sendPushToAllUiSessions,
    sendApnsToAllUiSessions,
    isAnyInteractiveClientVisible: () => false,
    getIsSessionAutoAccepting,
  });
  return { runtime, sendPushToAllUiSessions, sendApnsToAllUiSessions, getIsSessionAutoAccepting };
};

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
