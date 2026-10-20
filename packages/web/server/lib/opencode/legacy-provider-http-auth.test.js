import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import request from 'supertest';
import { createLegacyProviderCaller } from './legacy-provider-http.js';
import { createRemoteClientAuthRuntime } from '../client-auth/remote-clients.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-provider-auth-'));
const previous = process.env.OPENCHAMBER_DATA_DIR;
process.env.OPENCHAMBER_DATA_DIR = root;
const { createUiAuth } = await import('../ui-auth/ui-auth.js');
afterAll(async () => {
  if (previous === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
  else process.env.OPENCHAMBER_DATA_DIR = previous;
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture(auth) {
  const app = express();
  app.use(express.json());
  const resolve = createLegacyProviderCaller({ getUiAuth: () => auth });
  app.post('/login', auth.handleSessionCreate);
  app.post('/caller', async (req, res) => {
    const caller = await resolve(req, res);
    if (res.headersSent) return;
    if (!caller) return res.status(401).json({ error: 'Authentication required' });
    return res.json({ caller });
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function close(server, auth) {
  auth.dispose();
  await new Promise(resolve => server.close(resolve));
}

describe('Legacy provider caller with actual UI authentication', () => {
  it('isolates trusted clients and rejects revoked credentials and forged cookies', async () => {
    const clients = createRemoteClientAuthRuntime({ fsPromises: fs, path, crypto, storePath: path.join(root, 'clients.json') });
    const auth = createUiAuth({ requireClientAuth: true, clientAuthController: clients });
    const app = await fixture(auth);
    try {
      await request(app).post('/caller').set('Cookie', 'oc_ui_session=forged').send({ caller: 'forged' }).expect(401);
      const first = await clients.createClient({ label: 'first' });
      const second = await clients.createClient({ label: 'second' });
      const a = await request(app).post('/caller').set('Authorization', 'Bearer ' + first.token).send({ caller: 'forged' }).expect(200);
      const b = await request(app).post('/caller').set('Authorization', 'Bearer ' + second.token).expect(200);
      const again = await request(app).post('/caller').set('Authorization', 'Bearer ' + first.token).set('Cookie', 'oc_ui_session=forged').expect(200);
      expect(a.body.caller).toMatch(/^[a-z-]+[a-f0-9]{64}$/);
      expect(again.body.caller).toBe(a.body.caller);
      expect(b.body.caller).not.toBe(a.body.caller);
      expect(JSON.stringify(a.body)).not.toContain(first.token);
      await clients.revokeClient(first.client.id);
      await request(app).post('/caller').set('Authorization', 'Bearer ' + first.token).set('Cookie', 'oc_ui_session=forged').expect(401);
    } finally { await close(app, auth); }
  });

  it('binds a verified password session and refuses an explicit invalid bearer', async () => {
    const auth = createUiAuth({ password: 'test-provider-password' });
    const app = await fixture(auth);
    try {
      await request(app).post('/caller').set('Cookie', 'oc_ui_session=forged').expect(401);
      const login = await request(app).post('/login').send({ password: 'test-provider-password' }).expect(200);
      const cookie = login.headers['set-cookie'][0].split(';')[0];
      const a = await request(app).post('/caller').set('Cookie', cookie).expect(200);
      const b = await request(app).post('/caller').set('Cookie', cookie).expect(200);
      expect(b.body.caller).toBe(a.body.caller);
      expect(JSON.stringify(a.body)).not.toContain(cookie.split('=')[1]);
      await request(app).post('/caller').set('Cookie', cookie).set('Authorization', 'Bearer invalid').expect(401);
    } finally { await close(app, auth); }
  });

  it('retains the existing unrestricted local policy with separate stable session cookies', async () => {
    const auth = createUiAuth({ password: '' });
    const app = await fixture(auth);
    const first = request.agent(app);
    const second = request.agent(app);
    try {
      const a = await first.post('/caller').expect(200);
      const again = await first.post('/caller').expect(200);
      const b = await second.post('/caller').expect(200);
      expect(again.body.caller).toBe(a.body.caller);
      expect(b.body.caller).not.toBe(a.body.caller);
      expect(JSON.stringify(a.body)).not.toContain('oc_ui_session');
    } finally { await close(app, auth); }
  });
});
