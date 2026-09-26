import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { opencodeClient } from './client';
import { OpenCodeRuntimeChangedError, OpenCodeRuntimeError } from './runtime';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '../runtime-url';

const previous = getRuntimeUrlResolver();

describe('authoritative runtime discovery', () => {
  test('OC2 sharing is rejected before dispatch', async () => {
    opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'http://127.0.0.1:4097', epoch: 1, version: '2.0.16' });
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
    try {
      await expect(opencodeClient.shareSession('ses_1')).rejects.toThrow(OpenCodeRuntimeError);
      await expect(opencodeClient.unshareSession('ses_1')).rejects.toThrow(OpenCodeRuntimeError);
      expect(fetch.mock.calls.length).toBe(0);
    } finally {
      fetch.mockRestore();
    }
  });

  test('OC1 unshare removes a stale URL echoed by the server', async () => {
    opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'http://127.0.0.1:4096', epoch: 1, version: '1.18.32' });
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      id: 'ses_1', slug: 'test', projectID: 'project', directory: '/repo', title: 'Test', version: '1',
      time: { created: 1, updated: 2 }, share: { url: 'https://share.test/stale' },
    }));
    try {
      const result = await opencodeClient.unshareSession('ses_1', '/repo');
      expect(result.share).toBe(undefined);
      const dispatched = new Request(fetch.mock.calls[0][0], fetch.mock.calls[0][1]);
      expect(dispatched.url).toContain('/session/ses_1/share');
      expect(dispatched.method).toBe('DELETE');
    } finally {
      fetch.mockRestore();
    }
  });

  test('coalesces discovery and binds before health succeeds', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      generation: 'oc2', endpoint: 'http://127.0.0.1:4097', epoch: 1, version: '2.0.16',
    }));
    try {
      expect(await Promise.all([opencodeClient.checkHealth(), opencodeClient.checkHealth()])).toEqual([true, true]);
      expect(fetch.mock.calls.length).toBe(1);
      expect(String(fetch.mock.calls[0][0])).toBe('https://protocol.test/api/opencode/runtime');
      expect(opencodeClient.getSyncSource().generation).toBe('oc2');
    } finally {
      fetch.mockRestore();
    }
  });

  test('an unavailable descriptor clears the previous kernel binding', async () => {
    opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'http://127.0.0.1:4096', epoch: 1, version: '1.18.32' });
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      generation: 'unreachable', endpoint: null, epoch: 2, version: null,
    }));
    try {
      expect(await opencodeClient.checkHealth()).toBe(false);
      expect(opencodeClient.getBoundRuntime()).toBe(null);
      expect(() => opencodeClient.getSyncSource()).toThrow(OpenCodeRuntimeError);
    } finally {
      fetch.mockRestore();
    }
  });

  test('a late descriptor cannot rebind after reconnect', async () => {
    let resolve: (value: Response) => void = () => {};
    const pending = new Promise<Response>((done) => { resolve = done; });
    const fetch = spyOn(globalThis, 'fetch');
    fetch.mockReturnValue(pending);
    try {
      const old = opencodeClient.discoverRuntime();
      opencodeClient.reconnectToRuntimeBaseUrl();
      opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'http://127.0.0.1:4096', epoch: 3, version: '1.18.32' });
      resolve(Response.json({ generation: 'oc2', endpoint: 'http://127.0.0.1:4097', epoch: 2, version: '2.0.16' }));
      await expect(old).rejects.toThrow(OpenCodeRuntimeChangedError);
      expect(opencodeClient.getBoundRuntime()?.generation).toBe('oc1');
      expect(opencodeClient.getBoundRuntime()?.epoch).toBe(3);
    } finally {
      fetch.mockRestore();
    }
  });
});
beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://protocol.test' });
  opencodeClient.reconnectToRuntimeBaseUrl();
});

afterEach(() => {
  setRuntimeUrlResolver(previous);
  opencodeClient.reconnectToRuntimeBaseUrl();
});

describe('directory-scoped protocol ownership', () => {
  test('selects one sync source per bound epoch and uses OC2 active sessions', async () => {
    opencodeClient.bindRuntime({
      generation: 'oc2', endpoint: 'http://127.0.0.1:4097', epoch: 10, version: '2.0.16',
    });
    const source = opencodeClient.getSyncSource();
    expect(opencodeClient.getSyncSource()).toBe(source);
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: { ses_1: { type: 'running' } } }));
    try {
      expect(await source.status('/repo')).toEqual({ ses_1: { type: 'busy' } });
      expect(String(fetch.mock.calls[0][0])).toBe('https://protocol.test/api/session/active');
      opencodeClient.bindRuntime({
        generation: 'oc2', endpoint: 'http://127.0.0.1:4097', epoch: 11, version: '2.0.16',
      });
      expect(opencodeClient.getSyncSource() === source).toBe(false);
    } finally {
      fetch.mockRestore();
    }
  });

  test('blocks both retained and new OC1 SDK clients after binding OC2', async () => {
    opencodeClient.bindRuntime({
      generation: 'oc1', endpoint: 'http://127.0.0.1:4096', epoch: 1, version: '1.18.32',
    });
    const retained = opencodeClient.getScopedApiClient('/repo');
    opencodeClient.bindRuntime({
      generation: 'oc2', endpoint: 'http://127.0.0.1:4097', epoch: 2, version: '2.0.16',
    });
    const fresh = opencodeClient.getScopedApiClient('/repo');
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]));
    try {
      await expect(retained.session.list({}, { throwOnError: true })).rejects.toThrow(OpenCodeRuntimeError);
      await expect(fresh.session.list({}, { throwOnError: true })).rejects.toThrow(OpenCodeRuntimeError);
      expect(fetch.mock.calls.length).toBe(0);
    } finally {
      fetch.mockRestore();
    }
  });

  test('routes bound OC2 session pages through /api with encoded directory scope', async () => {
    opencodeClient.bindRuntime({
      generation: 'oc2', endpoint: 'http://127.0.0.1:4097', epoch: 3, version: '2.0.16',
    });
    const session = {
      id: 'ses_1', projectID: 'prj_1', location: { directory: '/repo' }, title: 'Test',
      cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
    };
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [session], cursor: {} }));
    try {
      const page = await opencodeClient.getV2Sessions().listPage({ limit: 2 }, { directory: '/repo' });
      expect(page.sessions[0].id).toBe('ses_1');
      expect(fetch.mock.calls).toHaveLength(1);
      const [url, init] = fetch.mock.calls[0];
      expect(String(url)).toBe('https://protocol.test/api/session?limit=2&directory=%2Frepo');
      expect(new Headers(init?.headers).get('x-opencode-directory')).toBe('%2Frepo');
    } finally {
      fetch.mockRestore();
    }
  });
});
