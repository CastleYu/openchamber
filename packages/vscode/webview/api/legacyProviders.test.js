import { afterAll, afterEach, expect, test } from 'bun:test';
const originalWindow = globalThis.window;
const originalAcquire = globalThis.acquireVsCodeApi;
const messages = [];
const pending = new Map();
globalThis.window = new EventTarget();
globalThis.acquireVsCodeApi = () => ({ postMessage: message => {
  messages.push(message);
  if (message.id) pending.set(message.id, message);
} });
const { legacyProviderFetch } = await import('./legacyProviders');
const { LEGACY_PROVIDER_BRIDGE } = await import('../../legacyProviderBridge');
function reply(request, data) {
  pending.delete(request.id);
  window.dispatchEvent(new MessageEvent('message', { data: { id: request.id, type: request.type, success: true, data } }));
}
async function nextRequest() { await new Promise(resolve => setTimeout(resolve, 0)); return messages.findLast(message => message.type === LEGACY_PROVIDER_BRIDGE.REQUEST); }
afterEach(() => { messages.length = 0; pending.clear(); });
afterAll(() => { globalThis.window = originalWindow; globalThis.acquireVsCodeApi = originalAcquire; });

test('routes request body and parses trusted bridge response into a no-store HTTP result', async () => {
  const body = { attemptId: 'attempt', code: 'fixture' };
  const result = legacyProviderFetch('/api/legacy/providers/oauth/callback', 'https://webview.test/api', { body: JSON.stringify(body) }, 'POST');
  const request = await nextRequest();
  expect(request.payload).toEqual({ method: 'POST', path: '/api/legacy/providers/oauth/callback', body });
  reply(request, { status: 200, body: { persisted: true, requiresRestart: true } });
  const response = await result;
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ persisted: true, requiresRestart: true });
});

test('request abort sends cancellation for the exact host request and rejects locally', async () => {
  const controller = new AbortController();
  const result = legacyProviderFetch('/api/legacy/providers/oauth/authorize', 'https://webview.test/api', { signal: controller.signal, body: '{"attemptId":"attempt"}' }, 'POST').catch(error => error);
  const request = await nextRequest(); controller.abort();
  expect((await result).name).toBe('AbortError');
  const canceled = messages.find(message => message.type === LEGACY_PROVIDER_BRIDGE.ABORT);
  expect(canceled.payload).toEqual({ requestID: request.id });
  expect(canceled.id).toBeDefined();
  reply(canceled, { status: 200, body: { canceled: true } });
});

test('wrong methods preserve the host status and malformed responses fail visibly', async () => {
  const result = legacyProviderFetch('/api/legacy/providers/methods', 'https://webview.test/api', undefined, 'GET');
  const request = await nextRequest();
  expect(request.payload.method).toBe('GET');
  reply(request, { status: 405, body: { error: 'method_not_allowed' } });
  expect((await result).status).toBe(405);
  const malformed = legacyProviderFetch('/api/legacy/providers/methods', 'https://webview.test/api', { body: '{}' }, 'POST').catch(error => error);
  reply(await nextRequest(), { status: 'ok', body: {} });
  expect((await malformed).name).toBe('ZodError');
});

test('already aborted fetch does not dispatch a host request', async () => {
  const controller = new AbortController(); controller.abort();
  const error = await legacyProviderFetch('/api/legacy/providers/methods', 'https://webview.test/api', { signal: controller.signal, body: '{}' }, 'POST').catch(error => error);
  expect(error.name).toBe('AbortError'); expect(messages.length).toBe(0);
});

test('RequestInit signal overrides the input Request signal', async () => {
  const inherited = new AbortController();
  const override = new AbortController();
  const input = new Request('https://webview.test/api', { signal: inherited.signal });
  const result = legacyProviderFetch('/api/legacy/providers/methods', input, { signal: override.signal, body: '{}' }, 'POST').catch(error => error);
  const request = await nextRequest();
  inherited.abort();
  expect(messages.some(message => message.type === LEGACY_PROVIDER_BRIDGE.ABORT)).toBe(false);
  override.abort();
  expect((await result).name).toBe('AbortError');
  const canceled = messages.find(message => message.type === LEGACY_PROVIDER_BRIDGE.ABORT);
  expect(canceled.payload.requestID).toBe(request.id);
  reply(canceled, { status: 200, body: { canceled: true } });
});

test('RequestInit null signal detaches the input Request signal', async () => {
  const inherited = new AbortController();
  const input = new Request('https://webview.test/api', { signal: inherited.signal });
  const result = legacyProviderFetch('/api/legacy/providers/methods', input, { signal: null, body: '{}' }, 'POST');
  const request = await nextRequest();
  inherited.abort();
  expect(messages.some(message => message.type === LEGACY_PROVIDER_BRIDGE.ABORT)).toBe(false);
  reply(request, { status: 200, body: {} });
  expect((await result).status).toBe(200);
});
