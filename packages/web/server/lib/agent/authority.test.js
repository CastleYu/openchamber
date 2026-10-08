import { describe, expect, it, vi } from 'vitest';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_OPERATION, AGENT_SUPPORT } from './constants.js';
import { AgentDispatchError, createAgentDispatcher } from './dispatcher.js';
import { createAgentAuthority } from './authority.js';

const digest = 'a'.repeat(64);
const selection = (patch = {}) => ({
  family: AGENT_FAMILY.OPENCODE,
  connectionID: 'connection-1',
  epoch: 1,
  adapterID: 'adapter-1',
  adapterRevision: 'adapter-r1',
  capabilityRevision: 'capability-r1',
  serverRevision: 'server-r1',
  ready: true,
  authorized: true,
  ...patch,
});
const registration = (patch = {}) => ({
  adapterID: 'adapter-1',
  family: AGENT_FAMILY.OPENCODE,
  adapterRevision: 'adapter-r1',
  capabilityRevision: 'capability-r1',
  artifactDigest: digest,
  capabilities: {
    [AGENT_OPERATION.GET_SESSION]: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['schema:v1'] },
  },
  handlers: { [AGENT_OPERATION.GET_SESSION]: vi.fn(async () => ({ id: 's1', workspaceID: 'w1' })) },
  ...patch,
});
const approval = (patch = {}) => ({
  connectionID: 'connection-1',
  adapterID: 'adapter-1',
  family: AGENT_FAMILY.OPENCODE,
  adapterRevision: 'adapter-r1',
  capabilityRevision: 'capability-r1',
  serverRevision: 'server-r1',
  artifactDigest: digest,
  operations: [{ operation: AGENT_OPERATION.GET_SESSION, evidence: ['host-reviewed:v1'] }],
  ...patch,
});
const authorityFor = (options = {}) => {
  let current = selection();
  const selected = vi.fn(() => current);
  const accepted = vi.fn(() => approval());
  const authority = createAgentAuthority({ registrations: [registration()], getSelection: selected,
    getAcceptance: accepted, ...options });
  return { authority, selected, accepted, setSelection: (value) => { current = value; } };
};
const errorCode = (call, code) => expect(call).rejects.toMatchObject({ code });

describe('agent authority', () => {
  it('does not read protected approval when selection is unauthorized or unready', () => {
    const getAcceptance = vi.fn(() => { throw new Error('private storage must not be read'); });
    for (const patch of [{ authorized: false }, { ready: false }]) {
      const { authority } = authorityFor({ getSelection: () => selection(patch), getAcceptance });
      expect(authority.getBinding().acceptance).toBeNull();
    }
    expect(getAcceptance).not.toHaveBeenCalled();
  });
  it.each([
    { family: AGENT_FAMILY.CAGENT }, { connectionID: 'other' }, { adapterID: 'other' },
    { adapterRevision: 'other' }, { capabilityRevision: 'other' }, { serverRevision: 'other' },
    { artifactDigest: 'b'.repeat(64) },
  ])('does not grant a mismatched approval %j', (patch) => {
    const { authority } = authorityFor({ getAcceptance: () => approval(patch) });
    expect(authority.getBinding().acceptance).toBeNull();
  });

  it('dispatches a parsed result under a matching independent approval', async () => {
    const { authority } = authorityFor();
    const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
    const result = await dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' });
    expect(result).toEqual({ identity: dispatcher.captureIdentity(), data: { id: 's1', workspaceID: 'w1' } });
  });

  it.each([
    [{ ready: false }, AGENT_ERROR.UNAVAILABLE], [{ authorized: false }, AGENT_ERROR.UNAUTHORIZED],
  ])('enforces current access before entering a handler %j', async (patch, code) => {
    const item = registration();
    const authority = createAgentAuthority({
      registrations: [item], getSelection: () => selection(patch), getAcceptance: () => approval(),
    });
    const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
    await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }))
      .rejects.toMatchObject({ code });
    expect(item.handlers[AGENT_OPERATION.GET_SESSION]).not.toHaveBeenCalled();
  });

  it('grants only the independently approved registered operation', () => {
    const { authority } = authorityFor();
    const binding = authority.getBinding();
    expect(binding.acceptance.operations).toEqual([AGENT_OPERATION.GET_SESSION]);
    expect(binding.handlers[AGENT_OPERATION.GET_SESSION]).toBeInstanceOf(Function);
    expect(binding.identity).toEqual({ family: AGENT_FAMILY.OPENCODE, connectionID: 'connection-1', epoch: 1,
      adapterRevision: 'adapter-r1', capabilityRevision: 'capability-r1' });
  });

  it('does not treat manifest support as host approval', () => {
    const item = registration();
    const handler = item.handlers[AGENT_OPERATION.GET_SESSION];
    const authority = createAgentAuthority({ registrations: [item], getSelection: () => selection(), getAcceptance: () => null });
    const binding = authority.getBinding();
    expect(binding.acceptance).toBeNull();
    const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
    return errorCode(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }), AGENT_ERROR.UNACCEPTED)
      .then(() => expect(handler).not.toHaveBeenCalled());
  });

  it('permits GET_SESSION dispatch under a matching host approval', async () => {
    const item = registration();
    const authority = createAgentAuthority({ registrations: [item], getSelection: () => selection(),
      getAcceptance: () => approval() });
    const result = await createAgentDispatcher({ getBinding: authority.getBinding }).dispatch(
      AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' });
    expect(result.data).toEqual({ id: 's1', workspaceID: 'w1' });
    expect(item.handlers[AGENT_OPERATION.GET_SESSION]).toHaveBeenCalledTimes(1);
  });

  it('returns null for absent, invalid, or unregistered exact selections', () => {
    const { authority, setSelection } = authorityFor();
    setSelection(null);
    expect(authority.getBinding()).toBeNull();
    setSelection({ ...selection(), extra: true });
    expect(authority.getBinding()).toBeNull();
    setSelection(selection({ adapterRevision: 'other' }));
    expect(authority.getBinding()).toBeNull();
  });

  it('rechecks current readiness, authorization, and approval revisions on each read', () => {
    let current = selection();
    let accepted = approval();
    const authority = createAgentAuthority({ registrations: [registration()], getSelection: () => current,
      getAcceptance: () => accepted });
    expect(authority.getBinding().acceptance).not.toBeNull();
    current = selection({ ready: false });
    expect(authority.getBinding()).toMatchObject({ ready: false, authorized: true });
    current = selection({ authorized: false });
    expect(authority.getBinding()).toMatchObject({ ready: true, authorized: false });
    current = selection();
    accepted = approval({ serverRevision: 'old-server' });
    expect(authority.getBinding().acceptance).toBeNull();
    accepted = approval({ adapterRevision: 'old-adapter' });
    expect(authority.getBinding().acceptance).toBeNull();
  });

  it('rejects duplicate registration tuples and malformed registrations', () => {
    const item = registration();
    expect(() => createAgentAuthority({ registrations: [item, item], getSelection: () => null, getAcceptance: () => null }))
      .toThrow(AgentDispatchError);
    expect(() => createAgentAuthority({ registrations: [{ ...item, artifactDigest: 'bad' },
      ], getSelection: () => null, getAcceptance: () => null })).toThrow(AgentDispatchError);
    expect(() => createAgentAuthority({ registrations: [{ ...item, handlers: { [AGENT_OPERATION.GET_SESSION]: 'bad' } },
      ], getSelection: () => null, getAcceptance: () => null })).toThrow(AgentDispatchError);
  });

  it('rejects malformed approval schemas and duplicate operation rows as no acceptance', () => {
    for (const accepted of [
      { ...approval(), extra: true },
      { ...approval(), operations: [...approval().operations, ...approval().operations] },
      { ...approval(), operations: [{ operation: AGENT_OPERATION.GET_SESSION, evidence: [] }] },
      { ...approval(), operations: [{ operation: 'madeUpOperation', evidence: ['review'] }] },
    ]) {
      const { authority } = authorityFor({ getAcceptance: () => accepted });
      expect(authority.getBinding().acceptance).toBeNull();
    }
  });

  it('filters invalid individual approval rows while retaining unrelated valid rows', () => {
    const list = registration({
      capabilities: {
        [AGENT_OPERATION.GET_SESSION]: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['schema:v1'] },
        [AGENT_OPERATION.LIST_SESSIONS]: { state: AGENT_SUPPORT.UNSUPPORTED, evidence: ['unsupported:v1'] },
      },
      handlers: {
        [AGENT_OPERATION.GET_SESSION]: vi.fn(),
      },
    });
    const accepted = approval({ operations: [
      { operation: AGENT_OPERATION.GET_SESSION, evidence: ['host-reviewed:v1'] },
      { operation: AGENT_OPERATION.LIST_SESSIONS, evidence: ['host-reviewed:v2'] },
    ] });
    const authority = createAgentAuthority({ registrations: [list], getSelection: () => selection(),
      getAcceptance: () => accepted });
    expect(authority.getBinding().acceptance.operations).toEqual([AGENT_OPERATION.GET_SESSION]);
  });

  it('returns deeply frozen copies isolated from source mutation', () => {
    const sourceSelection = selection();
    const sourceApproval = approval();
    const sourceRegistration = registration();
    const authority = createAgentAuthority({ registrations: [sourceRegistration], getSelection: () => sourceSelection,
      getAcceptance: () => sourceApproval });
    const first = authority.getBinding();
    expect(Object.isFrozen(first.identity)).toBe(true);
    expect(Object.isFrozen(first.capabilities[AGENT_OPERATION.GET_SESSION].evidence)).toBe(true);
    expect(Object.isFrozen(first.acceptance.operations)).toBe(true);
    expect(Object.isFrozen(first.handlers)).toBe(true);
    sourceSelection.epoch = 9;
    sourceApproval.operations[0].operation = AGENT_OPERATION.LIST_SESSIONS;
    sourceRegistration.capabilities[AGENT_OPERATION.GET_SESSION].evidence[0] = 'changed';
    expect(first.identity.epoch).toBe(1);
    expect(first.acceptance.operations).toEqual([AGENT_OPERATION.GET_SESSION]);
    expect(first.capabilities[AGENT_OPERATION.GET_SESSION].evidence).toEqual(['schema:v1']);
  });

  it('surfaces host callback failures as unavailable dispatch errors', () => {
    for (const options of [
      { getSelection: () => { throw new Error('selection'); } },
      { getAcceptance: () => { throw new Error('approval'); } },
    ]) {
      const { authority } = authorityFor(options);
      expect(() => authority.getBinding()).toThrow(AgentDispatchError);
      expect(() => authority.getBinding()).toThrow(expect.objectContaining({ code: AGENT_ERROR.UNAVAILABLE }));
    }
  });

  it('dispatches with valid approval and rejects an in-flight result after approval revocation', async () => {
    let accepted = approval();
    let resolve;
    const handler = vi.fn(() => new Promise((done) => { resolve = done; }));
    const item = registration({ handlers: { [AGENT_OPERATION.GET_SESSION]: handler } });
    const authority = createAgentAuthority({ registrations: [item], getSelection: () => selection(),
      getAcceptance: () => accepted });
    const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
    const pending = dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    accepted = null;
    resolve({ id: 's1', workspaceID: 'w1' });
    await errorCode(pending, AGENT_ERROR.UNACCEPTED);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects a prior identity after the selected epoch changes', async () => {
    let current = selection();
    const authority = createAgentAuthority({ registrations: [registration()], getSelection: () => current,
      getAcceptance: () => approval() });
    const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
    const expected = dispatcher.captureIdentity();
    current = selection({ epoch: 2 });
    await errorCode(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION,
      { workspaceID: 'w1', sessionID: 's1' }, expected), AGENT_ERROR.CHANGED);
  });
});
