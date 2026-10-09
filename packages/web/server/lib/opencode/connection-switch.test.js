import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createConnectionSwitch } from './connection-switch.js';
import { CONNECTION_SWITCH, OpenCodeConnectionError } from './connection.js';
import { AGENT_FAMILY } from '../agent/constants.js';
import { registerOpenCodeRoutes } from './routes.js';

const old = { version: 1, confirmed: true, mode: 'external', endpoint: 'https://old.test' };
const next = { ...old, endpoint: 'https://next.test' };
const fixture = () => {
  let saved = old; let revision = 1; let epoch = 1; let ready = true; let external = false;
  let report = { busy: { state: 'known', count: 0 }, permissions: { state: 'known', count: 0 }, questions: { state: 'known', count: 0 }, clients: { state: 'unknown', observedCount: 0 }, queue: { state: 'known', count: 2, sending: 0 } };
  const selection = () => ({ family: AGENT_FAMILY.OPENCODE, revision: 1, connectionRevision: revision });
  const activity = { inspect: vi.fn(async () => report) };
  const prepareConnection = vi.fn(async record => ({ ...record, commandEnv: { PRIVATE_VALUE: 'never-public' } }));
  const saveConnection = vi.fn(async record => { saved = record; revision++; });
  const stopExternal = vi.fn();
  const lifecycle = { restartOpenCode: vi.fn(async (_reason, replacement) => {
    await replacement.resolve(); await replacement.beforeRetire(); ready = false; epoch++;
    await replacement.commit(); ready = true;
  }) };
  const owner = createConnectionSwitch({ activity, lifecycle, prepareConnection,
    readConnection: async () => saved, readPrevious: async () => old, saveConnection,
    getOwner: () => ({ ...selection(), epoch }), getSelection: selection,
    getState: () => ({ ready, external, transitioning: false }), stopExternal });
  return { owner, activity, lifecycle, prepareConnection, saveConnection, stopExternal,
    changeEpoch: () => { epoch++; }, setActivity: value => { report = { ...report, ...value }; },
    setExternal: () => { external = true; }, readSaved: () => saved };
};
const candidate = { source: CONNECTION_SWITCH.CANDIDATE, connection: next };
const confirm = token => ({ token, decision: CONNECTION_SWITCH.WAIT, acknowledgeClients: true });

describe('host confirmed connection owner', () => {
  it('previews without writing or revealing resolved environment, then commits the confirmed record', async () => {
    const f = fixture(); const preview = await f.owner.prepare(candidate);
    expect(preview.connection).toEqual(next); expect(JSON.stringify(preview)).not.toContain('never-public');
    expect(f.saveConnection).not.toHaveBeenCalled();
    expect(await f.owner.apply(confirm(preview.token))).toEqual({ state: CONNECTION_SWITCH.READY, connection: next });
    expect(f.prepareConnection).toHaveBeenCalledTimes(2); expect(f.readSaved()).toEqual(next);
    await expect(f.owner.apply(confirm(preview.token))).rejects.toMatchObject({ status: 409 });
  });
  it('requires explicit acknowledgement of unknown clients', async () => {
    const f = fixture(); const preview = await f.owner.prepare(candidate);
    await expect(f.owner.apply({ token: preview.token, decision: CONNECTION_SWITCH.WAIT })).rejects.toMatchObject({ status: 400 });
    expect(f.lifecycle.restartOpenCode).not.toHaveBeenCalled();
  });
  it.each([{ state: 'known', count: 1 }, { state: 'unknown', observedCount: 0 }])('wait preserves old target when busy activity is %j', async busy => {
    const f = fixture(); const preview = await f.owner.prepare(candidate); f.setActivity({ busy });
    await expect(f.owner.apply(confirm(preview.token))).rejects.toMatchObject({ status: 409 });
    expect(f.saveConnection).not.toHaveBeenCalled(); expect(f.readSaved()).toEqual(old);
  });
  it('wait permits later authoritative idle without reassigning queued intent', async () => {
    const f = fixture(); f.setActivity({ busy: { state: 'known', count: 1 } });
    const preview = await f.owner.prepare(candidate);
    f.setActivity({ busy: { state: 'known', count: 0 } });
    await f.owner.apply(confirm(preview.token)); expect(f.saveConnection).toHaveBeenCalledOnce();
    expect(preview.activity.queue.count).toBe(2);
  });
  it('rejects a stale owner before replacement starts', async () => {
    const f = fixture(); const preview = await f.owner.prepare(candidate); f.changeEpoch();
    await expect(f.owner.apply(confirm(preview.token))).rejects.toMatchObject({ status: 409 });
    expect(f.lifecycle.restartOpenCode).not.toHaveBeenCalled();
  });
  it('stops external work only after explicit stop confirmation', async () => {
    const f = fixture(); f.setExternal(); f.setActivity({ busy: { state: 'known', count: 1 } });
    const preview = await f.owner.prepare(candidate);
    await f.owner.apply({ ...confirm(preview.token), decision: CONNECTION_SWITCH.STOP });
    expect(f.stopExternal).toHaveBeenCalledOnce(); expect(f.readSaved()).toEqual(next);
  });
  it('unknown external activity cannot authorize interruption or replacement', async () => {
    const f = fixture(); f.setExternal(); f.setActivity({ busy: { state: 'unknown', observedCount: 1 } });
    const preview = await f.owner.prepare(candidate);
    await expect(f.owner.apply({ ...confirm(preview.token), decision: CONNECTION_SWITCH.STOP })).rejects.toMatchObject({ status: 409 });
    expect(f.stopExternal).not.toHaveBeenCalled(); expect(f.saveConnection).not.toHaveBeenCalled();
  });
  it('loads the saved previous target through the same explicit confirmation flow', async () => {
    const f = fixture(); const preview = await f.owner.prepare({ source: CONNECTION_SWITCH.PREVIOUS });
    expect(preview.connection).toEqual(old); expect(f.saveConnection).not.toHaveBeenCalled();
    await f.owner.apply(confirm(preview.token)); expect(f.readSaved()).toEqual(old);
  });
  it('failure to save stays a failed transition without selecting another target', async () => {
    const f = fixture(); f.saveConnection.mockRejectedValue(new Error('private write failure'));
    const preview = await f.owner.prepare(candidate);
    await expect(f.owner.apply(confirm(preview.token))).rejects.toThrow('private write failure');
    expect(f.readSaved()).toEqual(old);
  });
});

describe('host connection confirmation HTTP routes', () => {
  it('parses and invokes the owner, refuses a request before host authentication and avoids caches', async () => {
    const f = fixture(); const app = express();
    app.use((req, res, nextHandler) => req.headers.authorization === 'Bearer fixture-only' ? nextHandler() : res.sendStatus(401));
    registerOpenCodeRoutes(app, { connectionSwitch: f.owner });
    await request(app).post(CONNECTION_SWITCH.PREPARE_ROUTE).send(candidate).expect(401);
    expect(f.prepareConnection).not.toHaveBeenCalled();
    const preview = await request(app).post(CONNECTION_SWITCH.PREPARE_ROUTE).set('Authorization', 'Bearer fixture-only').send(candidate).expect(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    await request(app).post(CONNECTION_SWITCH.APPLY_ROUTE).set('Authorization', 'Bearer fixture-only').send(confirm(preview.body.token)).expect(200);
    const previous = await request(app).get(CONNECTION_SWITCH.PREVIOUS_ROUTE).set('Authorization', 'Bearer fixture-only').expect(200);
    expect(previous.body).toEqual({ connection: old });
  });
  it('returns stable unsupported status without a host owner', async () => {
    const app = express(); registerOpenCodeRoutes(app, {});
    await request(app).post(CONNECTION_SWITCH.PREPARE_ROUTE).send(candidate).expect(501);
    await request(app).post(CONNECTION_SWITCH.APPLY_ROUTE).send({}).expect(501);
    await request(app).get(CONNECTION_SWITCH.PREVIOUS_ROUTE).expect(501);
  });
  it('masks raw persistence failures at the HTTP boundary', async () => {
    const f = fixture(); f.saveConnection.mockRejectedValue(new Error('secret-host-path'));
    const app = express(); registerOpenCodeRoutes(app, { connectionSwitch: f.owner });
    const preview = await request(app).post(CONNECTION_SWITCH.PREPARE_ROUTE).send(candidate).expect(200);
    const failed = await request(app).post(CONNECTION_SWITCH.APPLY_ROUTE).send(confirm(preview.body.token)).expect(503);
    expect(failed.body).toEqual({ error: 'connection_failed' });
  });
});
