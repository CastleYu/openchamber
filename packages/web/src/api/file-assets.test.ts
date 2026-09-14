import { expect, test } from 'bun:test';
import { initializeRuntimeEndpoint, switchRuntimeEndpoint } from '@openchamber/ui/lib/runtime-switch';
import { loadAsset, openNative, saveNative } from './file-assets';

test('download cleanup covers begin failure, cancellation, length mismatch and failed external open', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let failAt = '';
  let cancelled = 0;
  let requests = 0;
  let releases = 0;
  let opens = 0;
  let saves = 0;
  let onFinish = () => {};
  let received: number[] = [];
  let lastUrl = '';
  let grants = 0;
  const invoke = async (command: string, args: { bytes?: Uint8Array } = {}) => {
    if (command === failAt) throw new Error('native failure');
    if (command === 'desktop_file_begin') return 'transfer-id';
    if (command === 'desktop_file_chunk') received.push(...args.bytes ?? []);
    if (command === 'desktop_file_finish') { onFinish(); return 'openchamber-file://asset/transfer-id'; }
    if (command === 'desktop_file_open') opens += 1;
    if (command === 'desktop_file_save') saves += 1;
    if (command === 'desktop_file_release') releases += 1;
    return null;
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
      __OPENCHAMBER_DESKTOP__: { invoke, grantFileAccess: async (path: string) => {
        grants += 1;
        return { path, outsideFileGrant: 'renewed-grant', expiresAt: Date.now() + 600_000 };
      } },
      location: { origin: 'openchamber-ui://app' },
      dispatchEvent: () => true,
    },
  });
  initializeRuntimeEndpoint({ apiBaseUrl: 'http://127.0.0.1:57123/api', runtimeKey: 'remote-test' });
  let makeResponse = () => new Response(new Uint8Array([0, 128, 255]), { headers: { 'content-length': '3' } });
  // Replace the browser fetch boundary, leaving runtime routing and native IPC intact.
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
    lastUrl = input instanceof Request ? input.url : String(input);
    requests += 1;
    return makeResponse();
  }, originalFetch);
  try {
    const aborted = new AbortController();
    aborted.abort();
    await expect(loadAsset('/video.mp4', { signal: aborted.signal }, true)).rejects.toThrow();
    expect(requests).toBe(0);

    makeResponse = () => new Response(new ReadableStream({ cancel() { cancelled += 1; } }));
    failAt = 'desktop_file_begin';
    await expect(loadAsset('/video.mp4', {}, true)).rejects.toThrow('native failure');
    expect(cancelled).toBe(1);
    expect(releases).toBe(0);

    failAt = '';
    makeResponse = () => new Response(new Uint8Array([1]), { headers: { 'content-length': '2' } });
    await expect(loadAsset('/video.mp4', {}, true)).rejects.toThrow('Incomplete file download');
    expect(releases).toBe(1);

    makeResponse = () => new Response(new Uint8Array([0, 128, 255]), { headers: { 'content-length': '3' } });
    received = [];
    const asset = await loadAsset('/video.mp4', {}, true);
    expect(received).toEqual([0, 128, 255]);
    expect(asset.url).toBe('openchamber-file://asset/transfer-id');
    asset.dispose();
    expect(releases).toBe(2);

    const controller = new AbortController();
    await expect(loadAsset('/video.mp4', { signal: controller.signal, onProgress: () => controller.abort() }, true)).rejects.toThrow();
    expect(releases).toBe(3);

    failAt = 'desktop_file_open';
    await expect(openNative('/video.mp4')).rejects.toThrow('native failure');
    expect(releases).toBe(4);

    failAt = '';
    const finishAbort = new AbortController();
    onFinish = () => finishAbort.abort();
    await expect(openNative('/video.mp4', { signal: finishAbort.signal })).rejects.toThrow();
    expect(opens).toBe(0);
    expect(releases).toBe(5);

    const saveAbort = new AbortController();
    onFinish = () => saveAbort.abort();
    await expect(saveNative('/draft.txt', { content: 'unsaved text', signal: saveAbort.signal })).rejects.toThrow();
    expect(saves).toBe(0);
    expect(releases).toBe(6);

    onFinish = () => switchRuntimeEndpoint({ apiBaseUrl: 'http://127.0.0.1:57124/api', runtimeKey: 'other-test' });
    await expect(openNative('/video.mp4')).rejects.toThrow('File runtime changed');
    expect(opens).toBe(0);
    expect(releases).toBe(7);

    onFinish = () => {};
    switchRuntimeEndpoint({ apiBaseUrl: 'http://127.0.0.1:57123/api', runtimeKey: 'local' });
    const outside = await loadAsset('C:/outside/video.mp4', {
      directory: 'C:/workspace', allowOutsideWorkspace: true, outsideFileGrant: 'expired-grant',
    }, true);
    expect(grants).toBe(1);
    expect(new URL(lastUrl).searchParams.get('outsideFileGrant')).toBe('renewed-grant');
    outside.dispose();
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});
