import { afterAll, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { z } from 'zod';
import { CONNECTION, CONNECTION_MODE, connectionSchema, connectionDraft, parseConnectionDraft } from '@/lib/opencode/connection';

const modes = Object.values(CONNECTION_MODE).map(mode => ({ mode, available: mode !== CONNECTION_MODE.PATH }));
let saved: z.infer<typeof connectionSchema> | null = null;
let failRead = false;
let failWrite = false;
let failStart = false;
let unsupported = false;
let writes = 0;
let starts = 0;
let reads = 0;
let hold: (() => void) | null = null;
let delayRead = false;
let delayWrite = false;
let holdWrite: (() => void) | null = null;
const candidate = { source: 'environment', key: 'OPENCODE_HOST', record: { version: 1, confirmed: false, mode: 'external', endpoint: 'http://candidate.test/base' }, resolved: 'http://candidate.test/base', error: null };
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === CONNECTION.ROUTE) {
    reads++;
    if (delayRead) { delayRead = false; await new Promise<void>(resolve => { hold = resolve; }); }
    res.statusCode = unsupported ? 501 : failRead ? 503 : 200;
    res.end(JSON.stringify({ saved, error: saved ? null : 'conflict', modes, candidates: saved ? [] : [candidate], recommendation: null }));
    return;
  }
  if (req.url === CONNECTION.RELOAD) {
    starts++;
    res.statusCode = failStart ? 500 : 200;
    res.end(JSON.stringify({ success: !failStart })); return;
  }
  if (req.url?.startsWith('/api/config/settings')) {
    if (req.method === 'PUT') {
      let body = '';
      for await (const chunk of req) body += chunk.toString();
      const value = z.object({ [CONNECTION.SETTING]: connectionSchema.optional() }).parse(JSON.parse(body));
      const requested = value[CONNECTION.SETTING];
      if (requested) {
        writes++;
        if (delayWrite) { delayWrite = false; await new Promise<void>(resolve => { holdWrite = resolve; }); }
        if (failWrite) { res.statusCode = 409; res.end('{}'); return; }
        saved = requested;
      }
    }
    res.end(JSON.stringify({ [CONNECTION.SETTING]: saved })); return;
  }
  if (req.url?.startsWith('/api/opencode/runtime')) {
    res.end(JSON.stringify({ status: 'ready', generation: 'oc2', endpoint: url, epoch: writes, version: '2.0.20', profile: 'oc2' })); return;
  }
  if (req.url === '/health') { res.end(JSON.stringify({ isOpenCodeReady: true })); return; }
  res.end('{}');
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = z.object({ port: z.number().int().positive() }).parse(server.address());
const url = 'http://127.0.0.1:' + address.port;
const browser = new Window({ url });
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage, Element: browser.Element, HTMLElement: browser.HTMLElement, CustomEvent: browser.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
  descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { value, configurable: true });
}
const { createRoot } = await import('react-dom/client');
const { configureRuntimeUrlResolver } = await import('@/lib/runtime-url');
const { switchRuntimeEndpoint } = await import('@/lib/runtime-switch');
const { I18nProvider, useI18nStore } = await import('@/lib/i18n');
const { useConfigStore } = await import('@/stores/useConfigStore');
const { OpenCodeConnectionSettings } = await import('./OpenCodeConnectionSettings');
configureRuntimeUrlResolver({ apiBaseUrl: url });
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const button = (label: string) => {
  const value = Array.from(document.querySelectorAll('button')).find(item => item.textContent === label);
  if (!value) throw new Error('Missing button ' + label);
  return value;
};
const wait = async (condition: () => boolean) => {
  const deadline = Date.now() + 6500;
  while (!condition() && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(condition()).toBe(true);
};
const mount = async (key: string) => { await act(async () => root.render(<I18nProvider><OpenCodeConnectionSettings key={key} /></I18nProvider>)); };
afterAll(async () => {
  hold?.(); holdWrite?.();
  await act(async () => root.unmount());
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

test('draft preserves exact argument boundaries, validates references and normalizes endpoints', () => {
  const base = { ...connectionDraft(), mode: CONNECTION_MODE.COMMAND, exe: 'C:\\Tools\\agent.exe', cwd: 'C:\\Work', args: 'serve\n--title\n two words \n', env: 'MODEL=SERVER_MODEL' };
  const result = parseConnectionDraft(base);
  expect(result.success).toBe(true);
  if (!result.success || result.data.mode !== CONNECTION_MODE.COMMAND) throw new Error('Expected command');
  expect(result.data.args).toEqual(['serve', '--title', ' two words ', '']);
  expect(result.data.env).toEqual([{ name: 'MODEL', ref: 'SERVER_MODEL' }]);
  expect(parseConnectionDraft({ ...base, env: 'MODEL=ONE\nmodel=TWO' }).success).toBe(false);
  expect(parseConnectionDraft({ ...base, env: 'MODEL=ONE=VALUE' }).success).toBe(false);
  expect(parseConnectionDraft({ ...base, args: '' }).success).toBe(false);
  expect(parseConnectionDraft({ ...base, exe: 'relative.exe' }).success).toBe(false);
  const endpoint = parseConnectionDraft({ ...connectionDraft(), mode: CONNECTION_MODE.EXTERNAL, endpoint: 'https://example.test/prefix/' });
  expect(endpoint.success && endpoint.data.mode === CONNECTION_MODE.EXTERNAL && endpoint.data.endpoint).toBe('https://example.test/prefix');
  for (const value of ['https://name:secret@example.test', 'https://example.test?token=secret', 'file:///fixture'])
    expect(parseConnectionDraft({ ...connectionDraft(), mode: CONNECTION_MODE.EXTERNAL, endpoint: value }).success).toBe(false);
});

test('candidate needs confirmation; failures preserve draft and saved connection; locale does not write', async () => {
  await mount('initial');
  await wait(() => document.body.textContent?.includes('Candidates disagree') === true);
  expect(writes).toBe(0); expect(starts).toBe(0);
  expect(button('Confirm and connect').disabled).toBe(true);
  expect(button('Server PATH').disabled).toBe(true);
  await act(async () => button('Custom command').click());
  expect(document.querySelectorAll('textarea').length).toBe(2);
  expect(document.querySelectorAll('input').length).toBe(2);
  await act(async () => button('Confirm and connect').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Invalid connection');
  expect(writes).toBe(0); expect(starts).toBe(0);
  await act(async () => button('Use candidate').click());
  expect(writes).toBe(0); expect(starts).toBe(0);
  expect(document.querySelector('input')?.value).toBe('http://candidate.test/base');
  await act(async () => useI18nStore.getState().setLocale('zh-CN'));
  expect(document.querySelector('input')?.value).toBe('http://candidate.test/base');
  expect(writes).toBe(0);
  await act(async () => useI18nStore.getState().setLocale('en'));
  failWrite = true;
  await act(async () => button('Confirm and connect').click());
  await wait(() => document.querySelector('[role="alert"]')?.textContent?.includes('not saved') === true);
  expect(starts).toBe(0); expect(saved).toBeNull();
  expect(document.querySelector('input')?.value).toBe('http://candidate.test/base');
  failWrite = false; failStart = true;
  const confirmation = button('Confirm and connect');
  await act(async () => { confirmation.click(); confirmation.click(); });
  await wait(() => document.querySelector('[role="alert"]')?.textContent?.includes('Connection saved') === true);
  expect(saved).toEqual({ ...candidate.record, confirmed: true });
  expect(writes).toBe(2); expect(starts).toBe(1);
  expect(document.body.textContent).not.toContain('Candidates disagree');
  expect(document.body.textContent).not.toContain('Use candidate');
  failStart = false;
  await act(async () => button('Retry').click());
  await wait(() => !confirmation.disabled);
  expect(writes).toBe(2); expect(starts).toBe(2);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(useConfigStore.getState().isConnected).toBe(true);
  expect(useConfigStore.getState().isInitialized).toBe(true);
  expect(document.querySelector('[data-settings-item="general.opencode-connection"]')).not.toBeNull();
}, 20000);

test('failed discovery can retry, unsupported never offers writes, retired response cannot refill form', async () => {
  failRead = true;
  await mount('failed');
  await wait(() => document.querySelector('[role="alert"]')?.textContent?.includes('could not be loaded') === true);
  failRead = false;
  await act(async () => button('Retry').click());
  await wait(() => document.body.textContent?.includes('External server') === true);
  unsupported = true;
  await mount('unsupported');
  await wait(() => document.body.textContent?.includes('does not support') === true);
  expect(document.querySelector('input')).toBeNull();
  expect(document.querySelector('button')).toBeNull();
  const before = writes;
  delayRead = true; unsupported = false;
  await mount('retirement');
  await wait(() => hold !== null);
  unsupported = true;
  await act(async () => switchRuntimeEndpoint({ apiBaseUrl: url, runtimeKey: 'editor-new-host' }));
  await wait(() => document.body.textContent?.includes('does not support') === true);
  await act(async () => { hold?.(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(document.body.textContent).not.toContain('External server');
  expect(writes).toBe(before); expect(reads).toBeGreaterThan(4);
  unsupported = false;
  await mount('save-retirement');
  await wait(() => document.body.textContent?.includes('External server') === true);
  await act(async () => button('Bundled CLI').click());
  delayWrite = true;
  const startCount = starts;
  await act(async () => button('Confirm and connect').click());
  await wait(() => holdWrite !== null);
  unsupported = true;
  await act(async () => switchRuntimeEndpoint({ apiBaseUrl: url, runtimeKey: 'editor-final-host' }));
  await wait(() => document.body.textContent?.includes('does not support') === true);
  await act(async () => { holdWrite?.(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(starts).toBe(startCount);
  expect(document.querySelector('input')).toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
}, 20000);
