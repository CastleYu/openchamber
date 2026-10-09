import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectOpenCodeGeneration,
  detectOpenCodeProfile,
  OPENCODE_SELECTION,
  OPENCODE_PROFILE,
  PROFILE_STATUS,
  isSupportedOpenCodeVersion,
  supportsCredentialApi,
  OPENCODE_GENERATION,
  readOpenCodeInfo,
} from './compatibility.js';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

const serve = async (routes, requests = []) => {
  const server = createServer((req, res) => {
    requests.push({ path: req.url, method: req.method, accept: req.headers.accept, auth: req.headers.authorization });
    const reply = routes[req.url] ?? { status: 404, body: { error: 'missing' } };
    res.writeHead(reply.status ?? 200, { 'Content-Type': reply.type ?? 'application/json' });
    res.end(reply.type === 'text/html' ? reply.body : JSON.stringify(reply.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

const health = (version, healthy = true) => ({ body: { healthy, version } });
const info = (version) => ({ body: { version } });

describe('OpenCode generation detection', () => {
  it.each(['1.2.27', 'v1.2.27', '1.2.27+build.1'])('does not forward credentials to the undeclared info route on %s', async (version) => {
    const requests = [];
    const endpoint = await serve({ '/global/health': health(version) }, requests);
    const result = await detectOpenCodeGeneration({ endpoint, epoch: 9, headers: { Authorization: 'Basic isolated-fixture' } });
    expect(result).toEqual({ generation: OPENCODE_GENERATION.OC1, endpoint, epoch: 9, version: version.replace(/^v/, '') });
    expect(requests).toEqual([{ path: '/global/health', method: 'GET', accept: 'application/json', auth: 'Basic isolated-fixture' }]);
  });

  it('keeps an unverified 1.2.27 prerelease on the ordinary comparison path', async () => {
    const requests = [];
    const endpoint = await serve({ '/global/health': health('1.2.27-rc.1'), '/api/info': info('2.0.20') }, requests);
    expect((await detectOpenCodeGeneration({ endpoint, epoch: 9 })).generation).toBe(OPENCODE_GENERATION.UNKNOWN);
    expect(requests.map(request => request.path)).toEqual(['/global/health', '/api/info']);
  });
  it('uses each generation credential and accepts only its authenticated protocol response', async () => {
    for (const generation of ['oc1', 'oc2']) {
      const calls = [];
      const fetchImpl = async (url, options) => {
        calls.push([new URL(url).pathname, options.headers.get('Authorization')]);
        if (generation === 'oc1' && url.endsWith('/global/health')) return Response.json({ healthy: true, version: '1.18.32' });
        if (generation === 'oc2' && url.endsWith('/api/info')) return Response.json({ version: '2.0.20' });
        return new Response(null, { status: 401 });
      };
      const result = await detectOpenCodeGeneration({ endpoint: 'http://kernel.test', epoch: 1, fetchImpl,
        headersForGeneration: (candidate) => ({ Authorization: candidate === 'oc1' ? 'Basic legacy-fixture' : 'Basic current-fixture' }) });
      expect(result.generation).toBe(generation);
      expect(calls).toContainEqual(['/global/health', 'Basic legacy-fixture']);
      expect(calls).toContainEqual(['/api/info', 'Basic current-fixture']);
    }
  });
  it('accepts OC1 health even when its /api/info fallback is HTML', async () => {
    const requests = [];
    const endpoint = await serve({
      '/global/health': health('1.18.32'),
      '/api/info': { type: 'text/html', body: '<!doctype html><title>OpenCode</title>' },
    }, requests);
    expect(await detectOpenCodeGeneration({ endpoint, epoch: 7, headers: { Authorization: 'Basic fixture' } }))
      .toEqual({ generation: OPENCODE_GENERATION.OC1, endpoint, epoch: 7, version: '1.18.32' });
    expect(requests).toEqual(expect.arrayContaining([
      { path: '/global/health', method: 'GET', accept: 'application/json', auth: 'Basic fixture' },
      { path: '/api/info', method: 'GET', accept: 'application/json', auth: 'Basic fixture' },
    ]));
  });

  it('identifies OC2 from matching valid info and health versions', async () => {
    const endpoint = await serve({ '/global/health': health('2.0.20'), '/api/info': info('2.0.20') });
    expect(await detectOpenCodeGeneration({ endpoint: `${endpoint}/api/`, epoch: 'next' }))
      .toEqual({ generation: OPENCODE_GENERATION.OC2, endpoint, epoch: 'next', version: '2.0.20' });
  });

  it('identifies OC2 when legacy health is absent', async () => {
    const requests = [];
    const endpoint = await serve({ '/api/info': info('2.0.20') }, requests);
    expect(await detectOpenCodeGeneration({ endpoint, epoch: 3, headers: new Headers({ Authorization: 'Bearer fixture' }) }))
      .toEqual({ generation: OPENCODE_GENERATION.OC2, endpoint, epoch: 3, version: '2.0.20' });
    expect(requests.every((request) => request.auth === 'Bearer fixture')).toBe(true);
  });

  it('accepts matching OC1 evidence on both endpoints', async () => {
    const endpoint = await serve({ '/global/health': health('1.18.32'), '/api/info': info('1.18.32') });
    expect((await detectOpenCodeGeneration({ endpoint, epoch: 1 })).generation)
      .toBe(OPENCODE_GENERATION.OC1);
  });

  it('rejects conflicting valid endpoints', async () => {
    const conflict = await serve({ '/global/health': health('1.18.32'), '/api/info': info('2.0.20') });
    expect((await detectOpenCodeGeneration({ endpoint: conflict, epoch: 1 })).generation)
      .toBe(OPENCODE_GENERATION.UNKNOWN);
  });

  it('accepts OC2 info when the old health path has no generation evidence', async () => {
    const malformed = await serve({ '/global/health': { body: { version: '2.0.20' } }, '/api/info': info('2.0.20') });
    expect((await detectOpenCodeGeneration({ endpoint: malformed, epoch: 1 })).generation)
      .toBe(OPENCODE_GENERATION.OC2);
    const html = await serve({
      '/global/health': { type: 'text/html', body: '<html>OpenCode</html>' },
      '/api/info': info('2.0.20'),
    });
    expect((await detectOpenCodeGeneration({ endpoint: html, epoch: 2 })).generation)
      .toBe(OPENCODE_GENERATION.OC2);
  });

  it.each([401, 403])('keeps %s authentication failure distinct from valid OC1 health', async (status) => {
    const endpoint = await serve({
      '/global/health': health('1.18.32'),
      '/api/info': { status, body: { error: 'unauthorized' } },
    });
    expect((await detectOpenCodeGeneration({ endpoint, epoch: 1 })).generation)
      .toBe(OPENCODE_GENERATION.UNKNOWN);
  });

  it('does not identify OC1 from info alone', async () => {
    const endpoint = await serve({ '/api/info': info('1.18.32') });
    expect((await detectOpenCodeGeneration({ endpoint, epoch: 1 })).generation)
      .toBe(OPENCODE_GENERATION.UNKNOWN);
  });

  it('reports unsupported major and OC2 below its minimum', async () => {
    const future = await serve({ '/global/health': health('3.0.0'), '/api/info': info('3.0.0') });
    expect(await detectOpenCodeGeneration({ endpoint: future, epoch: 1 }))
      .toEqual({ generation: OPENCODE_GENERATION.UNSUPPORTED, endpoint: future, epoch: 1, version: '3.0.0' });
    const futureInfoOnly = await serve({ '/api/info': info('3.0.0') });
    expect((await detectOpenCodeGeneration({ endpoint: futureInfoOnly, epoch: 1 })).generation)
      .toBe(OPENCODE_GENERATION.UNSUPPORTED);
    const old = await serve({ '/global/health': health('2.0.14'), '/api/info': info('2.0.14') });
    expect((await detectOpenCodeGeneration({ endpoint: old, epoch: 1 })).generation)
      .toBe(OPENCODE_GENERATION.UNSUPPORTED);
    expect(isSupportedOpenCodeVersion('1.0.0')).toBe(true);
    expect(isSupportedOpenCodeVersion('2.0.15')).toBe(true);
    expect(isSupportedOpenCodeVersion('2.0.18')).toBe(true);
    expect(isSupportedOpenCodeVersion('2.0.20')).toBe(true);
    expect(supportsCredentialApi('2.0.18')).toBe(false);
    expect(supportsCredentialApi('2.0.20')).toBe(true);
    expect(supportsCredentialApi(null)).toBe(false);
  });

  it('keeps prereleases below the minimum stable release', async () => {
    const endpoint = await serve({ '/api/info': info('2.0.15-rc.1') });
    expect((await detectOpenCodeGeneration({ endpoint, epoch: 1 })).generation)
      .toBe(OPENCODE_GENERATION.UNSUPPORTED);
    expect(isSupportedOpenCodeVersion('2.0.15-rc.1+build.2')).toBe(false);
    expect(supportsCredentialApi('2.0.20-rc.1')).toBe(false);
    expect(isSupportedOpenCodeVersion('2.0.20+build.2')).toBe(true);
    expect(isSupportedOpenCodeVersion('2.0.21-rc.1')).toBe(true);
  });

  it('reports unreachable for connection failure and unknown for invalid responses', async () => {
    const endpoint = await serve({ '/global/health': health('1.18.32'), '/api/info': info('1.18.32') });
    const port = new URL(endpoint).port;
    const server = servers.pop();
    await new Promise((resolve) => server.close(resolve));
    expect((await detectOpenCodeGeneration({ endpoint: `http://127.0.0.1:${port}`, epoch: 2 })).generation)
      .toBe(OPENCODE_GENERATION.UNREACHABLE);
    const invalid = await serve({ '/global/health': health('invalid'), '/api/info': { body: { version: false } } });
    expect((await detectOpenCodeGeneration({ endpoint: invalid, epoch: 2 })).generation)
      .toBe(OPENCODE_GENERATION.UNKNOWN);
  });

  it('keeps descriptors bound to the probed endpoint and epoch', async () => {
    const oc1 = await serve({ '/global/health': health('1.18.32'), '/api/info': { status: 404, body: {} } });
    const oc2 = await serve({ '/global/health': health('2.0.20'), '/api/info': info('2.0.20') });
    const first = await detectOpenCodeGeneration({ endpoint: oc1, epoch: 1 });
    const second = await detectOpenCodeGeneration({ endpoint: oc2, epoch: 2 });
    expect(first).toMatchObject({ endpoint: oc1, epoch: 1, generation: OPENCODE_GENERATION.OC1 });
    expect(second).toMatchObject({ endpoint: oc2, epoch: 2, generation: OPENCODE_GENERATION.OC2 });
  });

  it('reads info only when its JSON version is valid', async () => {
    expect(await readOpenCodeInfo(new Response('<html>OpenCode</html>'))).toBeNull();
    expect(await readOpenCodeInfo(Response.json({ version: '2.0.20' }))).toEqual({ version: '2.0.20' });
    expect(await readOpenCodeInfo(Response.json({ version: 'not a version' }))).toBeNull();
  });
});

const legacyReads = {
  '/session': { body: [{ id: 'session-1' }] }, '/session/status': { body: { 'session-1': { type: 'busy' } } },
  '/permission': { body: [] }, '/question': { body: [] }, '/command': { body: [{ name: 'help' }] },
};

describe('OpenCode profile admission', () => {
  it.each(['1.2.27', 'v1.2.27', '1.2.27+build.1'])('resolves %s through Auto and OC1 without an info request or writes', async version => {
    for (const selection of [OPENCODE_SELECTION.AUTO, OPENCODE_SELECTION.OC1, OPENCODE_SELECTION.LEGACY]) {
      const requests = [];
      const endpoint = await serve({ ...legacyReads, '/global/health': health(version) }, requests);
      const result = await detectOpenCodeProfile({ endpoint, epoch: 2, selection, headers: { Authorization: 'Basic profile-fixture' } });
      expect(result).toMatchObject({ status: PROFILE_STATUS.READY, selection, provenance: 'server', exactVersion: true,
        descriptor: { generation: OPENCODE_GENERATION.OC1, profile: OPENCODE_PROFILE.LEGACY, epoch: 2 } });
      expect(requests.map(request => request.path)).toEqual(['/global/health', ...Object.keys(legacyReads)]);
      expect(requests.every(request => request.method === 'GET' && request.auth === 'Basic profile-fixture')).toBe(true);
    }
  });

  it.each([
    [OPENCODE_SELECTION.AUTO, '1.18.32', OPENCODE_PROFILE.OC1],
    [OPENCODE_SELECTION.OC1, '1.18.32', OPENCODE_PROFILE.OC1],
    [OPENCODE_SELECTION.AUTO, '2.0.20', OPENCODE_PROFILE.OC2],
    [OPENCODE_SELECTION.OC2, '2.0.20', OPENCODE_PROFILE.OC2],
    [OPENCODE_SELECTION.AUTO, '1.2.27-rc.1', OPENCODE_PROFILE.OC1],
  ])('preserves %s selection for %s as %s', async (selection, version, profile) => {
    const endpoint = await serve({ '/global/health': health(version), '/api/info': info(version) });
    expect(await detectOpenCodeProfile({ endpoint, epoch: 1, selection })).toMatchObject({
      status: PROFILE_STATUS.READY, descriptor: { profile }, exactVersion: false, provenance: 'server',
    });
  });

  it.each([
    [OPENCODE_SELECTION.OC2, '1.2.27'], [OPENCODE_SELECTION.OC1, '2.0.20'],
    [OPENCODE_SELECTION.LEGACY, '1.18.32'], [OPENCODE_SELECTION.LEGACY, '1.2.27-rc.1'],
    [OPENCODE_SELECTION.LEGACY, '2.0.20'],
  ])('rejects contradictory %s selection on %s before catalog requests', async (selection, version) => {
    const requests = [];
    const endpoint = await serve({ '/global/health': health(version), '/api/info': info(version) }, requests);
    expect(await detectOpenCodeProfile({ endpoint, epoch: 1, selection })).toMatchObject({ status: PROFILE_STATUS.MISMATCH });
    expect(requests.every(request => ['/global/health', '/api/info'].includes(request.path))).toBe(true);
  });

  it('permits version-absent declaration only for explicit Legacy after all read checks', async () => {
    const requests = [];
    const endpoint = await serve({ ...legacyReads, '/global/health': { body: { healthy: true } } }, requests);
    expect(await detectOpenCodeProfile({ endpoint, epoch: 1, selection: OPENCODE_SELECTION.LEGACY })).toMatchObject({
      status: PROFILE_STATUS.READY, provenance: 'user-declared', exactVersion: false,
      descriptor: { generation: OPENCODE_GENERATION.OC1, profile: OPENCODE_PROFILE.LEGACY, version: null },
    });
    expect(requests.some(request => request.path === '/api/info')).toBe(false);
    expect(await detectOpenCodeProfile({ endpoint, epoch: 1, selection: OPENCODE_SELECTION.AUTO })).toMatchObject({ status: PROFILE_STATUS.UNVERIFIED });
  });

  it.each(Object.keys(legacyReads))('refuses incomplete or malformed read contract %s', async path => {
    const endpoint = await serve({ ...legacyReads, '/global/health': health('1.2.27'), [path]: { body: { malformed: true } } });
    expect(await detectOpenCodeProfile({ endpoint, epoch: 1, selection: OPENCODE_SELECTION.LEGACY })).toMatchObject({ status: PROFILE_STATUS.UNVERIFIED });
  });

  it.each([401, 403])('surfaces authentication failure %s before manual declaration', async status => {
    const requests = [];
    const endpoint = await serve({ ...legacyReads, '/global/health': { status, body: {} } }, requests);
    expect(await detectOpenCodeProfile({ endpoint, epoch: 1, selection: OPENCODE_SELECTION.LEGACY })).toMatchObject({ status: PROFILE_STATUS.AUTH });
    expect(requests).toHaveLength(1);
  });

  it('distinguishes failed read authorization from malformed data', async () => {
    const endpoint = await serve({ ...legacyReads, '/global/health': health('1.2.27'), '/permission': { status: 403, body: {} } });
    expect(await detectOpenCodeProfile({ endpoint, epoch: 1, selection: OPENCODE_SELECTION.AUTO })).toMatchObject({ status: PROFILE_STATUS.AUTH });
  });

  it('reports conflict, unsupported versions and transport failure separately', async () => {
    const conflict = await serve({ '/global/health': health('1.18.32'), '/api/info': info('2.0.20') });
    expect(await detectOpenCodeProfile({ endpoint: conflict, epoch: 1, selection: OPENCODE_SELECTION.AUTO })).toMatchObject({ status: PROFILE_STATUS.CONFLICT });
    const unsupported = await serve({ '/api/info': info('2.0.14') });
    expect(await detectOpenCodeProfile({ endpoint: unsupported, epoch: 1, selection: OPENCODE_SELECTION.AUTO })).toMatchObject({ status: PROFILE_STATUS.UNSUPPORTED });
    expect(await detectOpenCodeProfile({ endpoint: 'http://kernel.test', epoch: 1, selection: OPENCODE_SELECTION.AUTO,
      fetchImpl: async () => { throw new Error('offline'); } })).toMatchObject({ status: PROFILE_STATUS.UNREACHABLE });
  });

  it('rejects invalid selection and endpoint before network work', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return Response.json({}); };
    expect(await detectOpenCodeProfile({ endpoint: 'http://kernel.test', selection: 'invented', fetchImpl })).toEqual({ status: PROFILE_STATUS.INVALID_SELECTION });
    expect(await detectOpenCodeProfile({ endpoint: 'file:///fixture', selection: OPENCODE_SELECTION.AUTO, fetchImpl })).toMatchObject({ status: PROFILE_STATUS.INVALID_ENDPOINT });
    expect(calls).toBe(0);
  });
});
