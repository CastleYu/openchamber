import { describe, expect, test } from 'bun:test';
import { toast } from 'sonner';
import {
  getRuntimeApiBaseUrl,
  registerRuntimeOAuthCleanup,
  prepareRuntimeNavigation,
  getRuntimeKey,
  subscribeRuntimeEndpointChanged,
  subscribeRuntimeEndpointWillChange,
  switchRuntimeEndpoint,
} from './runtime-switch';
import { clearRuntimeUrlAuthToken, setRuntimeExtraHeaders, getRuntimeBearerTokenSync, getRuntimeExtraHeadersSync } from './runtime-auth';
import {
  activateRelayTunnel,
  deactivateRelayTunnel,
  getActiveRelayDescriptor,
} from './relay/runtime-tunnel';

describe('runtime endpoint switching', () => {
  test('exposes a credential-free copy of the active relay descriptor', () => {
    const descriptor = {
      relayUrl: 'wss://relay.example.com',
      serverId: 'server-1',
      hostEncPubJwk: { kty: 'EC', crv: 'P-256', x: 'public-x', y: 'public-y' },
      grant: 'one-time-secret',
    };

    try {
      activateRelayTunnel(descriptor);
      const exposed = getActiveRelayDescriptor();
      expect(exposed).toEqual({
        relayUrl: descriptor.relayUrl,
        serverId: descriptor.serverId,
        hostEncPubJwk: descriptor.hostEncPubJwk,
      });
      expect(exposed).not.toBe(descriptor);
      expect(exposed?.hostEncPubJwk).not.toBe(descriptor.hostEncPubJwk);
    } finally {
      deactivateRelayTunnel();
    }
  });

  test('notifies listeners before and after mutating the active endpoint', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousFetch = globalThis.fetch;
    const events = new EventTarget();
    const runtimeWindow = {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    };

    try {
      globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: runtimeWindow,
      });
      switchRuntimeEndpoint({ apiBaseUrl: 'https://runtime-a.example', runtimeKey: 'runtime-a' });
      const observed: Array<[string, string, string]> = [];
      const unsubscribeWillChange = subscribeRuntimeEndpointWillChange((detail) => {
        observed.push(['will-change', getRuntimeKey(), detail.previousRuntimeKey]);
      });
      const unsubscribeChanged = subscribeRuntimeEndpointChanged((detail) => {
        observed.push(['changed', getRuntimeKey(), detail.runtimeKey]);
      });

      switchRuntimeEndpoint({ apiBaseUrl: 'https://runtime-b.example', runtimeKey: 'runtime-b' });

      expect(observed).toEqual([
        ['will-change', 'runtime-a', 'runtime-a'],
        ['changed', 'runtime-b', 'runtime-b'],
      ]);
      unsubscribeWillChange();
      unsubscribeChanged();
    } finally {
      globalThis.fetch = previousFetch;
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }
    }
  });

  test('does not throw when Electron preload globals are read-only', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousFetch = globalThis.fetch;
    const runtimeWindow = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    };

    try {
      clearRuntimeUrlAuthToken();
      setRuntimeExtraHeaders(null);
      globalThis.fetch = (async () => new Response(JSON.stringify({ token: 'url-token', expiresAt: Date.now() + 60_000 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
      Object.defineProperty(runtimeWindow, '__OPENCHAMBER_API_BASE_URL__', {
        configurable: true,
        value: 'http://127.0.0.1:3000',
        writable: false,
      });
      Object.defineProperty(runtimeWindow, '__OPENCHAMBER_CLIENT_TOKEN__', {
        configurable: true,
        value: '',
        writable: false,
      });
      Object.defineProperty(runtimeWindow, '__OPENCHAMBER_RUNTIME_HEADERS__', {
        configurable: true,
        value: {},
        writable: false,
      });
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: runtimeWindow,
      });

      let thrown: unknown = null;
      try {
        switchRuntimeEndpoint({
          apiBaseUrl: 'https://remote.example',
          clientToken: 'client-token',
          requestHeaders: null,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeNull();
      expect(getRuntimeApiBaseUrl()).toBe('https://remote.example');
    } finally {
      globalThis.fetch = previousFetch;
      clearRuntimeUrlAuthToken();
      setRuntimeExtraHeaders(null);
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }
    }
  });
});

describe('OAuth cleanup before runtime commit', () => {
  test('keeps old endpoint and credentials live until cleanup settles, including same-host replacement', async () => {
    await switchRuntimeEndpoint({ apiBaseUrl: 'https://old.example', runtimeKey: 'old', clientToken: 'old-token', requestHeaders: { 'x-owner': 'old' } });
    let finish = () => {};
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const remove = registerRuntimeOAuthCleanup(() => pending);
    try {
      const switching = switchRuntimeEndpoint({ apiBaseUrl: 'https://old.example', runtimeKey: 'old', clientToken: 'new-token', requestHeaders: { 'x-owner': 'new' } });
      expect(getRuntimeBearerTokenSync()).toBe('old-token');
      expect(getRuntimeExtraHeadersSync()['x-owner']).toBe('old');
      await expect(switchRuntimeEndpoint({ apiBaseUrl: 'https://unexpected.example' })).rejects.toThrow('already in progress');
      finish();
      await switching;
      expect(getRuntimeApiBaseUrl()).toBe('https://old.example');
      expect(getRuntimeBearerTokenSync()).toBe('new-token');
      expect(getRuntimeExtraHeadersSync()['x-owner']).toBe('new');
    } finally { finish(); remove(); }
  });

  test('does not adopt a probe tunnel or close the old relay during cleanup', async () => {
    const old = { relayUrl: 'wss://old.example', serverId: 'old-server', hostEncPubJwk: { kty: 'EC' } };
    const next = { relayUrl: 'wss://new.example', serverId: 'new-server', hostEncPubJwk: { kty: 'EC' } };
    await switchRuntimeEndpoint({ apiBaseUrl: 'https://virtual.example', relay: old });
    let finish = () => {};
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const remove = registerRuntimeOAuthCleanup(() => pending);
    // A real disconnected client needs no WebSocket until its first request.
    const { createRelayTunnelClient } = await import('./relay/tunnel-client');
    const live = createRelayTunnelClient(next);
    try {
      const switching = switchRuntimeEndpoint({ apiBaseUrl: 'https://virtual.example', relay: next, relayTunnel: live });
      expect(getActiveRelayDescriptor()?.serverId).toBe('old-server');
      finish();
      await switching;
      expect(getActiveRelayDescriptor()?.serverId).toBe('new-server');
      const { getActiveRelayTunnel } = await import('./relay/runtime-tunnel');
      expect(getActiveRelayTunnel()).toBe(live);
    } finally { finish(); remove(); deactivateRelayTunnel(); }
  });

  test('bounds unresponsive cleanup and aborts it before committing', async () => {
    await switchRuntimeEndpoint({ apiBaseUrl: 'https://old.example' });
    let signal: AbortSignal | undefined;
    const remove = registerRuntimeOAuthCleanup((value) => { signal = value; return new Promise<void>(() => {}); });
    try {
      await switchRuntimeEndpoint({ apiBaseUrl: 'https://new.example' });
      expect(signal?.aborted).toBe(true);
      expect(getRuntimeApiBaseUrl()).toBe('https://new.example');
      expect(toast.getHistory().filter(item => 'type' in item && item.type === 'warning').length).toBeGreaterThan(0);
    } finally { remove(); }
  }, 5_000);

  test('navigation awaits cleanup and a rejected cleanup permits a later switch', async () => {
    let finish = () => {};
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    let completed = false;
    const remove = registerRuntimeOAuthCleanup(() => pending);
    try {
      const navigation = prepareRuntimeNavigation().then(() => { completed = true; });
      await Promise.resolve();
      expect(completed).toBe(false);
      finish();
      await navigation;
      expect(completed).toBe(true);
    } finally { finish(); remove(); }
    const reject = registerRuntimeOAuthCleanup(() => Promise.reject(new Error('offline')));
    try { await switchRuntimeEndpoint({ apiBaseUrl: 'https://after-failure.example' }); }
    finally { reject(); }
    await switchRuntimeEndpoint({ apiBaseUrl: 'https://after-recovery.example' });
    expect(getRuntimeApiBaseUrl()).toBe('https://after-recovery.example');
  });
});
