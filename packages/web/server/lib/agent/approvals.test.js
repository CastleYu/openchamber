import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_APPROVAL, AGENT_ERROR, AGENT_FAMILY, AGENT_OPERATION, AGENT_SUPPORT } from './constants.js';
import { createAgentAuthority } from './authority.js';
import { createAgentDispatcher } from './dispatcher.js';
import { AgentApprovalError, agentApprovalName, createAgentApprovals } from './approvals.js';

const roots = new Set();
const digest = 'a'.repeat(64);
const selection = (patch = {}) => ({
  family: AGENT_FAMILY.OPENCODE, connectionID: 'connection-a', epoch: 1,
  adapterID: 'adapter-a', adapterRevision: 'adapter-r1', capabilityRevision: 'capability-r1',
  serverRevision: 'server-r1', ready: true, authorized: true, ...patch,
});
const approval = (patch = {}) => ({
  family: AGENT_FAMILY.OPENCODE, connectionID: 'connection-a', adapterID: 'adapter-a',
  adapterRevision: 'adapter-r1', capabilityRevision: 'capability-r1', serverRevision: 'server-r1',
  artifactDigest: digest, operations: [{ operation: AGENT_OPERATION.GET_SESSION, evidence: ['host-reviewed:v1'] }],
  ...patch,
});
const record = (patch = {}) => ({ version: AGENT_APPROVAL.VERSION, approval: approval(), ...patch });
const makeStore = async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'oc-agent-approvals-'));
  roots.add(directory);
  return { directory, store: createAgentApprovals({ directory }) };
};
const name = (who = selection()) => agentApprovalName({ family: who.family, connectionID: who.connectionID });
const writeRecord = (directory, value, who = selection()) => fs.writeFileSync(
  path.join(directory, name(who)), JSON.stringify(value),
);
const writeText = (directory, text, who = selection()) => fs.writeFileSync(
  path.join(directory, name(who)), text,
);
const expectCode = (call, code) => expect(call).toThrow(expect.objectContaining({ code }));

afterEach(async () => {
  await Promise.all([...roots].map((directory) => fsp.rm(directory, { recursive: true, force: true })));
  roots.clear();
});

describe('agent approvals', () => {
  it('persists reviewed states and returns detached frozen extension evidence', async () => {
    const { directory, store } = await makeStore();
    const value = approval({ operations: [{ operation: AGENT_OPERATION.GET_SESSION, state: AGENT_SUPPORT.ADAPTED, evidence: ['live:r1'] }],
      extensions: [{ actionID: 'cagent.sample.lookup', revision: 'r1', manifestDigest: digest, state: AGENT_SUPPORT.SUPPORTED, evidence: ['live:lookup'] }] });
    writeRecord(directory, { version: AGENT_APPROVAL.VERSION, approval: value });
    const loaded = store.read(selection());
    expect(loaded).toEqual(value);
    expect(Object.isFrozen(loaded.extensions)).toBe(true);
    expect(Object.isFrozen(loaded.extensions[0])).toBe(true);
    expect(Object.isFrozen(loaded.extensions[0].evidence)).toBe(true);
    value.extensions[0].evidence[0] = 'changed';
    expect(loaded.extensions[0].evidence).toEqual(['live:lookup']);
  });

  it('uses an opaque family-scoped filename and validates selection before storage', async () => {
    const key = { family: AGENT_FAMILY.CAGENT, connectionID: '../private/connection' };
    expect(agentApprovalName(key)).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(agentApprovalName(key)).not.toBe(agentApprovalName({ ...key, family: AGENT_FAMILY.OPENCODE }));
    const { store } = await makeStore();
    expectCode(() => store.read({ family: AGENT_FAMILY.CAGENT }), AGENT_ERROR.INVALID_INPUT);
  });

  it('reads an exact frozen record again after store recreation', async () => {
    const { directory, store } = await makeStore();
    writeRecord(directory, record());
    const value = store.read(selection());
    expect(value).toEqual(approval());
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.operations)).toBe(true);
    expect(Object.isFrozen(value.operations[0])).toBe(true);
    expect(Object.isFrozen(value.operations[0].evidence)).toBe(true);
    expect(createAgentApprovals({ directory }).read(selection())).toEqual(value);
  });

  it('re-reads replacement and deletion without caching', async () => {
    const { directory, store } = await makeStore();
    writeRecord(directory, record());
    const file = path.join(directory, name());
    expect(store.read(selection())).toEqual(approval());
    writeRecord(directory, record({ approval: approval({ serverRevision: 'server-r2' }) }));
    expect(store.read(selection()).serverRevision).toBe('server-r2');
    fs.unlinkSync(file);
    expect(store.read(selection())).toBeNull();
  });

  it('returns null for absent storage without creating files or directories', async () => {
    const directory = path.join(os.tmpdir(), `oc-agent-approvals-missing-${randomUUID()}`);
    roots.add(directory);
    const store = createAgentApprovals({ directory });
    expect(store.read(selection())).toBeNull();
    expect(fs.existsSync(directory)).toBe(false);
  });

  it.each([{ authorized: false }, { ready: false }])('does not access storage for inaccessible selection %j', (patch) => {
    const directory = path.join(os.tmpdir(), `oc-agent-approvals-inaccessible-${randomUUID()}`);
    roots.add(directory);
    expect(createAgentApprovals({ directory }).read(selection(patch))).toBeNull();
    expect(fs.existsSync(directory)).toBe(false);
  });

  it('does not inspect an invalid storage root for an inaccessible selection', async () => {
    const { directory } = await makeStore();
    const file = path.join(directory, 'not-a-directory');
    fs.writeFileSync(file, 'private');
    const store = createAgentApprovals({ directory: file });
    expect(store.read(selection({ authorized: false }))).toBeNull();
    expect(store.read(selection({ ready: false }))).toBeNull();
    expectCode(() => store.read(selection()), AGENT_ERROR.APPROVAL_STORAGE);
  });

  it.each([
    ['wrong version', record({ version: AGENT_APPROVAL.VERSION + 1 })],
    ['identity mismatch', record({ approval: approval({ connectionID: 'other' }) })],
    ['extra record field', record({ extra: true })],
    ['extra approval field', record({ approval: approval({ extra: true }) })],
    ['extra operation field', record({ approval: approval({ operations: [{ ...approval().operations[0], extra: true }] }) })],
    ['duplicate operation', record({ approval: approval({ operations: [...approval().operations, ...approval().operations] }) })],
    ['empty evidence', record({ approval: approval({ operations: [{ operation: AGENT_OPERATION.GET_SESSION, evidence: [] }] }) })],
    ['invalid digest', record({ approval: approval({ artifactDigest: 'A'.repeat(64) }) })],
  ])('rejects %s with a fixed corrupt error', async (_label, value) => {
    const { directory, store } = await makeStore();
    writeRecord(directory, value);
    expectCode(() => store.read(selection()), AGENT_ERROR.APPROVAL_CORRUPT);
  });

  it('rejects oversized records without exposing file contents or paths', async () => {
    const { directory, store } = await makeStore();
    writeText(directory, 's'.repeat(AGENT_APPROVAL.MAX_RECORD_BYTES + 1));
    try {
      store.read(selection());
      throw new Error('expected approval refusal');
    } catch (error) {
      expect(error).toMatchObject({ code: AGENT_ERROR.APPROVAL_CORRUPT });
      expect(error.message).not.toContain(directory);
      expect(error.message).not.toContain('ssss');
    }
  });

  it('rejects invalid JSON and invalid UTF-8 with a fixed corrupt error', async () => {
    const { directory, store } = await makeStore();
    for (const raw of ['{', Buffer.from([0xff, 0xfe])]) {
      writeText(directory, raw);
      expectCode(() => store.read(selection()), AGENT_ERROR.APPROVAL_CORRUPT);
    }
    const error = (() => { try { store.read(selection()); } catch (value) { return value; } })();
    expect(error).toBeInstanceOf(AgentApprovalError);
    expect(error.message).toBe(`Agent approval refused: ${AGENT_ERROR.APPROVAL_CORRUPT}`);
  });

  it('rejects linked roots and linked approval directories', async ({ skip }) => {
    const { directory } = await makeStore();
    const linkedRoot = path.join(os.tmpdir(), `oc-agent-approvals-root-${randomUUID()}`);
    roots.add(linkedRoot);
    const linkedStore = createAgentApprovals({ directory: linkedRoot });
    const file = path.join(directory, name());
    writeRecord(directory, record());
    const linkedDir = path.join(directory, 'linked-dir');
    fs.mkdirSync(linkedDir);
    try {
      fs.symlinkSync(directory, linkedRoot, 'junction');
      fs.unlinkSync(file);
      fs.symlinkSync(linkedDir, file, 'junction');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) skip(`Native directory link unavailable: ${error.code}`);
      throw error;
    }
    expectCode(() => linkedStore.read(selection()), AGENT_ERROR.APPROVAL_STORAGE);
    expectCode(() => createAgentApprovals({ directory }).read(selection()), AGENT_ERROR.APPROVAL_STORAGE);
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    expectCode(() => createAgentApprovals({ directory }).read(selection()), AGENT_ERROR.APPROVAL_STORAGE);
    expect(fs.existsSync(linkedDir)).toBe(true);
  });

  it('rejects an approval file symlink', async ({ skip }) => {
    const { directory, store } = await makeStore();
    const target = path.join(directory, 'target.json');
    fs.writeFileSync(target, JSON.stringify(record()));
    try { fs.symlinkSync(target, path.join(directory, name()), 'file'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) skip(`Native file link unavailable: ${error.code}`);
      throw error;
    }
    expectCode(() => store.read(selection()), AGENT_ERROR.APPROVAL_STORAGE);
  });

  it('integrates the file reader with authority and refuses revoked or revised approvals before the handler', async () => {
    const { directory } = await makeStore();
    const store = createAgentApprovals({ directory });
    writeRecord(directory, record());
    const handler = async () => ({ id: 's1', workspaceID: 'w1' });
    const calls = { count: 0 };
    const trackedHandler = async (...args) => { calls.count += 1; return handler(...args); };
    const registration = {
      adapterID: 'adapter-a', family: AGENT_FAMILY.OPENCODE, adapterRevision: 'adapter-r1',
      capabilityRevision: 'capability-r1', artifactDigest: digest,
      capabilities: { [AGENT_OPERATION.GET_SESSION]: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['schema:v1'] } },
      handlers: { [AGENT_OPERATION.GET_SESSION]: trackedHandler },
    };
    const authority = createAgentAuthority({ registrations: [registration], getSelection: selection,
      getAcceptance: (current) => store.read(current) });
    const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
    await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }))
      .resolves.toMatchObject({ data: { id: 's1', workspaceID: 'w1' } });
    expect(calls.count).toBe(1);

    writeRecord(directory, record());
    const revoking = createAgentAuthority({
      registrations: [{ ...registration, handlers: { [AGENT_OPERATION.GET_SESSION]: async () => {
        fs.unlinkSync(path.join(directory, name()));
        return { id: 's1', workspaceID: 'w1' };
      } } }],
      getSelection: selection, getAcceptance: store.read,
    });
    await expect(createAgentDispatcher({ getBinding: revoking.getBinding }).dispatch(
      AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' },
    )).rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });

    writeRecord(directory, record());

    fs.unlinkSync(path.join(directory, name()));
    await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }))
      .rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
    writeRecord(directory, record({ approval: approval({ artifactDigest: 'b'.repeat(64) }) }));
    await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }))
      .rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
    expect(calls.count).toBe(1);
  });

  it.each([
    [{ authorized: false }, AGENT_ERROR.UNAUTHORIZED],
    [{ ready: false }, AGENT_ERROR.UNAVAILABLE],
  ])('fails closed for inaccessible selections and missing records %j', async (patch, code) => {
    const { directory } = await makeStore();
    const store = createAgentApprovals({ directory });
    const handler = async () => ({ id: 's1', workspaceID: 'w1' });
    const registration = {
      adapterID: 'adapter-a', family: AGENT_FAMILY.OPENCODE, adapterRevision: 'adapter-r1',
      capabilityRevision: 'capability-r1', artifactDigest: digest,
      capabilities: { [AGENT_OPERATION.GET_SESSION]: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['schema:v1'] } },
      handlers: { [AGENT_OPERATION.GET_SESSION]: handler },
    };
    const authority = createAgentAuthority({ registrations: [registration], getSelection: () => selection(patch),
      getAcceptance: (current) => store.read(current) });
    await expect(createAgentDispatcher({ getBinding: authority.getBinding }).dispatch(
      AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' },
    )).rejects.toMatchObject({ code });
    expect(fs.existsSync(directory)).toBe(true);
  });
});
