import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AGENT_ATTEMPT, AGENT_ERROR, AGENT_FAMILY, AGENT_FEATURE, AGENT_MUTATIONS, AGENT_OPERATION, AGENT_ROUTE, AGENT_SUPPORT } from './constants.js';
import { createAgentDispatcher } from './dispatcher.js';
import { createAgentAttempts } from './attempts.js';
import { registerAgentRoutes } from './routes.js';
import { createAgentFeatures } from './features.js';

const identity = {
  family: AGENT_FAMILY.CAGENT, connectionID: 'test-connection', epoch: 1,
  adapterRevision: 'test-adapter', capabilityRevision: 'test-capability',
};
const envelope = (patch = {}) => ({
  operation: AGENT_OPERATION.GET_SESSION, identity,
  input: { workspaceID: 'w1', sessionID: 's1' }, ...patch,
});
const fixture = (patch = {}, { attempts, getHostSupport } = {}) => {
  const handler = vi.fn(async () => ({ id: 's1', workspaceID: 'w1' }));
  const binding = {
    identity, ready: true, authorized: true,
    capabilities: { [AGENT_OPERATION.GET_SESSION]: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['test-only'] } },
    acceptance: { adapterRevision: identity.adapterRevision, capabilityRevision: identity.capabilityRevision,
      operations: [AGENT_OPERATION.GET_SESSION] },
    handlers: { [AGENT_OPERATION.GET_SESSION]: handler }, ...patch,
  };
  const getBinding = vi.fn(() => binding);
  const app = express();
  // Deliberately no global body parser. The owning route must parse its body.
  app.use('/api', (req, res, next) => req.get('x-test-auth') === 'accepted'
    ? next() : res.status(401).json({ error: 'test-auth-required' }));
  const dispatcher = createAgentDispatcher({ getBinding, attempts });
  registerAgentRoutes(app, { dispatcher, features: createAgentFeatures({ getRuntime: dispatcher.describeRuntime, getHostSupport }) });
  const fallback = vi.fn((_req, res) => res.status(418).end());
  app.use('/api', fallback);
  return { app, handler, getBinding, fallback, binding };
};
const post = (app, body) => request(app).post(AGENT_ROUTE.DISPATCH).set('x-test-auth', 'accepted').send(body);
const attemptPost = (app, body) => request(app).post(AGENT_ROUTE.ATTEMPT).set('x-test-auth', 'accepted').send(body);
const tempAttempts = async (fn) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-agent-attempt-'));
  try { await fn(createAgentAttempts({ directory }), directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
};
const mutationBinding = (handler, operation = AGENT_OPERATION.SEND_PROMPT, patch = {}) => ({
  identity, ready: true, authorized: true,
  capabilities: { [operation]: { state: AGENT_SUPPORT.SUPPORTED, evidence: ['test-only'] } },
  acceptance: { adapterRevision: identity.adapterRevision, capabilityRevision: identity.capabilityRevision,
    operations: [operation] },
  handlers: { [operation]: handler }, ...patch,
});
const mutationEnvelope = (requestID = 'request-1') => ({
  operation: AGENT_OPERATION.SEND_PROMPT, identity,
  input: { workspaceID: 'w1', sessionID: 's1', requestID, text: 'hello' },
});

describe('owned agent HTTP routes', () => {
  it('requires host authentication before reading authority or calling handlers', async () => {
    const { app, handler, getBinding } = fixture();
    await request(app).post(AGENT_ROUTE.DISPATCH).send(envelope()).expect(401);
    await request(app).get(AGENT_ROUTE.RUNTIME).expect(401);
    await request(app).post(AGENT_ROUTE.ATTEMPT).send({ identity, requestID: 'r1' }).expect(401);
    expect(getBinding).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('parses and dispatches a supported read over HTTP', async () => {
    const { app, handler } = fixture();
    const response = await post(app, envelope()).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ identity, data: { id: 's1', workspaceID: 'w1' } });
    expect(handler).toHaveBeenCalledWith({ workspaceID: 'w1', sessionID: 's1' }, identity);
  });

  it('serializes typed message parts without inventing optional observations', async () => {
    const operation = AGENT_OPERATION.GET_MESSAGE;
    const message = {
      id: 'm1', sessionID: 's1', role: 'assistant', state: 'unknown',
      parts: [
        { id: 'r1', type: 'reasoning', text: 'Reasoning' },
        { id: 't1', type: 'tool', callID: 'c1', name: 'read', state: { status: 'complete', output: null } },
        { id: 'p1', type: 'text', text: 'Response' },
      ],
    };
    const { app } = fixture(mutationBinding(async () => message, operation));
    const response = await post(app, envelope({ operation, input: { workspaceID: 'w1', sessionID: 's1', messageID: 'm1' } })).expect(200);
    expect(response.body).toEqual({ identity, data: message });
    expect(response.body.data).not.toHaveProperty('model');
    expect(response.body.data).not.toHaveProperty('usage');
    expect(response.body.data).not.toHaveProperty('time');
  });

  it('refuses message results from another session at the authenticated boundary', async () => {
    const operation = AGENT_OPERATION.GET_MESSAGE;
    const { app, fallback } = fixture(mutationBinding(async () => ({
      id: 'm1', sessionID: 'other', role: 'assistant', state: 'unknown', parts: [],
    }), operation));
    const response = await post(app, envelope({ operation, input: { workspaceID: 'w1', sessionID: 's1', messageID: 'm1' } })).expect(502);
    expect(response.body).toEqual({ error: AGENT_ERROR.INVALID_RESPONSE });
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    { identity: undefined }, { identity: { ...identity, extra: true } },
    { operation: 'unknown' }, { extra: true }, { input: { sessionID: 's1' } },
    { input: { workspaceID: 'w1', sessionID: 's1', secret: 'unexpected' } },
  ])('rejects malformed envelopes and operation inputs without effects: %j', async (patch) => {
    const { app, handler } = fixture();
    const response = await post(app, envelope(patch)).expect(400);
    expect(response.body).toEqual({ error: AGENT_ERROR.INVALID_INPUT });
    expect(handler).not.toHaveBeenCalled();
  });

  it('owns malformed JSON errors without leaking the parser message', async () => {
    const { app, handler, fallback } = fixture();
    const response = await request(app).post(AGENT_ROUTE.DISPATCH).set('x-test-auth', 'accepted')
      .set('Content-Type', 'application/json').send('{"secret":').expect(400);
    expect(response.body).toEqual({ error: AGENT_ERROR.INVALID_INPUT });
    expect(handler).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(AGENT_MUTATIONS)('refuses unverified %s without effects', async (operation) => {
    const { app, getBinding } = fixture({ capabilities: {}, handlers: {} });
    const response = await post(app, envelope({ operation })).expect(501);
    expect(response.body).toEqual({ error: AGENT_ERROR.UNVERIFIED });
    expect(getBinding).toHaveBeenCalled();
  });

  it('accepts a mutation once and persists its receipt across dispatcher instances', async () => {
    await tempAttempts(async (attempts, directory) => {
      const handler = vi.fn(async () => ({ state: 'accepted', requestID: 'request-1' }));
      const binding = mutationBinding(handler);
      const getBinding = () => binding;
      const app = express();
      app.use('/api', (req, res, next) => req.get('x-test-auth') === 'accepted' ? next() : res.sendStatus(401));
      registerAgentRoutes(app, { dispatcher: createAgentDispatcher({ getBinding, attempts }) });
      const accepted = await post(app, mutationEnvelope()).expect(200);
      expect(accepted.body).toEqual({ identity, data: { state: 'accepted', requestID: 'request-1' } });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(await attempts.read(identity, 'request-1')).toMatchObject({ operation: AGENT_OPERATION.SEND_PROMPT, state: AGENT_ATTEMPT.ACCEPTED });

      const restarted = express();
      restarted.use('/api', (req, res, next) => req.get('x-test-auth') === 'accepted' ? next() : res.sendStatus(401));
      registerAgentRoutes(restarted, { dispatcher: createAgentDispatcher({ getBinding, attempts: createAgentAttempts({ directory }) }) });
      const duplicate = await post(restarted, mutationEnvelope()).expect(409);
      expect(duplicate.body).toEqual({ error: AGENT_ERROR.ATTEMPT_EXISTS });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  it('looks up present and missing attempts using strict body-only input', async () => {
    await tempAttempts(async (attempts) => {
      const record = await attempts.begin(identity, AGENT_OPERATION.SEND_PROMPT, 'saved-1');
      await record.finish(AGENT_ATTEMPT.ACCEPTED);
      const { app } = fixture({}, { attempts });
      const found = await attemptPost(app, { identity, requestID: 'saved-1' }).expect(200);
      expect(found.body).toEqual({ identity, attempt: expect.objectContaining({ requestID: 'saved-1', state: AGENT_ATTEMPT.ACCEPTED }) });
      expect((await attemptPost(app, { identity, requestID: 'missing-1' }).expect(200)).body)
        .toEqual({ identity, attempt: null });
      expect((await attemptPost(app, { identity, requestID: 'missing-1', extra: true }).expect(400)).body)
        .toEqual({ error: AGENT_ERROR.INVALID_INPUT });
      expect((await request(app).post(`${AGENT_ROUTE.ATTEMPT}?requestID=missing-1`).set('x-test-auth', 'accepted').send({ identity }).expect(400)).body)
        .toEqual({ error: AGENT_ERROR.INVALID_INPUT });
    });
  });

  it('reports an unknown outcome when a handler ran but its acknowledgement was lost', async () => {
    await tempAttempts(async (attempts) => {
      const handler = vi.fn(async () => { throw new Error('ack lost'); });
      const { app } = fixture(mutationBinding(handler), { attempts });
      expect((await post(app, mutationEnvelope()).expect(409)).body).toEqual({ error: AGENT_ERROR.UNKNOWN_OUTCOME });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(await attempts.read(identity, 'request-1')).toMatchObject({ state: AGENT_ATTEMPT.UNKNOWN });
      expect((await attemptPost(app, { identity, requestID: 'request-1' }).expect(200)).body.attempt)
        .toMatchObject({ state: AGENT_ATTEMPT.UNKNOWN });
    });
  });

  it('refuses a valid mutation when durable attempt storage is absent', async () => {
    const handler = vi.fn(async () => ({ state: 'accepted', requestID: 'request-1' }));
    const { app } = fixture(mutationBinding(handler));
    expect((await post(app, mutationEnvelope()).expect(503)).body).toEqual({ error: AGENT_ERROR.WRITE_UNAVAILABLE });
    expect(handler).not.toHaveBeenCalled();
  });

  it('masks corrupt attempt records behind a fixed refusal code', async () => {
    await tempAttempts(async (attempts, directory) => {
      const reservation = await attempts.begin(identity, AGENT_OPERATION.SEND_PROMPT, 'corrupt-1');
      await reservation.finish(AGENT_ATTEMPT.ACCEPTED);
      const [filename] = await fs.readdir(directory);
      await fs.writeFile(path.join(directory, filename), 'credential=hidden\n');
      const { app } = fixture({}, { attempts });
      expect((await attemptPost(app, { identity, requestID: 'corrupt-1' }).expect(503)).body)
        .toEqual({ error: AGENT_ERROR.ATTEMPT_CORRUPT });
    });
  });

  it('denies attempt lookup before storage access when authorization is absent', async () => {
    const attempts = { read: vi.fn() };
    const { app } = fixture({ authorized: false }, { attempts });
    expect((await attemptPost(app, { identity, requestID: 'request-1' }).expect(403)).body)
      .toEqual({ error: AGENT_ERROR.UNAUTHORIZED });
    expect(attempts.read).not.toHaveBeenCalled();
  });

  it('rejects stale expected identity before attempt lookup', async () => {
    const attempts = { read: vi.fn() };
    const { app } = fixture({}, { attempts });
    const oldIdentity = { ...identity, epoch: 0 };
    expect((await attemptPost(app, { identity: oldIdentity, requestID: 'request-1' }).expect(409)).body)
      .toEqual({ error: AGENT_ERROR.CHANGED });
    expect(attempts.read).not.toHaveBeenCalled();
  });

  it('rechecks current identity after attempt lookup', async () => {
    const attempts = { read: vi.fn(async () => null) };
    const { app, binding } = fixture({}, { attempts });
    attempts.read.mockImplementationOnce(async () => {
      binding.identity = { ...identity, epoch: 2 };
      return null;
    });
    expect((await attemptPost(app, { identity, requestID: 'request-1' }).expect(409)).body)
      .toEqual({ error: AGENT_ERROR.CHANGED });
    expect(attempts.read).toHaveBeenCalledTimes(1);
  });

  it.each([
    [AGENT_SUPPORT.UNVERIFIED, AGENT_ERROR.UNVERIFIED],
    [AGENT_SUPPORT.UNSUPPORTED, AGENT_ERROR.UNSUPPORTED],
  ])('preserves %s as a refusal rather than empty success', async (state, code) => {
    const { app, handler } = fixture({ capabilities: { [AGENT_OPERATION.GET_SESSION]: { state, evidence: [] } } });
    expect((await post(app, envelope()).expect(501)).body).toEqual({ error: code });
    expect(handler).not.toHaveBeenCalled();
  });

  it('requires host acceptance even when an adapter claims support', async () => {
    const { app, handler } = fixture({ acceptance: null });
    expect((await post(app, envelope()).expect(501)).body).toEqual({ error: AGENT_ERROR.UNACCEPTED });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects old backend identity before effects', async () => {
    const { app, handler } = fixture();
    expect((await post(app, envelope({ identity: { ...identity, epoch: 0 } })).expect(409)).body)
      .toEqual({ error: AGENT_ERROR.CHANGED });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns only validated runtime identity', async () => {
    const { app } = fixture();
    const response = await request(app).get(AGENT_ROUTE.RUNTIME).set('x-test-auth', 'accepted').expect(200);
    expect(response.body.identity).toEqual(identity);
    expect(Object.keys(response.body.operations).sort()).toEqual(Object.values(AGENT_OPERATION).sort());
    expect(response.body.operations[AGENT_OPERATION.GET_SESSION]).toEqual({ available: true });
    expect(response.body.operations[AGENT_OPERATION.SEND_PROMPT])
      .toEqual({ available: false, reason: AGENT_ERROR.UNVERIFIED });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('keeps the complete feature snapshot authenticated and closed until host migration', async () => {
    const { app, handler, fallback } = fixture();
    await request(app).get(AGENT_ROUTE.FEATURES).expect(401);
    const response = await request(app).get(AGENT_ROUTE.FEATURES).set('x-test-auth', 'accepted').expect(200);
    expect(response.body.identity).toEqual(identity);
    expect(Object.keys(response.body.features).sort()).toEqual(Object.values(AGENT_FEATURE).sort());
    for (const availability of Object.values(response.body.features)) {
      expect(availability).toEqual({ available: false, reason: AGENT_ERROR.UNMIGRATED });
    }
    expect(response.headers['cache-control']).toBe('no-store');
    expect(handler).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('combines accepted operations and current host support without running handlers', async () => {
    let implemented = [AGENT_FEATURE.ACQUIRE_SESSION, AGENT_FEATURE.MESSAGE];
    const { app, handler } = fixture({}, { getHostSupport: () => ({ identity, implemented }) });
    const get = () => request(app).get(AGENT_ROUTE.FEATURES).set('x-test-auth', 'accepted');
    const response = await get().expect(200);
    expect(response.body.features[AGENT_FEATURE.ACQUIRE_SESSION]).toEqual({ available: true });
    expect(response.body.features[AGENT_FEATURE.MESSAGE]).toEqual({ available: false, reason: AGENT_ERROR.UNVERIFIED });
    implemented = [];
    expect((await get().expect(200)).body.features[AGENT_FEATURE.ACQUIRE_SESSION])
      .toEqual({ available: false, reason: AGENT_ERROR.UNMIGRATED });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects stale feature support and hides host-port exception text', async () => {
    const stale = fixture({}, { getHostSupport: () => ({ identity: { ...identity, epoch: 0 }, implemented: [] }) });
    expect((await request(stale.app).get(AGENT_ROUTE.FEATURES).set('x-test-auth', 'accepted').expect(409)).body)
      .toEqual({ error: AGENT_ERROR.CHANGED });
    const failed = fixture({}, { getHostSupport: () => { throw new Error('secret=host-data'); } });
    expect((await request(failed.app).get(AGENT_ROUTE.FEATURES).set('x-test-auth', 'accepted').expect(503)).body)
      .toEqual({ error: AGENT_ERROR.UNAVAILABLE });
  });

  it('refuses feature access when its owner is not composed', async () => {
    const app = express();
    registerAgentRoutes(app, { dispatcher: createAgentDispatcher({ getBinding: () => null }) });
    expect((await request(app).get(AGENT_ROUTE.FEATURES).expect(503)).body).toEqual({ error: AGENT_ERROR.UNAVAILABLE });
    await request(app).post(AGENT_ROUTE.FEATURES).expect(404);
  });

  it('reports an inactive production-style binding as unavailable', async () => {
    const app = express();
    registerAgentRoutes(app, { dispatcher: createAgentDispatcher({ getBinding: () => null }) });
    expect((await request(app).get(AGENT_ROUTE.RUNTIME).expect(503)).body).toEqual({ error: AGENT_ERROR.UNAVAILABLE });
    expect((await request(app).post(AGENT_ROUTE.DISPATCH).send(envelope()).expect(503)).body)
      .toEqual({ error: AGENT_ERROR.UNAVAILABLE });
  });

  it('does not expose adapter exceptions or malformed backend output', async () => {
    const { app, handler } = fixture();
    handler.mockRejectedValueOnce(new Error('credential=wire-secret'));
    expect((await post(app, envelope()).expect(502)).body).toEqual({ error: AGENT_ERROR.BACKEND_FAILED });
    handler.mockResolvedValueOnce({ id: 's1', workspaceID: 'w1', credential: 'wire-secret' });
    expect((await post(app, envelope()).expect(502)).body).toEqual({ error: AGENT_ERROR.INVALID_RESPONSE });
  });

  it('terminates unknown owned paths and methods before generic proxy fallback', async () => {
    const { app, fallback } = fixture();
    await request(app).get(`${AGENT_ROUTE.PREFIX}/unknown`).set('x-test-auth', 'accepted').expect(404);
    await request(app).put(AGENT_ROUTE.DISPATCH).set('x-test-auth', 'accepted').expect(404);
    expect(fallback).not.toHaveBeenCalled();
    await request(app).get('/api/unrelated').set('x-test-auth', 'accepted').expect(418);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
