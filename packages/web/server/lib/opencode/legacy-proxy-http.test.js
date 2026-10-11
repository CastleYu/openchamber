import express from 'express';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerOpenCodeProxy } from './proxy.js';
import { OPENCODE_PROFILE } from './compatibility.js';
import { AGENT_ERROR } from '../agent/constants.js';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const origin = (server) => `http://127.0.0.1:${server.address().port}`;
const legacy = { generation: 'oc1', profile: OPENCODE_PROFILE.LEGACY, version: '1.2.27', endpoint: 'http://upstream.test', epoch: 1 };

describe('Legacy HTTP proxy admission', () => {
  const servers = [];
  afterEach(async () => {
    for (const server of servers.splice(0).reverse()) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  const setup = async (onRequest) => {
    const upstream = express();
    upstream.use(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      onRequest({ method: req.method, url: req.url, authorization: req.get('authorization'), contentType: req.get('content-type'), sdkFixture: req.get('x-sdk-fixture'), body: Buffer.concat(chunks).toString() });
      if (req.path.endsWith('/prompt_async')) return res.status(204).end();
      res.json({ ok: true });
    });
    const target = await listen(upstream); servers.push(target);
    const app = express();
    registerOpenCodeProxy(app, {
      fs: {}, os: {}, path, OPEN_CODE_READY_GRACE_MS: 6000,
      getRuntime: () => ({ openCodePort: target.address().port, isOpenCodeReady: true }),
      getKernelRuntime: () => legacy,
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer fixture-token' }),
      buildOpenCodeUrl: (route) => origin(target) + route,
      ensureOpenCodeApiPrefix: () => {},
      readWorktreeBootstrapStatus: async () => ({ status: 'ready' }),
    });
    const host = await listen(app); servers.push(host);
    return host;
  };

  it('forwards prompt, abort, and replies with request data and async 204 intact', async () => {
    const requests = [];
    const host = await setup((request) => requests.push(request));
    const cases = [
      ['/session/s1/prompt_async', 204, { parts: [{ type: 'text', text: 'hello' }] }],
      ['/session/s1/abort', 200, {}],
      ['/permission/p1/reply', 200, { reply: 'once' }],
      ['/question/q1/reply', 200, { reply: 'yes' }],
      ['/question/q1/reject', 200, {}],
    ];
    for (const [route, status, body] of cases) {
      const raw = JSON.stringify(body);
      const response = await fetch(origin(host) + '/api' + route + '?directory=%2Frepo', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-sdk-fixture': 'preserved' }, body: raw,
      });
      expect(response.status).toBe(status);
      if (status === 204) expect(await response.text()).toBe('');
      else expect(await response.json()).toEqual({ ok: true });
      expect(requests.at(-1)).toEqual({
        method: 'POST', url: route + '?directory=%2Frepo', authorization: 'Bearer fixture-token',
        contentType: 'application/json', sdkFixture: 'preserved', body: raw,
      });
    }
    expect(requests).toHaveLength(cases.length);
  });

  it('forwards an allowed bootstrap GET through the actual proxy', async () => {
    const requests = [];
    const host = await setup((request) => requests.push(request));
    const response = await fetch(origin(host) + '/api/global/config?directory=%2Frepo');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(requests).toEqual([{ method: 'GET', url: '/global/config?directory=%2Frepo', authorization: 'Bearer fixture-token', contentType: undefined, sdkFixture: undefined, body: '' }]);
  });

  it.each([
    ['POST', '/session'], ['PATCH', '/session/s1'], ['POST', '/unknown'], ['GET', '/session/s1/message/extra/more'],
  ])('rejects unknown or held-back %s %s before upstream fetch', async (method, route) => {
    let requests = 0;
    const host = await setup(() => { requests += 1; });
    const response = await fetch(origin(host) + '/api' + route, { method });
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: AGENT_ERROR.UNACCEPTED, profile: OPENCODE_PROFILE.LEGACY });
    expect(requests).toBe(0);
  });
});
