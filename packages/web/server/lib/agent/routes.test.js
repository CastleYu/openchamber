import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_MUTATIONS, AGENT_OPERATION, AGENT_ROUTE, AGENT_SUPPORT } from './constants.js';
import { createAgentDispatcher } from './dispatcher.js';
import { registerAgentRoutes } from './routes.js';

const identity = {
  family: AGENT_FAMILY.CAGENT, connectionID: 'test-connection', epoch: 1,
  adapterRevision: 'test-adapter', capabilityRevision: 'test-capability',
};
const envelope = (patch = {}) => ({
  operation: AGENT_OPERATION.GET_SESSION, identity,
  input: { workspaceID: 'w1', sessionID: 's1' }, ...patch,
});
const fixture = (patch = {}) => {
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
  registerAgentRoutes(app, { dispatcher: createAgentDispatcher({ getBinding }) });
  const fallback = vi.fn((_req, res) => res.status(418).end());
  app.use('/api', fallback);
  return { app, handler, getBinding, fallback };
};
const post = (app, body) => request(app).post(AGENT_ROUTE.DISPATCH).set('x-test-auth', 'accepted').send(body);

describe('owned agent HTTP routes', () => {
  it('requires host authentication before reading authority or calling handlers', async () => {
    const { app, handler, getBinding } = fixture();
    await request(app).post(AGENT_ROUTE.DISPATCH).send(envelope()).expect(401);
    await request(app).get(AGENT_ROUTE.RUNTIME).expect(401);
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

  it.each(AGENT_MUTATIONS)('keeps %s closed until durable attempts are integrated', async (operation) => {
    const { app, handler, getBinding } = fixture();
    const response = await post(app, envelope({ operation })).expect(503);
    expect(response.body).toEqual({ error: AGENT_ERROR.WRITE_UNAVAILABLE });
    expect(getBinding).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
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
    expect(response.body).toEqual({ identity });
    expect(response.headers['cache-control']).toBe('no-store');
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
