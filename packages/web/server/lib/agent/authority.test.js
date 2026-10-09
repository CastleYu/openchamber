import { describe, expect, it, vi } from 'vitest';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_OPERATION, AGENT_SUPPORT } from './constants.js';
import { AgentDispatchError, createAgentDispatcher } from './dispatcher.js';
import { agentExtensionDigest, createAgentAuthority } from './authority.js';

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
const extensionManifest = (patch = {}) => ({
  version: 1,
  actionID: 'cagent.sample.lookup',
  revision: 'r1',
  label: { key: 'cagent.sample.lookup', en: 'Lookup', zhCN: '查询' },
  context: { workspace: true, session: false },
  effect: 'read',
  authorization: 'current-principal',
  cancellation: 'none',
  outcome: 'observed',
  input: [],
  output: { kind: 'text', maxLength: 100 },
  evidence: [{ document: 'guide', section: 'lookup' }],
  ...patch,
});
const extension = (patch = {}) => ({
  manifest: extensionManifest(),
  capability: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['tested:r1'] },
  handler: vi.fn(async () => ({ result: { text: 'ok' } })),
  ...patch,
});
const extensionApproval = (manifest = extensionManifest(), patch = {}) => ({
  actionID: manifest.actionID,
  revision: manifest.revision,
  manifestDigest: agentExtensionDigest(manifest),
  evidence: ['host-reviewed:r1'],
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

  it('keeps registered extensions unaccepted without extension approval or with a legacy approval', () => {
    for (const accepted of [null, approval()]) {
      const item = registration({ extensions: [extension()] });
      const authority = createAgentAuthority({ registrations: [item], getSelection: () => selection(),
        getAcceptance: () => accepted });
      expect(authority.getBinding().extensions).toHaveLength(1);
      expect(authority.getBinding().extensions[0].accepted).toBe(false);
    }
  });

  it('accepts a matching extension digest independently of core operation grants', () => {
    const ext = extension();
    const authority = createAgentAuthority({ registrations: [registration({ extensions: [ext] })],
      getSelection: () => selection(), getAcceptance: () => approval({ operations: [], extensions: [extensionApproval(ext.manifest)] }) });
    const [binding] = authority.getBinding().extensions;
    expect(binding.accepted).toBe(true);
    expect(binding.manifest).toEqual(ext.manifest);
  });

  it.each([
    { revision: 'old' },
    { manifestDigest: 'b'.repeat(64) },
  ])('rejects an extension approval with mismatched revision or digest %j', (patch) => {
    const ext = extension();
    const authority = createAgentAuthority({ registrations: [registration({ extensions: [ext] })],
      getSelection: () => selection(), getAcceptance: () => approval({ operations: [],
        extensions: [extensionApproval(ext.manifest, patch)] }) });
    expect(authority.getBinding().extensions[0].accepted).toBe(false);
  });

  it('detaches and deeply freezes registered extension metadata', () => {
    const ext = extension();
    const authority = createAgentAuthority({ registrations: [registration({ extensions: [ext] })],
      getSelection: () => selection(), getAcceptance: () => approval({ operations: [], extensions: [extensionApproval(ext.manifest)] }) });
    const binding = authority.getBinding().extensions[0];
    ext.manifest.label.en = 'Changed';
    ext.manifest.evidence[0].section = 'changed';
    ext.capability.evidence[0] = 'changed';
    expect(binding.manifest.label.en).toBe('Lookup');
    expect(binding.manifest.evidence[0].section).toBe('lookup');
    expect(binding.capability.evidence).toEqual(['tested:r1']);
    expect(Object.isFrozen(binding.manifest.label)).toBe(true);
    expect(Object.isFrozen(binding.manifest.evidence[0])).toBe(true);
    expect(Object.isFrozen(binding.capability.evidence)).toBe(true);
  });

  it('rechecks extension approval and filters rows independently', () => {
    const first = extension();
    const second = extension({ manifest: extensionManifest({ actionID: 'cagent.sample.other' }) });
    let accepted = approval({ operations: [], extensions: [
      extensionApproval(first.manifest, { revision: 'old' }), extensionApproval(second.manifest),
    ] });
    const authority = createAgentAuthority({ registrations: [registration({ extensions: [first, second] })],
      getSelection: () => selection(), getAcceptance: () => accepted });
    expect(authority.getBinding().extensions.map(({ accepted: value }) => value)).toEqual([false, true]);
    accepted = approval({ operations: [] });
    expect(authority.getBinding().extensions.map(({ accepted: value }) => value)).toEqual([false, false]);
  });

  it('refuses duplicate extension registration and approval action IDs', () => {
    const ext = extension();
    expect(() => createAgentAuthority({ registrations: [registration({ extensions: [ext, ext] })],
      getSelection: () => null, getAcceptance: () => null })).toThrow(AgentDispatchError);
    const authority = createAgentAuthority({ registrations: [registration({ extensions: [ext] })],
      getSelection: () => selection(), getAcceptance: () => approval({ operations: [], extensions: [
        extensionApproval(ext.manifest), extensionApproval(ext.manifest),
      ] }) });
    expect(authority.getBinding().acceptance).toBeNull();
    expect(authority.getBinding().extensions[0].accepted).toBe(false);
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
