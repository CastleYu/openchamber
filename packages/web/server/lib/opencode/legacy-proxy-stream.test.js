import express from 'express';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerOpenCodeProxy } from './proxy.js';
import { OPENCODE_PROFILE } from './compatibility.js';
import { AGENT_ERROR } from '../agent/constants.js';

const listen = (app) => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
const origin = server => 'http://127.0.0.1:' + server.address().port;
const exact = { generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY, version: '1.2.27', endpoint: 'http://upstream.test', epoch: 1 };

describe('Legacy SSE proxy admission', () => {
  const servers = [];
  const controllers = [];
  afterEach(async () => {
    for (const ctl of controllers.splice(0)) ctl.abort();
    for (const server of servers.splice(0).reverse()) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  const setup = async (getDescriptor, headers = () => ({}), onPath = () => {}) => {
    const upstream = express();
    upstream.use((req, res) => {
      onPath(req);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"session.status","properties":{"sessionID":"s","status":{"type":"busy"}}}\n\n');
    });
    const target = await listen(upstream); servers.push(target);
    const app = express();
    let prefixes = 0;
    registerOpenCodeProxy(app, {
      fs: {}, os: {}, path, OPEN_CODE_READY_GRACE_MS: 6000,
      getRuntime: () => ({ openCodePort: target.address().port, isOpenCodeReady: true }),
      getKernelRuntime: getDescriptor, getOpenCodeAuthHeaders: headers,
      buildOpenCodeUrl: route => origin(target) + route,
      ensureOpenCodeApiPrefix: () => { prefixes++; },
      readWorktreeBootstrapStatus: async () => ({ status: 'ready' }),
    });
    const host = await listen(app); servers.push(host);
    return { host, prefixes: () => prefixes };
  };
  for (const route of ['/event', '/global/event']) it('forwards exact ' + route + ' preserving directory and headers', async () => {
    const requests = [];
    const { host } = await setup(() => exact, () => ({ Authorization: 'Basic isolated-fixture' }), req => requests.push({ url: req.url, method: req.method, auth: req.get('authorization'), last: req.get('last-event-id') }));
    const ctl = new AbortController(); controllers.push(ctl);
    const response = await fetch(origin(host) + '/api' + route + '?directory=' + encodeURIComponent('/repo one'), { headers: { 'last-event-id': 'cursor-1' }, signal: ctl.signal });
    expect(response.status).toBe(200);
    const reader = response.body.getReader();
    let text = '';
    while (!text.includes('session.status')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('"sessionID":"s"');
    expect(requests).toEqual([{ url: route + '?directory=%2Frepo%20one', method: 'GET', auth: 'Basic isolated-fixture', last: 'cursor-1' }]);
    ctl.abort(); await reader.cancel().catch(() => {});
  });
  it.each([
    ['wrong version', { ...exact, version: '1.2.28' }, 'GET', '/global/event'],
    ['missing version', { ...exact, version: undefined }, 'GET', '/event'],
    ['wrong generation', { ...exact, generation: 'oc2' }, 'GET', '/event'],
    ['mutation', exact, 'POST', '/event'],
    ['unknown route', exact, 'GET', '/global/event/other'],
    ['unaccepted session create', exact, 'POST', '/session'],
    ['unaccepted session update', exact, 'PATCH', '/session/s'],
  ])('refuses %s before upstream credentials or prefix work', async (_label, descriptor, method, route) => {
    let credentials = 0; let requests = 0;
    const { host, prefixes } = await setup(() => descriptor, () => { credentials++; return {}; }, () => { requests++; });
    const response = await fetch(origin(host) + '/api' + route, { method });
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: AGENT_ERROR.UNACCEPTED, profile: OPENCODE_PROFILE.LEGACY });
    expect(credentials).toBe(0); expect(requests).toBe(0); expect(prefixes()).toBe(0);
  });
});
