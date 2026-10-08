import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenCodeNetworkRuntime } from './network-runtime.js';
import { AGENT_FAMILY } from '../agent/constants.js';

const originalFetch = globalThis.fetch;

const createRuntime = (overrides = {}) => createOpenCodeNetworkRuntime({
  state: {
    openCodePort: 4096,
    openCodeBaseUrl: null,
    openCodeApiPrefix: '',
    openCodeApiPrefixDetected: false,
    openCodeApiDetectionTimer: null,
    ...overrides.state,
  },
  getOpenCodeAuthHeaders: () => ({}),
  configuredOpenCodeHostname: overrides.configuredOpenCodeHostname,
  getBackendSelection: overrides.getBackendSelection,
});

describe('OpenCode network runtime', () => {
  it('refuses CAgent readiness before reading credentials or sending HTTP', async () => {
    const headers = vi.fn();
    globalThis.fetch = vi.fn();
    const runtime = createOpenCodeNetworkRuntime({
      state: {}, getOpenCodeAuthHeaders: headers,
      getBackendSelection: () => ({ family: AGENT_FAMILY.CAGENT, revision: 1 }),
    });
    await expect(runtime.waitForReady('http://127.0.0.1:4096')).resolves.toBe(false);
    expect(headers).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a stale ready result after a same-family round trip', async () => {
    let selected = { family: AGENT_FAMILY.OPENCODE, revision: 1 };
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    globalThis.fetch = vi.fn(async () => {
      await pending;
      return Response.json({ healthy: true, version: '1.18.32' });
    });
    const runtime = createRuntime({ getBackendSelection: () => selected });
    const ready = runtime.waitForReady('http://127.0.0.1:4096');
    // One detection pass starts both documented generation probes.
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    selected = { family: AGENT_FAMILY.CAGENT, revision: 2 };
    selected = { family: AGENT_FAMILY.OPENCODE, revision: 3 };
    release();
    await expect(ready).resolves.toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('returns false when readiness fetch rejects', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    });

    const runtime = createRuntime();
    const readyPromise = runtime.waitForReady('http://127.0.0.1:4096', 1);

    await expect(readyPromise).resolves.toBe(false);
  });

  it('builds managed OpenCode URLs against IPv4 loopback by default', () => {
    const runtime = createRuntime();

    expect(runtime.buildOpenCodeUrl('/provider')).toBe('http://127.0.0.1:4096/provider');
  });

  it.each(['oc1', 'oc2'])('recognizes %s readiness from its authoritative endpoint', async (generation) => {
    globalThis.fetch = vi.fn(async (url) => {
      if (generation === 'oc1' && url.endsWith('/global/health')) {
        return Response.json({ healthy: true, version: '1.18.32' });
      }
      if (generation === 'oc2' && url.endsWith('/api/info')) {
        return Response.json({ version: '2.0.16' });
      }
      return new Response('<html>not an API</html>');
    });
    await expect(createRuntime().waitForReady('http://127.0.0.1:4096', 1000)).resolves.toBe(true);
  });

  it('keeps external OpenCode base URLs authoritative', () => {
    const runtime = createRuntime({
      state: { openCodeBaseUrl: 'http://remote.example:4096' },
    });

    expect(runtime.buildOpenCodeUrl('/provider')).toBe('http://remote.example:4096/provider');
  });

  it('normalizes wildcard and IPv6 OpenCode bind hosts for local connects', () => {
    expect(createRuntime({ configuredOpenCodeHostname: '0.0.0.0' }).buildOpenCodeUrl('/provider'))
      .toBe('http://127.0.0.1:4096/provider');
    expect(createRuntime({ configuredOpenCodeHostname: '::1' }).buildOpenCodeUrl('/provider'))
      .toBe('http://[::1]:4096/provider');
  });
});
