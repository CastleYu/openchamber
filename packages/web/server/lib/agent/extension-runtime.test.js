import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createAgentAuthority, agentExtensionDigest } from './authority.js';
import { createAgentDispatcher } from './dispatcher.js';
import { createAgentAttempts } from './attempts.js';
import { registerAgentRoutes } from './routes.js';
import { AGENT_ERROR, AGENT_ROUTE } from './constants.js';

const manifest = (effect = 'read') => ({
  version: 1, actionID: 'cagent.report', revision: '1', label: { key: 'cagent.report', en: 'Report', zhCN: '报告' },
  context: { workspace: true, session: true }, effect, authorization: 'current-principal',
  cancellation: 'none', outcome: 'observed',
  input: [{ key: 'query', label: { key: 'cagent.query', en: 'Query', zhCN: '查询' }, required: true, value: { kind: 'text', maxLength: 32 } }],
  output: { kind: 'text', maxLength: 32 }, evidence: [{ document: 'fixture', section: 'report' }],
});
const fixture = (options = {}) => {
  const contract = manifest(options.effect);
  const principalID = `principal-${'a'.repeat(64)}`;
  const registration = { family: 'cagent', adapterID: 'a', adapterRevision: 'r', capabilityRevision: 'c', artifactDigest: 'a'.repeat(64),
    capabilities: {}, handlers: {}, extensions: [{ manifest: contract, capability: { state: 'supported', evidence: ['fixture'] },
      handler: options.handler ?? (async () => ({ result: { text: 'answer' } })) }] };
  const selection = { family: 'cagent', adapterID: 'a', adapterRevision: 'r', capabilityRevision: 'c', connectionID: 'connection',
    epoch: 1, serverRevision: 'server', ready: true, authorized: true };
  let approval = { ...registration, connectionID: selection.connectionID, serverRevision: selection.serverRevision };
  delete approval.capabilities; delete approval.handlers;
  approval = { ...approval, operations: [], extensions: [{ actionID: contract.actionID, revision: contract.revision,
    manifestDigest: agentExtensionDigest(contract), evidence: ['review'] }] };
  const authority = createAgentAuthority({ registrations: [registration], getSelection: () => selection, getAcceptance: () => approval });
  const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding, attempts: options.attempts }).forPrincipal(principalID);
  const identity = dispatcher.captureIdentity();
  const input = { workspaceID: 'w', sessionID: 's', values: { query: 'question' } };
  return { dispatcher, identity, input, revoke: () => { approval = null; }, selection };
};

describe('finite extension dispatch through protected host authority', () => {
  it('dispatches an accepted read and refuses invalid scopes, values and revoked approval before effects', async () => {
    let calls = 0;
    const value = fixture({ handler: async () => { calls++; return { result: { text: 'answer' } }; } });
    expect(value.dispatcher.describeExtensions().actions[0].availability.available).toBe(true);
    const invoke = (input = value.input, identity = value.identity) => value.dispatcher.dispatchExtension('cagent.report', input, identity);
    expect((await invoke()).result).toEqual({ text: 'answer' });
    await expect(invoke({ ...value.input, values: { query: 4 } })).rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
    await expect(invoke({ values: { query: 'x' } })).rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
    await expect(invoke(value.input, { ...value.identity, principalID: `principal-${'b'.repeat(64)}` })).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    value.revoke();
    expect(value.dispatcher.describeExtensions().actions[0].availability).toEqual({ available: false, reason: AGENT_ERROR.UNACCEPTED });
    await expect(invoke()).rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
    expect(calls).toBe(1);
  });
  it('reserves mutation intent, retains unknown outcomes across restart and refuses replay', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-extension-attempt-'));
    try {
      const attempts = createAgentAttempts({ directory });
      let calls = 0;
      const value = fixture({ effect: 'mutation', attempts, handler: async () => { calls++; throw new Error('private upstream payload'); } });
      const input = { ...value.input, requestID: 'request' };
      await expect(value.dispatcher.dispatchExtension('cagent.report', input, value.identity)).rejects.toMatchObject({ code: AGENT_ERROR.UNKNOWN_OUTCOME });
      const restarted = createAgentAttempts({ directory });
      expect((await restarted.read(value.identity, 'request')).state).toBe('unknown');
      await expect(value.dispatcher.dispatchExtension('cagent.report', input, value.identity)).rejects.toMatchObject({ code: AGENT_ERROR.ATTEMPT_EXISTS });
      expect(calls).toBe(1);
      const stored = await fs.readFile(path.join(directory, (await fs.readdir(directory))[0]), 'utf8');
      expect(stored).not.toContain('private'); expect(stored).not.toContain('question');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('records only matching observed mutation receipts and rejects revocation after handler entry', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-extension-receipt-'));
    try {
      const attempts = createAgentAttempts({ directory });
      const value = fixture({ effect: 'mutation', attempts, handler: async (input) => ({ result: { text: 'done' }, receipt: { requestID: input.requestID, state: 'complete' } }) });
      await value.dispatcher.dispatchExtension('cagent.report', { ...value.input, requestID: 'confirmed' }, value.identity);
      expect((await attempts.read(value.identity, 'confirmed')).state).toBe('complete');
      const revoked = fixture({ effect: 'mutation', attempts, handler: async (input) => {
        revoked.revoke(); return { result: { text: 'done' }, receipt: { requestID: input.requestID, state: 'complete' } };
      } });
      await expect(revoked.dispatcher.dispatchExtension('cagent.report', { ...revoked.input, requestID: 'revoked' }, revoked.identity))
        .rejects.toMatchObject({ code: AGENT_ERROR.UNKNOWN_OUTCOME });
      expect((await attempts.read(revoked.identity, 'revoked')).state).toBe('unknown');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('uses the same principal gate for HTTP extension enumeration and dispatch', async () => {
    const value = fixture();
    const app = express();
    registerAgentRoutes(app, { dispatcher: value.dispatcher, resolvePrincipal: async (req) => req.headers.authorization ? value.identity.principalID : null });
    await request(app).get(AGENT_ROUTE.EXTENSIONS).expect(403, { error: AGENT_ERROR.UNAUTHORIZED });
    const listed = await request(app).get(AGENT_ROUTE.EXTENSIONS).set('Authorization', 'Bearer fixture').expect(200);
    expect(listed.body.actions[0].manifest.actionID).toBe('cagent.report');
    await request(app).post(AGENT_ROUTE.EXTENSION_DISPATCH).set('Authorization', 'Bearer fixture')
      .send({ actionID: 'cagent.report', input: value.input, identity: value.identity }).expect(200);
    await request(app).post(AGENT_ROUTE.EXTENSION_DISPATCH).set('Authorization', 'Bearer fixture')
      .send({ actionID: 'cagent.report', input: value.input, identity: { ...value.identity, principalID: `principal-${'b'.repeat(64)}` } })
      .expect(409, { error: AGENT_ERROR.CHANGED });
  });
  it('refuses writes without storage and rejects malformed finite read results', async () => {
    const write = fixture({ effect: 'mutation' });
    expect(write.dispatcher.describeExtensions().actions[0].availability.reason).toBe(AGENT_ERROR.WRITE_UNAVAILABLE);
    await expect(write.dispatcher.dispatchExtension('cagent.report', { ...write.input, requestID: 'r' }, write.identity))
      .rejects.toMatchObject({ code: AGENT_ERROR.WRITE_UNAVAILABLE });
    const read = fixture({ handler: async () => ({ result: { html: '<script>private</script>' } }) });
    await expect(read.dispatcher.dispatchExtension('cagent.report', read.input, read.identity))
      .rejects.toMatchObject({ code: AGENT_ERROR.INVALID_RESPONSE });
  });
  it('records not-sent when acceptance is revoked while the intent is reserved', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-extension-not-sent-'));
    try {
      const stored = createAgentAttempts({ directory });
      let calls = 0;
      const value = fixture({ effect: 'mutation', attempts: {
        begin: async (...args) => { const attempt = await stored.begin(...args); value.revoke(); return attempt; },
        read: stored.read,
      }, handler: async () => { calls++; return { result: { text: 'unused' } }; } });
      await expect(value.dispatcher.dispatchExtension('cagent.report', { ...value.input, requestID: 'revoked' }, value.identity))
        .rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
      expect(calls).toBe(0);
      expect((await stored.read(value.identity, 'revoked')).state).toBe('not-sent');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
