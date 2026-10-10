import { afterAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { CONNECTION_TEST, createConnectionTest } from './connection-test.js';
import { prepareOpenCodeConnection } from './connection.js';
import { registerOpenCodeRoutes } from './routes.js';
import express from 'express';
import request from 'supertest';

const calls = [];
let version = '2.0.20';
let auth = false;
let hang = false;
let redirect = false;
let closedProbes = 0;
const server = http.createServer((req, res) => {
  calls.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
  if (hang) { res.on('close', () => closedProbes++); return; }
  if (redirect) { res.writeHead(302, { Location: '/redirected' }); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  if (auth && req.headers.authorization !== 'Basic owner') { res.writeHead(401); res.end('{}'); return; }
  if (req.url === '/base/global/health') res.end(JSON.stringify({ healthy: true, version }));
  else if (req.url === '/base/api/info') res.end(JSON.stringify({ version }));
  else if (req.url === '/base/session/status') res.end('{}');
  else res.end('[]');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = 'http://127.0.0.1:' + server.address().port + '/base';
afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const external = { version: 1, confirmed: true, mode: 'external', endpoint };
const setup = () => {
  const context = { family: 'opencode', owner: '1', endpoint, selection: 'auto', headersForGeneration: () => ({ Authorization: 'Basic owner' }) };
  let validations = 0;
  const tester = createConnectionTest({ getContext: () => context, prepareConnection: value => {
    validations++;
    return prepareOpenCodeConnection(value, { resolveBinary: () => path.resolve('opencode.exe'), resolveLaunchSpec: binary => ({ binary, args: [] }), stat: async () => ({ isDirectory: () => true }), env: { SOURCE: 'secret-value' } });
  } });
  return { context, tester, validations: () => validations };
};
const input = connection => ({ token: randomUUID(), connection });

describe('read-only host connection tests', () => {
  it.each(['path', 'configured', 'bundled', 'command'])('validates %s without executing or probing', async mode => {
    const { tester } = setup(); calls.length = 0;
    const connection = mode === 'command' ? { version:1, confirmed:true, mode, exe:path.resolve('opencode.exe'), args:['serve'], cwd:path.resolve('.'), env:[{name:'CUSTOM',ref:'SOURCE'}] }
      : mode === 'configured' ? {version:1,confirmed:true,mode,exe:path.resolve('opencode.exe')} : {version:1,confirmed:true,mode};
    expect(await tester.test(input(connection))).toEqual({ kind: 'launch', status: 'validated', binary: path.resolve('opencode.exe') });
    expect(calls).toEqual([]);
  });
  it.each([['1.18.33','oc1'], ['2.0.20','oc2'], ['1.2.27','legacy-1.2.27']])('probes actual HTTP %s without activation', async (value, profile) => {
    version = value; calls.length = 0;
    const { tester, context } = setup();
    expect(await tester.test(input(external))).toEqual({ kind:'endpoint', status:'ready', selection:'auto', version:value, profile });
    expect(calls.every(call => call.method === 'GET')).toBe(true);
    expect(context.owner).toBe('1');
    if (profile === 'legacy-1.2.27') expect(calls.some(call => call.path === '/base/api/info')).toBe(false);
  });
  it('keeps authentication, version mismatch and unsupported versions distinct', async () => {
    const { tester, context } = setup();
    auth = true; version = '2.0.20';
    expect((await tester.test(input(external))).status).toBe('ready');
    context.endpoint = 'http://another.test'; calls.length = 0;
    expect((await tester.test(input(external))).status).toBe('auth');
    expect(calls.every(call => !call.authorization)).toBe(true);
    auth = false; context.selection = 'oc1';
    expect((await tester.test(input(external))).status).toBe('mismatch');
    context.selection = 'auto'; version = '3.0.0';
    expect((await tester.test(input(external))).status).toBe('unsupported');
  });
  it('does not follow redirects or forward credentials to another target', async () => {
    const { tester, context } = setup(); context.endpoint = null; redirect = true; calls.length = 0;
    try {
      expect((await tester.test(input(external))).status).toBe('unreachable');
      expect(calls.every(call => !call.authorization && call.path !== '/redirected')).toBe(true);
    } finally { redirect = false; }
  });
  it('rejects CAgent and malformed inputs before candidate resolution or network I/O', async () => {
    const { tester, context, validations } = setup(); calls.length = 0; context.family = 'cagent';
    await expect(tester.test(input(external))).rejects.toMatchObject({ status:501 });
    context.family = 'opencode';
    await expect(tester.test({token:'bad',connection:external})).rejects.toMatchObject({status:400});
    await expect(tester.test(input({...external,endpoint:'https://name:secret@example.test'}))).rejects.toMatchObject({status:400});
    expect(validations()).toBe(1); expect(calls).toEqual([]);
  });
  it('cancels an active probe, rejects duplicates and permits a new test', async () => {
    const { tester } = setup(); const body = input(external); hang = true; calls.length = 0; const closed = closedProbes;
    const running = tester.test(body);
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    await expect(tester.test(body)).rejects.toMatchObject({ status:409 });
    tester.cancel(body);
    await expect(running).rejects.toMatchObject({ status:408 });
    await expect.poll(() => closedProbes).toBeGreaterThan(closed);
    hang = false; version = '2.0.20';
    expect((await tester.test(body)).status).toBe('ready');
    expect(tester.cancel(body)).toEqual({cancelled:true});
  });
  it('cancels on transport abort and rejects a retired host result', async () => {
    const { tester, context } = setup(); const controller = new AbortController(); hang = true;
    const running = tester.test(input(external), controller.signal); controller.abort();
    await expect(running).rejects.toMatchObject({status:408}); hang = false;
    let reads = 0;
    const stale = createConnectionTest({ getContext: () => ({...context,owner:String(++reads)}), prepareConnection: async () => external });
    calls.length = 0; await expect(stale.test(input(external))).rejects.toMatchObject({status:409}); expect(calls).toEqual([]);
  });
  it('completes a stalled HTTP probe within the host deadline', async () => {
    const { tester } = setup(); hang = true; calls.length = 0;
    const started = Date.now();
    try {
      expect((await tester.test(input(external))).status).toBe('unreachable');
      expect(Date.now() - started).toBeLessThan(CONNECTION_TEST.TIMEOUT_MS);
      expect(calls.length).toBeGreaterThan(0);
    } finally { hang = false; }
  }, 20000);
  it('rejects a completed probe after its owner retires', async () => {
    const { context } = setup(); let reads = 0; calls.length = 0;
    const tester = createConnectionTest({
      getContext: () => ({...context, owner: ++reads < 3 ? '1' : '2'}),
      prepareConnection: async () => external,
    });
    await expect(tester.test(input(external))).rejects.toMatchObject({status:409});
    expect(calls.length).toBeGreaterThan(0);
  });
  it('serves the explicit HTTP routes ahead of proxy and sanitizes failures', async () => {
    const { tester } = setup(); const app = express(); registerOpenCodeRoutes(app, { connectionTest:tester });
    app.use((_req,res) => res.status(418).end());
    const result = await request(app).post(CONNECTION_TEST.ROUTE).send(input(external)).expect(200);
    expect(result.body.profile).toBe('oc2'); expect(result.headers['cache-control']).toBe('no-store');
    await request(app).post(CONNECTION_TEST.ROUTE).send({token:'invalid'}).expect(400,{error:'connection_test_failed'});
    await request(app).post(CONNECTION_TEST.CANCEL_ROUTE).send({token:randomUUID()}).expect(200,{cancelled:true});
    const unsupported = express(); registerOpenCodeRoutes(unsupported, {});
    await request(unsupported).post(CONNECTION_TEST.ROUTE).send(input(external)).expect(501,{error:'unsupported_runtime'});
  });
});
