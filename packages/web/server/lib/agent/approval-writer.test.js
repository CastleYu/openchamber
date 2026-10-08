import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_APPROVAL, AGENT_ERROR, AGENT_FAMILY, AGENT_OPERATION, AGENT_SUPPORT } from './constants.js';
import { createAgentAuthority } from './authority.js';
import { createAgentDispatcher } from './dispatcher.js';
import { AgentApprovalError, agentApprovalName, createAgentApprovals } from './approvals.js';
import { createAgentApprovalWriter } from './approval-writer.js';
import { registerAgentRoutes } from './routes.js';

const roots = new Set();
const selection = (patch = {}) => ({
  family: AGENT_FAMILY.CAGENT, connectionID: 'opaque-connection', epoch: 1,
  adapterID: 'reviewed-adapter', adapterRevision: 'adapter-r1', capabilityRevision: 'capability-r1',
  serverRevision: 'server-r1', ready: true, authorized: true, ...patch,
});
const approval = (patch = {}) => ({
  family: AGENT_FAMILY.CAGENT, connectionID: 'opaque-connection', adapterID: 'reviewed-adapter',
  adapterRevision: 'adapter-r1', capabilityRevision: 'capability-r1', serverRevision: 'server-r1',
  artifactDigest: 'a'.repeat(64),
  operations: [{ operation: AGENT_OPERATION.GET_SESSION, evidence: ['host-reviewed:v1'] }], ...patch,
});
const makeRoot = async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'oc-agent-writer-'));
  roots.add(directory);
  return directory;
};
const recordPath = (directory, value = approval()) => path.join(directory,
  agentApprovalName({ family: value.family, connectionID: value.connectionID }));
const record = (value) => JSON.stringify({ version: AGENT_APPROVAL.VERSION, approval: value });
const expectCode = (call, code) => {
  let caught;
  try { call(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(AgentApprovalError);
  expect(caught).toMatchObject({ code, message: `Agent approval refused: ${code}` });
};

afterEach(async () => {
  await Promise.all([...roots].map((directory) => fsp.rm(directory, { recursive: true, force: true })));
  roots.clear();
});

describe('agent approval writer', () => {
  it('does no construction-time filesystem work and returns only a frozen write/revoke port', async () => {
    const directory = path.join(os.tmpdir(), `oc-agent-writer-${randomUUID()}`);
    roots.add(directory);
    const writer = createAgentApprovalWriter({ directory });
    expect(fs.existsSync(directory)).toBe(false);
    expect(Object.isFrozen(writer)).toBe(true);
    expect(Object.keys(writer).sort()).toEqual(['revoke', 'write']);
    expect(writer.read).toBeUndefined();
    expect(fs.existsSync(directory)).toBe(false);

    const app = express();
    registerAgentRoutes(app, { dispatcher: {}, features: {} });
    await request(app).get('/api/agent-backend/approvals').expect(404, { error: AGENT_ERROR.UNKNOWN_ROUTE });
    await request(app).post('/api/agent-backend/approvals').expect(404, { error: AGENT_ERROR.UNKNOWN_ROUTE });
  });

  it('writes a strict opaque versioned record that a restarted reader can load', async () => {
    const directory = await makeRoot();
    const writer = createAgentApprovalWriter({ directory });
    writer.write(approval());
    const file = recordPath(directory);
    expect(path.basename(file)).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(path.basename(file)).not.toContain('opaque-connection');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ version: 1, approval: approval() });
    expect(createAgentApprovals({ directory }).read(selection())).toEqual(approval());
    expect(createAgentApprovals({ directory }).read(selection())).toEqual(approval());
  });

  it('replaces and revokes records immediately across reader instances', async () => {
    const directory = await makeRoot();
    const writer = createAgentApprovalWriter({ directory });
    writer.write(approval());
    expect(createAgentApprovals({ directory }).read(selection()).serverRevision).toBe('server-r1');
    writer.write(approval({ serverRevision: 'server-r2' }));
    expect(createAgentApprovals({ directory }).read(selection()).serverRevision).toBe('server-r2');
    expect(writer.revoke({ family: AGENT_FAMILY.CAGENT, connectionID: 'opaque-connection' })).toBe(true);
    expect(createAgentApprovals({ directory }).read(selection())).toBeNull();
    expect(writer.revoke({ family: AGENT_FAMILY.CAGENT, connectionID: 'opaque-connection' })).toBe(false);
  });

  it('keeps family and connection scopes separate', async () => {
    const directory = await makeRoot();
    const writer = createAgentApprovalWriter({ directory });
    writer.write(approval());
    writer.write(approval({ family: AGENT_FAMILY.OPENCODE }));
    writer.write(approval({ connectionID: 'other-connection' }));
    expect(fs.readdirSync(directory)).toHaveLength(3);
    expect(createAgentApprovals({ directory }).read(selection())).toEqual(approval());
    expect(createAgentApprovals({ directory }).read(selection({ family: AGENT_FAMILY.OPENCODE })))
      .toEqual(approval({ family: AGENT_FAMILY.OPENCODE }));
    expect(createAgentApprovals({ directory }).read(selection({ connectionID: 'other-connection' })))
      .toEqual(approval({ connectionID: 'other-connection' }));
    writer.revoke({ family: AGENT_FAMILY.CAGENT, connectionID: 'opaque-connection' });
    expect(createAgentApprovals({ directory }).read(selection())).toBeNull();
    expect(createAgentApprovals({ directory }).read(selection({ family: AGENT_FAMILY.OPENCODE })))
      .toEqual(approval({ family: AGENT_FAMILY.OPENCODE }));
    expect(createAgentApprovals({ directory }).read(selection({ connectionID: 'other-connection' })))
      .toEqual(approval({ connectionID: 'other-connection' }));
    expect(fs.readdirSync(directory)).toHaveLength(2);
  });

  it.each([
    ['malformed', { ...approval(), extra: true }],
    ['oversized', approval({ operations: [{ operation: AGENT_OPERATION.GET_SESSION,
      evidence: ['x'.repeat(AGENT_APPROVAL.MAX_RECORD_BYTES)] }] })],
  ])('preserves an existing approval and cleans temporary files after %s input', async (_label, invalid) => {
    const directory = await makeRoot();
    const writer = createAgentApprovalWriter({ directory });
    writer.write(approval());
    const file = recordPath(directory);
    const before = fs.readFileSync(file);
    expectCode(() => writer.write(invalid), AGENT_ERROR.INVALID_INPUT);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(directory)).toEqual([path.basename(file)]);
  });

  it('refuses a missing, linked, or non-directory root with a fixed storage error', async ({ skip }) => {
    const missing = path.join(os.tmpdir(), `oc-agent-writer-missing-${randomUUID()}`);
    roots.add(missing);
    const missingWriter = createAgentApprovalWriter({ directory: missing });
    expectCode(() => missingWriter.write(approval()), AGENT_ERROR.APPROVAL_STORAGE);
    expectCode(() => missingWriter.revoke({ family: AGENT_FAMILY.CAGENT, connectionID: 'opaque-connection' }),
      AGENT_ERROR.APPROVAL_STORAGE);
    expect(fs.existsSync(missing)).toBe(false);

    const real = await makeRoot();
    const file = path.join(os.tmpdir(), `oc-agent-writer-file-${randomUUID()}`);
    roots.add(file);
    fs.writeFileSync(file, 'not a directory');
    expectCode(() => createAgentApprovalWriter({ directory: file }).write(approval()), AGENT_ERROR.APPROVAL_STORAGE);
    const linked = path.join(os.tmpdir(), `oc-agent-writer-link-${randomUUID()}`);
    roots.add(linked);
    try { fs.symlinkSync(real, linked, 'junction'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) skip(`Native directory link unavailable: ${error.code}`);
      throw error;
    }
    expectCode(() => createAgentApprovalWriter({ directory: linked }).write(approval()), AGENT_ERROR.APPROVAL_STORAGE);
  });

  it('refuses linked and non-file approval targets without changing their targets', async ({ skip }) => {
    const directory = await makeRoot();
    const target = path.join(directory, 'private-target.json');
    fs.writeFileSync(target, 'target contents');
    const file = recordPath(directory);
    try { fs.symlinkSync(target, file, 'file'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) skip(`Native file link unavailable: ${error.code}`);
      throw error;
    }
    const writer = createAgentApprovalWriter({ directory });
    expectCode(() => writer.write(approval()), AGENT_ERROR.APPROVAL_STORAGE);
    expectCode(() => writer.revoke({ family: AGENT_FAMILY.CAGENT, connectionID: 'opaque-connection' }),
      AGENT_ERROR.APPROVAL_STORAGE);
    expect(fs.readFileSync(target, 'utf8')).toBe('target contents');
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    expectCode(() => writer.write(approval()), AGENT_ERROR.APPROVAL_STORAGE);
    expectCode(() => writer.revoke({ family: AGENT_FAMILY.CAGENT, connectionID: 'opaque-connection' }),
      AGENT_ERROR.APPROVAL_STORAGE);
    expect(fs.readFileSync(target, 'utf8')).toBe('target contents');
  });

  it('refuses invalid construction and revocation scope without creating storage', async () => {
    expectCode(() => createAgentApprovalWriter({ directory: '' }), AGENT_ERROR.INVALID_INPUT);
    const directory = await makeRoot();
    const writer = createAgentApprovalWriter({ directory });
    for (const value of [{ family: 'other', connectionID: 'connection' },
      { family: AGENT_FAMILY.CAGENT, connectionID: '' },
      { family: AGENT_FAMILY.CAGENT, connectionID: 'connection', path: 'private' }]) {
      expectCode(() => writer.revoke(value), AGENT_ERROR.INVALID_INPUT);
    }
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('lets independent approval enable dispatch and revocation close the next dispatch', async () => {
    const directory = await makeRoot();
    const writer = createAgentApprovalWriter({ directory });
    const store = createAgentApprovals({ directory });
    const selectionNow = selection();
    const registration = {
      adapterID: selectionNow.adapterID, family: selectionNow.family,
      adapterRevision: selectionNow.adapterRevision, capabilityRevision: selectionNow.capabilityRevision,
      artifactDigest: approval().artifactDigest,
      capabilities: { [AGENT_OPERATION.GET_SESSION]: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['schema:v1'] } },
      handlers: { [AGENT_OPERATION.GET_SESSION]: async () => ({ id: 's1', workspaceID: 'w1' }) },
    };
    const authority = createAgentAuthority({ registrations: [registration], getSelection: () => selectionNow,
      getAcceptance: store.read });
    const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
    await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }))
      .rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
    writer.write(approval());
    await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }))
      .resolves.toMatchObject({ data: { id: 's1', workspaceID: 'w1' } });
    writer.revoke({ family: AGENT_FAMILY.CAGENT, connectionID: 'opaque-connection' });
    await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }))
      .rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
  });

  it('rechecks approval after a handler revokes it before returning', async () => {
    const directory = await makeRoot();
    const writer = createAgentApprovalWriter({ directory });
    const store = createAgentApprovals({ directory });
    writer.write(approval());
    const selected = selection();
    const registration = {
      adapterID: selected.adapterID, family: selected.family,
      adapterRevision: selected.adapterRevision, capabilityRevision: selected.capabilityRevision,
      artifactDigest: approval().artifactDigest,
      capabilities: { [AGENT_OPERATION.GET_SESSION]: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['schema:v1'] } },
      handlers: { [AGENT_OPERATION.GET_SESSION]: async () => {
        writer.revoke({ family: AGENT_FAMILY.CAGENT, connectionID: 'opaque-connection' });
        return { id: 's1', workspaceID: 'w1' };
      } },
    };
    const authority = createAgentAuthority({ registrations: [registration], getSelection: () => selected,
      getAcceptance: store.read });
    const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
    await expect(dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { workspaceID: 'w1', sessionID: 's1' }))
      .rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
  });
});
