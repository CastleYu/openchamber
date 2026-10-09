import { afterEach, describe, expect, test } from 'bun:test';
import { handleProxyBridgeMessage } from './bridge-proxy-runtime';
import { QUEUE_TARGET } from '../../web/server/lib/opencode/queue-target.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const deps = { tryHandleLocalFsProxy: async () => null, sanitizeForwardHeaders: input => ({ ...input }),
  buildUnavailableApiResponse: () => ({ status: 503, headers: {}, bodyText: '' }),
  collectHeaders: headers => Object.fromEntries(headers), base64EncodeUtf8: text => Buffer.from(text).toString('base64') };
function fixture(generation) {
  let target = 'a'.repeat(64);
  let status = 200;
  let epoch = 1;
  let onLookup = () => {};
  const descriptor = () => ({ generation, endpoint: 'http://kernel.test', epoch, version: generation === 'oc1' ? '1.18.32' : '2.0.16' });
  const manager = { getStatus: () => 'connected', getApiUrl: () => 'http://kernel.test', getKernelRuntime: descriptor,
    refreshKernelRuntime: async () => descriptor(), getOpenCodeAuthHeaders: () => ({ authorization: 'Basic fixture' }),
    onStatusChange: () => ({ dispose() {} }), connectionRequest: async request => {
      expect(request).toEqual({ method: 'GET', path: QUEUE_TARGET.ROUTE });
      onLookup(); return { status, body: { target } };
    } };
  return { ctx: { manager }, change: value => { target = value; }, unavailable: () => { status = 503; },
    replaceDuringLookup: () => { onLookup = () => { epoch += 1; }; } };
}

describe('host rejects queued requests for another configured target', () => {
  for (const generation of ['oc1', 'oc2']) for (const type of generation === 'oc1' ? ['api:proxy', 'api:session:message'] : ['api:proxy']) {
    test(generation + ' ' + type + ' refuses changed, malformed and unavailable targets without upstream effects', async () => {
      const host = fixture(generation);
      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response(null, { status: 204 }); };
      const request = expected => ({ id: 'guard', type, payload: { method: 'POST', path: '/session/same/message', headers: { [QUEUE_TARGET.HEADER]: expected }, bodyText: '{}', bodyBase64: 'e30=' } });
      for (const expected of ['b'.repeat(64), '', 'malformed']) {
        const result = await handleProxyBridgeMessage(request(expected), host.ctx, deps);
        expect(result.data.status).toBe(409);
        expect(JSON.parse(result.data.bodyText).error).toBe(QUEUE_TARGET.CHANGED);
      }
      host.unavailable();
      expect((await handleProxyBridgeMessage(request('a'.repeat(64)), host.ctx, deps)).data.status).toBe(503);
      expect(calls).toBe(0);
    });
    test(generation + ' ' + type + ' strips the private header and keeps ordinary requests working', async () => {
      const host = fixture(generation);
      const requests = [];
      globalThis.fetch = async (input, init) => { requests.push(new Request(input, init)); return new Response(null, { status: 204 }); };
      for (const headers of [{ [QUEUE_TARGET.HEADER.toUpperCase()]: 'a'.repeat(64) }, {}]) {
        const result = await handleProxyBridgeMessage({ id: 'valid', type, payload: { method: 'POST', path: '/session/same/message', headers, bodyText: '{}', bodyBase64: 'e30=' } }, host.ctx, deps);
        expect(result.data.status).toBe(204);
      }
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.headers.has(QUEUE_TARGET.HEADER)).toBe(false);
        expect(request.headers.get('authorization')).toBe('Basic fixture');
        expect(await request.text()).toBe('{}');
      }
    });
    test(generation + ' ' + type + ' refuses an epoch replacement during target lookup', async () => {
      const host = fixture(generation);
      host.replaceDuringLookup();
      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response(null, { status: 204 }); };
      await expect(handleProxyBridgeMessage({ id: 'race', type, payload: { method: 'POST', path: '/session/same/message', headers: { [QUEUE_TARGET.HEADER]: 'a'.repeat(64) } } }, host.ctx, deps)).rejects.toThrow('connection changed');
      expect(calls).toBe(0);
    });
  }
});
