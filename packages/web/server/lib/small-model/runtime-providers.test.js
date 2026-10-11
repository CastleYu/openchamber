import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ZEN_ANONYMOUS_API_KEY,
  configureOpenCodeRuntimeProviders,
  getRuntimeDefaultModel,
  getRuntimeGeneration,
  getRuntimeProvider,
  getRuntimeProviderSnapshot,
  resetOpenCodeRuntimeProviders,
} from './runtime-providers.js';

const nativeFetch = globalThis.fetch;

const providerPayload = (overrides = {}) => ({
  all: [
    {
      id: 'llmapi',
      source: 'config',
      options: { apiKey: 'plugin-key', baseURL: 'https://api.llmapi.ai/v1/' },
      models: {
        'claude-opus-4-8': { api: { id: 'claude-opus-4-8', url: '', npm: '@ai-sdk/anthropic' } },
        'gpt-5.6-luna': { api: { id: 'gpt-5.6-luna', url: 'https://api.llmapi.ai/v1', npm: '@ai-sdk/openai' } },
      },
    },
    {
      id: 'opencode',
      source: 'custom',
      options: { apiKey: ZEN_ANONYMOUS_API_KEY },
      models: { 'free-model': { api: { id: 'free-model', url: 'https://opencode.ai/zen/v1', npm: '@ai-sdk/openai-compatible' } } },
    },
    {
      id: 'zai-coding-plan',
      source: 'api',
      key: 'auth-json-key',
      options: {},
      models: { 'glm-5': { api: { id: 'glm-5', url: 'https://api.z.ai/api/coding/paas/v4', npm: '@ai-sdk/openai-compatible' } } },
    },
  ],
  connected: ['llmapi', 'opencode', 'zai-coding-plan'],
  ...overrides,
});

const startProviderServer = async (handler) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return { endpoint, close: () => new Promise((resolve) => server.close(resolve)) };
};

describe('OpenCode runtime provider snapshot', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify(providerPayload()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    configureOpenCodeRuntimeProviders({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Basic test' }),
    });
  });

  afterEach(() => {
    configureOpenCodeRuntimeProviders(null);
    resetOpenCodeRuntimeProviders();
    vi.unstubAllGlobals();
  });

  it('reports the credential and endpoint a plugin registered at runtime', async () => {
    const provider = await getRuntimeProvider('llmapi');

    expect(provider).toMatchObject({ apiKey: 'plugin-key', baseURL: 'https://api.llmapi.ai/v1' });
    expect(provider.models.get('gpt-5.6-luna')).toEqual({
      api: { url: 'https://api.llmapi.ai/v1', npm: '@ai-sdk/openai' },
    });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:4096/provider');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Basic test' });
  });

  it('tracks the configured kernel generation and defaults to OC1 when detached', () => {
    expect(getRuntimeGeneration()).toBe('oc1');
    configureOpenCodeRuntimeProviders({ getGeneration: () => 'oc2' });
    expect(getRuntimeGeneration()).toBe('oc2');
    configureOpenCodeRuntimeProviders(null);
    expect(getRuntimeGeneration()).toBe('oc1');
  });

  it('retires a late OC2 default model when its runtime owner changes', async () => {
    let runtime = { generation: 'oc2', profile: 'oc2', endpoint: 'http://127.0.0.1:1', epoch: 1 };
    let release;
    configureOpenCodeRuntimeProviders({
      getRuntimeDescriptor: () => runtime,
      getDefaultModel: () => new Promise((resolve) => { release = resolve; }),
    });
    const pending = getRuntimeDefaultModel('/project');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    runtime = { ...runtime, epoch: 2 };
    release({ generation: 'oc2', data: { providerID: 'old-owner', id: 'model' } });
    expect(await pending).toBeNull();
  });

  it('accepts a stamped OC2 default model and rejects malformed data', async () => {
    configureOpenCodeRuntimeProviders({
      getGeneration: () => 'oc2',
      getDefaultModel: async () => ({ generation: 'oc2', data: { providerID: 'chosen', id: 'model' } }),
    });
    expect(await getRuntimeDefaultModel('/project')).toEqual({ providerID: 'chosen', modelID: 'model', source: 'default' });
    configureOpenCodeRuntimeProviders({
      getGeneration: () => 'oc2',
      getDefaultModel: async () => ({ generation: 'oc2', data: { providerID: 'chosen' } }),
    });
    await expect(getRuntimeDefaultModel('/project')).rejects.toThrow('invalid default model');
  });

  it('refuses the zen sentinel as a credential', async () => {
    const provider = await getRuntimeProvider('opencode');

    expect(provider.apiKey).toBeNull();
    expect(provider.anonymousZen).toBe(true);
    // The endpoint is still reported; only the credential is withheld.
    expect(provider.baseURL).toBe('https://opencode.ai/zen/v1');
  });

  it('falls back to the model endpoint when the provider carries no baseURL', async () => {
    expect((await getRuntimeProvider('zai-coding-plan')).baseURL).toBe('https://api.z.ai/api/coding/paas/v4');
  });

  it('serves one snapshot to concurrent callers instead of refetching', async () => {
    await Promise.all([getRuntimeProvider('llmapi'), getRuntimeProvider('opencode'), getRuntimeProvider('zai-coding-plan')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers "unknown" rather than "no providers" when OpenCode is unreachable', async () => {
    resetOpenCodeRuntimeProviders();
    fetchMock.mockRejectedValue(new Error('connection refused'));

    expect(await getRuntimeProviderSnapshot()).toBeNull();
  });

  it('keeps the previous snapshot when a later refresh fails', async () => {
    await getRuntimeProviderSnapshot();
    fetchMock.mockRejectedValue(new Error('connection refused'));

    // Past the snapshot TTL, so the next read genuinely attempts a refresh.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    const refreshed = await getRuntimeProviderSnapshot();
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshed.providers.has('llmapi')).toBe(true);
  });

  it('retires cached credentials when the runtime descriptor changes', async () => {
    let runtime = { generation: 'oc2', profile: 'oc2', endpoint: 'http://127.0.0.1:1', epoch: 1 };
    configureOpenCodeRuntimeProviders({ getRuntimeDescriptor: () => runtime, buildOpenCodeUrl: (path) => `${runtime.endpoint}${path}`, getOpenCodeAuthHeaders: () => ({}) });
    await getRuntimeProviderSnapshot();
    runtime = { ...runtime, epoch: 2 };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(providerPayload({ all: [] })), { status: 200 }));
    expect((await getRuntimeProviderSnapshot()).providers.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let a retired in-flight fetch repopulate the next owner cache', async () => {
    let runtime = { generation: 'oc2', profile: 'oc2', endpoint: 'http://127.0.0.1:1', epoch: 1 };
    let release;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    configureOpenCodeRuntimeProviders({ getRuntimeDescriptor: () => runtime, buildOpenCodeUrl: (path) => `${runtime.endpoint}${path}`, getOpenCodeAuthHeaders: () => ({}) });
    const retired = getRuntimeProviderSnapshot();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    runtime = { ...runtime, epoch: 2 };
    const current = getRuntimeProviderSnapshot();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release(new Response(JSON.stringify(providerPayload()), { status: 200 }));
    expect(await retired).toBeNull();
    expect((await current).providers.size).toBe(3);
    expect((await getRuntimeProvider('llmapi')).apiKey).toBe('plugin-key');
  });

  it.each([
    ['CAgent', { generation: 'unsupported', endpoint: null, epoch: 2, version: null }],
    ['Legacy', { generation: 'oc1', profile: 'legacy-1.2.27', endpoint: 'http://127.0.0.1:1', epoch: 1 }],
    ['unresolved generation', { generation: 'unknown', profile: 'oc2', endpoint: 'http://127.0.0.1:1', epoch: 1 }],
  ])('does not dispatch or read auth headers for %s', async (_label, runtime) => {
    const headers = vi.fn(() => ({}));
    configureOpenCodeRuntimeProviders({ getRuntimeDescriptor: () => runtime, buildOpenCodeUrl: () => 'http://127.0.0.1:1/provider', getOpenCodeAuthHeaders: headers });
    expect(await getRuntimeProviderSnapshot()).toBeNull();
    expect(getRuntimeGeneration()).toBe(runtime.generation);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(headers).not.toHaveBeenCalled();
  });

  it('does not serve an old same-owner fallback to a concurrent caller after identity changes', async () => {
    let runtime = { generation: 'oc2', profile: 'oc2', endpoint: 'http://127.0.0.1:1', epoch: 1 };
    configureOpenCodeRuntimeProviders({ getRuntimeDescriptor: () => runtime, buildOpenCodeUrl: (path) => `${runtime.endpoint}${path}`, getOpenCodeAuthHeaders: () => ({}) });
    await getRuntimeProviderSnapshot();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    let reject;
    fetchMock.mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
    const first = getRuntimeProviderSnapshot();
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    const second = getRuntimeProviderSnapshot();
    runtime = { ...runtime, epoch: 2 };
    reject(new Error('temporary outage'));
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    vi.useRealTimers();
  });

  it('discards a real loopback response after the endpoint owner changes', async () => {
    vi.stubGlobal('fetch', nativeFetch);
    let oldResponse;
    let newRequests = 0;
    const oldServer = await startProviderServer((_request, response) => { oldResponse = response; });
    const newServer = await startProviderServer((_request, response) => {
      newRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(providerPayload({ all: [] })));
    });
    let runtime = { generation: 'oc1', profile: 'oc1', endpoint: oldServer.endpoint, epoch: 1 };
    try {
      configureOpenCodeRuntimeProviders({
        getRuntimeDescriptor: () => runtime,
        buildOpenCodeUrl: (path) => `${runtime.endpoint}${path}`,
        getOpenCodeAuthHeaders: () => ({}),
      });
      const retired = getRuntimeProviderSnapshot();
      await vi.waitFor(() => expect(oldResponse).toBeTruthy());
      runtime = { ...runtime, endpoint: newServer.endpoint, epoch: 2 };
      const current = await getRuntimeProviderSnapshot();
      oldResponse.writeHead(200, { 'content-type': 'application/json' });
      oldResponse.end(JSON.stringify(providerPayload()));
      expect(current.providers.size).toBe(0);
      expect(await retired).toBeNull();
      expect(newRequests).toBe(1);
    } finally {
      await Promise.all([oldServer.close(), newServer.close()]);
    }
  });

  it('uses a real loopback provider response and retires it after reset during the read', async () => {
    vi.stubGlobal('fetch', nativeFetch);
    let answer;
    let requests = 0;
    const loopback = await startProviderServer((_request, response) => {
      requests += 1;
      if (requests === 1) answer = response;
      else response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(providerPayload()));
    });
    try {
      configureOpenCodeRuntimeProviders({
        getRuntimeDescriptor: () => ({ generation: 'oc1', profile: 'oc1', endpoint: loopback.endpoint, epoch: 1 }),
        buildOpenCodeUrl: (path) => `${loopback.endpoint}${path}`,
        getOpenCodeAuthHeaders: () => ({}),
      });
      const pending = getRuntimeProviderSnapshot();
      await vi.waitFor(() => expect(answer).toBeTruthy());
      resetOpenCodeRuntimeProviders();
      answer.writeHead(200, { 'content-type': 'application/json' });
      answer.end(JSON.stringify(providerPayload()));
      expect(await pending).toBeNull();
      expect(await getRuntimeProviderSnapshot()).not.toBeNull();
    } finally {
      await loopback.close();
    }
  });

  it('stays on file-based resolution until it is configured', async () => {
    configureOpenCodeRuntimeProviders(null);

    expect(await getRuntimeProvider('llmapi')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
