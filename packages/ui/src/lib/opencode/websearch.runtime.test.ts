import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '@/lib/runtime-url';
import { opencodeClient } from './client';
import { listWebSearchProviders, saveWebSearchKey } from './websearch';
import { OpenCodeRuntimeChangedError, OpenCodeRuntimeError } from './runtime';

const previous = getRuntimeUrlResolver();
beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://websearch.test' });
  opencodeClient.reconnectToRuntimeBaseUrl();
});
afterEach(() => {
  setRuntimeUrlResolver(previous);
  opencodeClient.reconnectToRuntimeBaseUrl();
});

test('OC1 cannot list OC2 providers or write their credentials', async () => {
  opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://websearch.test', epoch: 1, version: '1.18.32' });
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [] }));
  try {
    await expect(listWebSearchProviders(null)).rejects.toThrow(OpenCodeRuntimeError);
    await expect(saveWebSearchKey('exa', 'fixture')).rejects.toThrow(OpenCodeRuntimeError);
    expect(fetch.mock.calls.length).toBe(0);
  } finally { fetch.mockRestore(); }
});

test('provider reads follow SDK2 and reject failed reads', async () => {
  opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://websearch.test', epoch: 2, version: '2.0.16' });
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ location: '/repo', data: [{ id: 'exa', name: 'Exa' }] }));
  try {
    expect(await listWebSearchProviders('/repo')).toEqual([{ id: 'exa', name: 'Exa' }]);
    const request = new Request(fetch.mock.calls[0][0], fetch.mock.calls[0][1]);
    expect(new URL(request.url).pathname).toBe('/api/websearch/provider');
    fetch.mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(listWebSearchProviders('/repo')).rejects.toThrow();
  } finally { fetch.mockRestore(); }
});

test('late providers from an old kernel are discarded', async () => {
  opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://websearch.test', epoch: 3, version: '2.0.16' });
  let finish: (response: Response) => void = () => undefined;
  const response = new Promise<Response>((resolve) => { finish = resolve; });
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(() => response);
  try {
    const pending = listWebSearchProviders(null);
    opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://websearch.test', epoch: 4, version: '2.0.16' });
    finish(Response.json({ data: [] }));
    await expect(pending).rejects.toThrow(OpenCodeRuntimeChangedError);
  } finally { fetch.mockRestore(); }
});
