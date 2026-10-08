import { describe, expect, it, vi } from 'vitest';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_OPERATION, AGENT_SUPPORT } from './constants.js';
import { AgentDispatchError, createAgentDispatcher } from './dispatcher.js';

const identity = () => ({
  family: AGENT_FAMILY.OPENCODE, connectionID: 'connection-1', epoch: 1,
  adapterRevision: 'adapter-1', capabilityRevision: 'capability-1',
});

const binding = (overrides = {}) => {
  const id = identity();
  const handler = vi.fn(async (input) => ({ id: input.sessionID, workspaceID: input.workspaceID }));
  return {
    identity: id,
    ready: true,
    authorized: true,
    capabilities: { [AGENT_OPERATION.GET_SESSION]: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['evidence-1'] } },
    acceptance: { adapterRevision: id.adapterRevision, capabilityRevision: id.capabilityRevision,
      operations: [AGENT_OPERATION.GET_SESSION] },
    handlers: { [AGENT_OPERATION.GET_SESSION]: handler },
    ...overrides,
    handler,
  };
};

const errorCode = async (promise, code) => {
  await expect(promise).rejects.toMatchObject({ code });
};

describe('agent dispatcher', () => {
  it.each([AGENT_SUPPORT.SUPPORTED, AGENT_SUPPORT.ADAPTED])('dispatches %s capability', async (state) => {
    const current = binding();
    current.capabilities[AGENT_OPERATION.GET_SESSION].state = state;
    const dispatcher = createAgentDispatcher({ getBinding: () => current });
    const result = await dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }, identity());
    expect(result.data).toEqual({ id: 's1', workspaceID: 'w1' });
    expect(result.identity).toEqual(identity());
    expect(current.handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no binding', null, AGENT_ERROR.UNAVAILABLE],
    ['unauthorized', { authorized: false }, AGENT_ERROR.UNAUTHORIZED],
    ['not ready', { ready: false }, AGENT_ERROR.UNAVAILABLE],
    ['missing evidence', { capability: { state: AGENT_SUPPORT.SUPPORTED, evidence: [] } }, AGENT_ERROR.UNACCEPTED],
    ['missing acceptance', { acceptance: null }, AGENT_ERROR.UNACCEPTED],
    ['stale acceptance', { acceptance: { adapterRevision: 'old', capabilityRevision: 'capability-1', operations: [AGENT_OPERATION.GET_SESSION] } }, AGENT_ERROR.UNACCEPTED],
    ['operation not accepted', { acceptance: { adapterRevision: 'adapter-1', capabilityRevision: 'capability-1', operations: [] } }, AGENT_ERROR.UNACCEPTED],
    ['missing handler', { handlers: {} }, AGENT_ERROR.MISSING_HANDLER],
    ['unknown operation', { operation: 'madeUpOperation' }, AGENT_ERROR.UNKNOWN_OPERATION],
    ['unverified capability', { capability: { state: AGENT_SUPPORT.UNVERIFIED, evidence: ['evidence-1'] } }, AGENT_ERROR.UNVERIFIED],
    ['unsupported capability', { capability: { state: AGENT_SUPPORT.UNSUPPORTED, evidence: ['evidence-1'] } }, AGENT_ERROR.UNSUPPORTED],
  ])('refuses %s before invoking a handler', async (_label, setup, code) => {
    const current = setup === null ? null : binding();
    let operation = AGENT_OPERATION.GET_SESSION;
    if (current && setup) {
      if (setup.capability) current.capabilities[operation] = setup.capability;
      else Object.assign(current, setup);
      operation = setup.operation ?? operation;
    }
    const dispatcher = createAgentDispatcher({ getBinding: () => current });
    await errorCode(dispatcher.dispatch(operation, {}, identity()), code);
    if (current) expect(current.handler).not.toHaveBeenCalled();
  });

  it.each(['family', 'connectionID', 'epoch', 'adapterRevision', 'capabilityRevision'])(
    'rejects an expected identity with changed %s', async (field) => {
      const current = binding();
      current.identity[field] = field === 'epoch' ? 2 : 'changed';
      const dispatcher = createAgentDispatcher({ getBinding: () => current });
      await errorCode(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, {}, identity()), AGENT_ERROR.CHANGED);
      expect(current.handler).not.toHaveBeenCalled();
    },
  );

  it('returns an immutable identity copy', () => {
    const current = binding();
    const captured = createAgentDispatcher({ getBinding: () => current }).captureIdentity();
    expect(captured).toEqual(current.identity);
    expect(captured).not.toBe(current.identity);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(() => { captured.epoch = 8; }).toThrow();
  });

  it.each([
    [AGENT_OPERATION.GET_SESSION, AGENT_ERROR.CHANGED],
    [AGENT_OPERATION.SEND_PROMPT, AGENT_ERROR.UNKNOWN_OUTCOME],
  ])('reports %s identity change after its handler starts', async (operation, code) => {
    const current = binding();
    let resolveHandler;
    const handler = vi.fn(() => new Promise((resolve) => { resolveHandler = resolve; }));
    current.capabilities[operation] = { state: AGENT_SUPPORT.SUPPORTED, evidence: ['evidence-1'] };
    current.acceptance.operations.push(operation);
    current.handlers[operation] = handler;
    const dispatcher = createAgentDispatcher({ getBinding: () => current });
    const input = operation === AGENT_OPERATION.SEND_PROMPT
      ? { workspaceID: 'w1', sessionID: 's1', requestID: 'r1', text: 'hello' }
      : { workspaceID: 'w1', sessionID: 's1' };
    const dispatched = dispatcher.dispatch(operation, input, identity());
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    current.identity.epoch += 1;
    resolveHandler('done');
    await errorCode(dispatched, code);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('preserves the original handler error when identity stays current', async () => {
    const current = binding();
    const original = new Error('handler failed');
    current.handlers[AGENT_OPERATION.GET_SESSION] = vi.fn(async () => { throw original; });
    const dispatcher = createAgentDispatcher({ getBinding: () => current });
    await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }, identity())).rejects.toBe(original);
    expect(current.handlers[AGENT_OPERATION.GET_SESSION]).toHaveBeenCalledTimes(1);
  });

  it('reports an entered mutation failure as unknown without retry', async () => {
    const current = binding();
    const operation = AGENT_OPERATION.SEND_PROMPT;
    const handler = vi.fn(async () => { throw new Error('response lost after effect'); });
    current.capabilities[operation] = { state: AGENT_SUPPORT.SUPPORTED, evidence: ['evidence-1'] };
    current.acceptance.operations.push(operation);
    current.handlers[operation] = handler;
    await errorCode(createAgentDispatcher({ getBinding: () => current }).dispatch(operation,
      { workspaceID: 'w1', sessionID: 's1', requestID: 'r1', text: 'hello' }), AGENT_ERROR.UNKNOWN_OUTCOME);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects calls when acceptance changes without an identity revision change', async () => {
    const current = binding();
    const dispatcher = createAgentDispatcher({ getBinding: () => current });
    await dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }, identity());
    current.acceptance.operations = [];
    await errorCode(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, {}, identity()), AGENT_ERROR.UNACCEPTED);
    expect(current.handler).toHaveBeenCalledTimes(1);
  });

  it('rejects an in-flight read when acceptance is revoked before its result', async () => {
    const current = binding();
    current.handlers[AGENT_OPERATION.GET_SESSION] = vi.fn(async () => {
      current.acceptance = null;
      return { id: 's1', workspaceID: 'w1' };
    });
    await errorCode(createAgentDispatcher({ getBinding: () => current }).dispatch(AGENT_OPERATION.GET_SESSION,
      { workspaceID: 'w1', sessionID: 's1' }), AGENT_ERROR.UNACCEPTED);
    expect(current.handlers[AGENT_OPERATION.GET_SESSION]).toHaveBeenCalledTimes(1);
  });

  it.each([{ authorized: false }, { ready: false }])('refuses identity capture from an inaccessible binding: %j', (patch) => {
    const current = binding(patch);
    expect(() => createAgentDispatcher({ getBinding: () => current }).captureIdentity()).toThrow(AgentDispatchError);
  });

  it('exposes dispatch errors as AgentDispatchError', async () => {
    const dispatcher = createAgentDispatcher({ getBinding: () => null });
    await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, {}, identity()))
      .rejects.toBeInstanceOf(AgentDispatchError);
  });

  it('refuses a backend replacement at the final pre-effect check', async () => {
    const original = binding();
    const replacement = binding();
    replacement.identity.family = AGENT_FAMILY.CAGENT;
    let reads = 0;
    const dispatcher = createAgentDispatcher({ getBinding: () => ++reads === 1 ? original : replacement });
    await errorCode(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }, identity()), AGENT_ERROR.CHANGED);
    expect(original.handler).not.toHaveBeenCalled();
    expect(replacement.handler).not.toHaveBeenCalled();
  });

  it('rejects malformed input before entering a supported handler', async () => {
    const current = binding();
    const dispatcher = createAgentDispatcher({ getBinding: () => current });
    await errorCode(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { sessionID: 's1' }, identity()), AGENT_ERROR.INVALID_INPUT);
    expect(current.handler).not.toHaveBeenCalled();
  });

  it('passes parsed copies across the handler boundary', async () => {
    const current = binding();
    const input = { workspaceID: 'w1', sessionID: 's1' };
    const output = { id: 's1', workspaceID: 'w1' };
    current.handlers[AGENT_OPERATION.GET_SESSION] = vi.fn(async () => output);
    const result = await createAgentDispatcher({ getBinding: () => current }).dispatch(AGENT_OPERATION.GET_SESSION, input);
    expect(current.handlers[AGENT_OPERATION.GET_SESSION].mock.calls[0][0]).toEqual(input);
    expect(current.handlers[AGENT_OPERATION.GET_SESSION].mock.calls[0][0]).not.toBe(input);
    expect(result.data).toEqual(output);
    expect(result.data).not.toBe(output);
  });

  it.each([
    [AGENT_OPERATION.GET_SESSION, AGENT_ERROR.INVALID_RESPONSE],
    [AGENT_OPERATION.SEND_PROMPT, AGENT_ERROR.UNKNOWN_OUTCOME],
  ])('refuses malformed %s results without retry', async (operation, code) => {
    const current = binding();
    const handler = vi.fn(async () => ({ wireSecret: 'must not escape' }));
    current.capabilities[operation] = { state: AGENT_SUPPORT.SUPPORTED, evidence: ['evidence-1'] };
    current.acceptance.operations.push(operation);
    current.handlers[operation] = handler;
    const input = operation === AGENT_OPERATION.SEND_PROMPT
      ? { workspaceID: 'w1', sessionID: 's1', requestID: 'r1', text: 'hello' }
      : { workspaceID: 'w1', sessionID: 's1' };
    await errorCode(createAgentDispatcher({ getBinding: () => current }).dispatch(operation, input), code);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
