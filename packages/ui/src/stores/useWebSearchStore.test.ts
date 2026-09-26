import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '@/lib/runtime-url';
import { opencodeClient } from '@/lib/opencode/client';
import { getWebSearchScopeKey, useWebSearchStore } from './useWebSearchStore';

const previous = getRuntimeUrlResolver();
beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://search-store.test' });
  opencodeClient.reconnectToRuntimeBaseUrl();
  opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://search-store.test', epoch: 1, version: '2.0.16' });
  useWebSearchStore.setState({ state: { kind: 'idle' } });
});
afterEach(async () => {
  setRuntimeUrlResolver(previous);
  opencodeClient.reconnectToRuntimeBaseUrl();
  await useWebSearchStore.getState().load(null);
});

test('a late settings-project read cannot replace the newly selected project', async () => {
  const originalDirectory = opencodeClient.getDirectory();
  let finish: (value: Awaited<ReturnType<typeof opencodeClient.getTaggedConfig>>) => void = () => undefined;
  const pending = new Promise<Awaited<ReturnType<typeof opencodeClient.getTaggedConfig>>>((resolve) => { finish = resolve; });
  const config = spyOn(opencodeClient, 'getTaggedConfig').mockImplementation(async (directory) => directory === '/old'
    ? pending : { generation: 'oc2', value: { websearch: { provider: 'new' } } });
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return Response.json(url.pathname === '/api/config/websearch' ? { projectPath: null } : { data: [] });
  });
  try {
    const old = useWebSearchStore.getState().load('/old');
    await useWebSearchStore.getState().load('/new');
    finish({ generation: 'oc2', value: { websearch: false } });
    await old;
    expect(useWebSearchStore.getState().state).toMatchObject({ kind: 'ready', snapshot: { scope: getWebSearchScopeKey('/new'), selection: { kind: 'provider', id: 'new' } } });
    expect(opencodeClient.getDirectory()).toBe(originalDirectory);
  } finally { config.mockRestore(); fetch.mockRestore(); }
});

test('a failed provider refresh retains the same-scope snapshot', async () => {
  const config = spyOn(opencodeClient, 'getTaggedConfig').mockResolvedValue({ generation: 'oc2', value: {} });
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('failed', { status: 503 }));
  const snapshot = { scope: getWebSearchScopeKey(), providers: [{ id: 'exa', name: 'Exa' }], selection: { kind: 'random' as const }, access: null, projectOverride: null };
  useWebSearchStore.setState({ state: { kind: 'ready', snapshot } });
  try {
    await useWebSearchStore.getState().load();
    expect(useWebSearchStore.getState().state).toEqual({ kind: 'ready', snapshot });
  } finally { config.mockRestore(); fetch.mockRestore(); }
});

test('switching to OC1 rejects stale settings writes and clears the page snapshot', async () => {
  const snapshot = { scope: getWebSearchScopeKey(), providers: [], selection: { kind: 'default' as const }, access: null, projectOverride: null };
  useWebSearchStore.setState({ state: { kind: 'ready', snapshot } });
  opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://search-store.test', epoch: 2, version: '1.18.32' });
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  try {
    expect(await useWebSearchStore.getState().setSelection({ kind: 'off' })).toBe(false);
    expect(await useWebSearchStore.getState().saveKey('exa', 'fixture')).toBe(false);
    await useWebSearchStore.getState().load();
    expect(useWebSearchStore.getState().state.kind).toBe('idle');
    expect(fetch.mock.calls.length).toBe(0);
  } finally { fetch.mockRestore(); }
});
