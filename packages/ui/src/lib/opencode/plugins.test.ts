import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';

import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '@/lib/runtime-url';
import { opencodeClient } from './client';
import { checkPluginUpdates, listPluginRuntime, updatePluginPackage } from './plugins';
import { OpenCodeRuntimeChangedError, OpenCodeRuntimeError } from './runtime';

const previous = getRuntimeUrlResolver();
beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://plugins.test' });
  opencodeClient.reconnectToRuntimeBaseUrl();
});
afterEach(() => {
  setRuntimeUrlResolver(previous);
  opencodeClient.reconnectToRuntimeBaseUrl();
});

test('OC1 keeps registry behavior without calling OC2 plugin routes', async () => {
  opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://plugins.test', epoch: 1, version: '1.18.32' });
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [] }));
  try {
    await expect(listPluginRuntime('/repo')).rejects.toThrow(OpenCodeRuntimeError);
    await expect(checkPluginUpdates('/repo')).rejects.toThrow(OpenCodeRuntimeError);
    await expect(updatePluginPackage('/repo', 'foo')).rejects.toThrow(OpenCodeRuntimeError);
    expect(fetch.mock.calls.length).toBe(0);
  } finally { fetch.mockRestore(); }
});

test('OC2 official SDK lists, checks and updates the exact package target', async () => {
  opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://plugins.test', epoch: 2, version: '2.0.16' });
  const payload = { data: [
    { source: { type: 'package', target: 'foo@^2', version: '2.1.0', outdated: true, updating: false }, state: { status: 'active' } },
    { source: { type: 'local', path: '/repo/plugins/bar/index.ts' }, state: { status: 'failed', error: 'boom', ref: 'err_1' } },
  ] };
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (request) =>
    new URL(new Request(request).url).pathname === '/api/plugin/update'
      ? new Response(null, { status: 204 })
      : Response.json(payload));
  try {
    const listed = await listPluginRuntime('/repo');
    expect(listed).toEqual([
      { source: { kind: 'package', target: 'foo@^2', version: '2.1.0', outdated: true, updating: false }, state: { kind: 'active' } },
      { source: { kind: 'local', path: '/repo/plugins/bar/index.ts' }, state: { kind: 'failed', error: 'boom', ref: 'err_1' } },
    ]);
    expect(await checkPluginUpdates('/repo')).toEqual(listed);
    await updatePluginPackage('/repo', 'foo@^2');
    const requests = fetch.mock.calls.map((call) => new Request(call[0], call[1]));
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(['/api/plugin', '/api/plugin/check', '/api/plugin/update']);
    expect(requests[0]?.headers.get('x-opencode-directory')).toBe(encodeURIComponent('/repo'));
    expect(await requests[2]?.text()).toBe(JSON.stringify({ targets: ['foo@^2'] }));
  } finally { fetch.mockRestore(); }
});

test('a failed inventory is not an authoritative empty list and late old epoch data is discarded', async () => {
  opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://plugins.test', epoch: 3, version: '2.0.16' });
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
  try {
    await expect(listPluginRuntime('/repo')).rejects.toThrow();
    let finish: (response: Response) => void = () => undefined;
    const pendingResponse = new Promise<Response>((resolve) => { finish = resolve; });
    fetch.mockImplementation(() => pendingResponse);
    const pending = listPluginRuntime('/repo');
    opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://plugins.test', epoch: 4, version: '2.0.16' });
    finish(Response.json({ data: [] }));
    await expect(pending).rejects.toThrow(OpenCodeRuntimeChangedError);
  } finally { fetch.mockRestore(); }
});
