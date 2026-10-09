import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { z } from 'zod';

const fixture = z.object({ origin: z.url(), cookie: z.string().min(1) }).safeParse({
  origin: process.env.INT02_EDITOR_HOST, cookie: process.env.INT02_EDITOR_COOKIE,
});
const run = fixture.success ? test : test.skip;
for (const transport of ['sse', 'ws'] as const) {
  run(transport + ' discovers a peer restart through the real host and replaces its SDK source', async () => {
    if (!fixture.success) throw new Error('Missing isolated host fixture');
    const { origin, cookie } = fixture.data;
    const browser = new Window({ url: origin });
    const nativeFetch = globalThis.fetch;
    const browserFetch: typeof fetch = (input, init) => nativeFetch(
      input instanceof Request ? input : new URL(input, origin), init,
    );
    globalThis.fetch = browserFetch;
    const NativeSocket = globalThis.WebSocket;
    function BrowserSocket(url: string | URL, protocols?: string | string[]) {
      // Bun's native socket needs the Origin header that a browser sends automatically.
      return Reflect.construct(NativeSocket, [url, { protocols, headers: { Origin: origin } }]);
    }
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({ window: browser, document: browser.document,
      navigator: browser.navigator, localStorage: browser.localStorage, WebSocket: BrowserSocket })) {
      descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value, configurable: true });
    }
    const { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } = await import('@/lib/runtime-url');
    const { setRuntimeExtraHeaders, clearRuntimeUrlAuthToken } = await import('@/lib/runtime-auth');
    const { opencodeClient } = await import('@/lib/opencode/client');
    const { OpenCodeRuntimeChangedError } = await import('@/lib/opencode/runtime');
    const { useConfigStore } = await import('@/stores/useConfigStore');
    const { createEventPipeline } = await import('../event-pipeline');
    const previousResolver = getRuntimeUrlResolver();
    configureRuntimeUrlResolver({ apiBaseUrl: origin });
    setRuntimeExtraHeaders({ Cookie: cookie });
    opencodeClient.reconnectToRuntimeBaseUrl();
    const pipelines: ReturnType<typeof createEventPipeline>[] = [];
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 45000;
      while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      expect(condition()).toBe(true);
    };
    try {
      expect(await useConfigStore.getState().verifyConnection()).toBe(true);
      const before = opencodeClient.getBoundRuntime();
      expect(before?.generation).toBe('oc2');
      const source = opencodeClient.getSyncSource();
      let oldConnected = 0;
      const open = (captured: typeof source, onReconnect: () => void) => {
        const pipeline = createEventPipeline({ source: captured, transport,
          beforeConnect: async (signal) => {
            const healthy = await useConfigStore.getState().verifyConnection();
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            if (!healthy || !opencodeClient.getBoundRuntime() || opencodeClient.getSyncSource() !== captured) throw new OpenCodeRuntimeChangedError();
          }, onReconnect });
        pipelines.push(pipeline);
        return pipeline;
      };
      const old = open(source, () => { oldConnected += 1; });
      await wait(() => oldConnected === 1);
      expect(await source.status('/')).toEqual({});
      const restart = await fetch(origin + '/api/config/reload', { method: 'POST', headers: { Cookie: cookie } });
      expect(restart.status).toBe(200);
      await wait(() => {
        const bound = opencodeClient.getBoundRuntime();
        return bound !== null && bound.epoch !== before?.epoch;
      });
      old.cleanup();
      expect(oldConnected).toBe(1);
      const replacement = opencodeClient.getSyncSource();
      expect(replacement).not.toBe(source);
      expect(replacement.generation).toBe('oc2');
      await expect(source.status('/')).rejects.toThrow(OpenCodeRuntimeChangedError);
      let ready = false;
      open(replacement, () => { ready = true; });
      await wait(() => ready);
      expect(await replacement.status('/')).toEqual({});
      expect(useConfigStore.getState().catalogRuntimeID).toContain(String(opencodeClient.getBoundRuntime()?.epoch));
    } finally {
      for (const pipeline of pipelines) pipeline.cleanup();
      opencodeClient.reconnectToRuntimeBaseUrl();
      clearRuntimeUrlAuthToken();
      setRuntimeExtraHeaders(null);
      setRuntimeUrlResolver(previousResolver);
      globalThis.fetch = nativeFetch;
      await browser.happyDOM.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    }
  }, 120000);
}
