import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createAgentPrincipalResolver } from './principal.js';
import { createRemoteClientAuthRuntime } from '../client-auth/remote-clients.js';
import { createUiAuth } from '../ui-auth/ui-auth.js';
import { createAgentDispatcher } from './dispatcher.js';
import { registerAgentRoutes } from './routes.js';
import { AGENT_ERROR, AGENT_OPERATION, AGENT_ROUTE, AGENT_SUPPORT } from './constants.js';

describe('verified Agent principals', () => {
  it('joins actual trusted-client authentication and HTTP dispatch, including re-pairing and revocation', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-agent-principal-'));
    const clients = createRemoteClientAuthRuntime({ fsPromises: fs, path, crypto, storePath: path.join(directory, 'clients.json') });
    const auth = createUiAuth({ requireClientAuth: true, clientAuthController: clients });
    const operation = AGENT_OPERATION.GET_DEFAULT_MODEL;
    const identity = { family: 'cagent', connectionID: 'c', epoch: 1, adapterRevision: 'r', capabilityRevision: 'v' };
    let calls = 0;
    const dispatcher = createAgentDispatcher({ getBinding: () => ({
      identity, ready: true, authorized: true,
      capabilities: { [operation]: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['synthetic'] } },
      acceptance: { adapterRevision: 'r', capabilityRevision: 'v', operations: [operation] },
      handlers: { [operation]: async () => { calls += 1; return { modelID: null }; } },
    }) });
    const app = express();
    app.use('/api', auth.requireAuth);
    registerAgentRoutes(app, { dispatcher, resolvePrincipal: createAgentPrincipalResolver({ getUiAuth: () => auth }) });
    try {
      const first = await clients.createClient({ label: 'test', dedupeKey: 'device' });
      const inspected = await request(app).get(AGENT_ROUTE.RUNTIME).set('Authorization', `Bearer ${first.token}`).expect(200);
      const scoped = inspected.body.identity;
      expect(scoped.principalID).toMatch(/^principal-[a-f0-9]{64}$/);
      const body = { operation, identity: scoped, input: { workspaceID: 'w' } };
      await request(app).post(AGENT_ROUTE.DISPATCH).set('Authorization', `Bearer ${first.token}`).send(body).expect(200);
      const replacement = await clients.createClient({ label: 'test', dedupeKey: 'device' });
      expect(replacement.client.id).not.toBe(first.client.id);
      const next = await request(app).get(AGENT_ROUTE.RUNTIME).set('Authorization', `Bearer ${replacement.token}`).expect(200);
      expect(next.body.identity.principalID).not.toBe(scoped.principalID);
      await request(app).post(AGENT_ROUTE.DISPATCH).set('Authorization', `Bearer ${replacement.token}`).send(body).expect(409, { error: AGENT_ERROR.CHANGED });
      expect(calls).toBe(1);
      await request(app).get(AGENT_ROUTE.RUNTIME).set('Authorization', `Bearer ${first.token}`).set('Cookie', 'oc_ui_session=forged').expect(401);
      await clients.revokeClient(replacement.client.id);
      await request(app).get(AGENT_ROUTE.RUNTIME).set('Authorization', `Bearer ${replacement.token}`).expect(401);
    } finally { auth.dispose(); await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('uses the authenticated client ID across token rotation and separates sessions', async () => {
    let context = { type: 'client', clientId: 'device-a', token: 'first-secret' };
    const resolve = createAgentPrincipalResolver({ getUiAuth: () => ({ resolveVerifiedAuthContext: async () => context }) });
    const first = await resolve({});
    context = { ...context, token: 'rotated-secret' };
    expect(await resolve({})).toBe(first);
    context = { type: 'client', clientId: 'device-b', token: 'first-secret' };
    expect(await resolve({})).not.toBe(first);
    context = { type: 'session', token: 'first-secret' };
    const session = await resolve({});
    expect(session).not.toBe(first);
    expect(session).toMatch(/^principal-[a-f0-9]{64}$/);
    expect(session).not.toContain('secret');
    context = { type: 'session', token: 'another-session' };
    expect(await resolve({})).not.toBe(session);
  });

  it('refuses missing verification and client identity without trusting request fields', async () => {
    for (const context of [null, { type: 'client', clientId: null }, { type: 'session', token: '' }, { type: 'other', token: 'x' }]) {
      const resolve = createAgentPrincipalResolver({ getUiAuth: () => ({ resolveVerifiedAuthContext: async () => context }) });
      expect(await resolve({ principalID: 'forged', headers: { cookie: 'unverified' } })).toBeNull();
    }
    expect(await createAgentPrincipalResolver({ getUiAuth: () => null })({})).toBeNull();
  });
});
