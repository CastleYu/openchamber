import { afterAll, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { z } from 'zod';
import { CONNECTION, CONNECTION_TEST, CONNECTION_MODE, connectionSchema, connectionDraft, parseConnectionDraft } from '@/lib/opencode/connection';

const modes = Object.values(CONNECTION_MODE).map(mode => ({ mode, available: mode !== CONNECTION_MODE.PATH }));
let tests = 0;
let delayTest = false;
let failTest = false;
let malformedTest = false;
let holdTest: (() => void) | null = null;
let launchTest = false;
let saved: z.infer<typeof connectionSchema> | null = null;
let previous: z.infer<typeof connectionSchema> | null = null;
let pending: z.infer<typeof connectionSchema> | null = null;
let busyCount = 0;
let queueUnknown = false;
const decisions: string[] = [];
let preparations = 0;
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
  if (req.url === CONNECTION_TEST.ROUTE) {
    tests++;
    let body = ''; for await (const chunk of req) body += chunk.toString();
    z.strictObject({ token:z.uuid(),connection:connectionSchema }).parse(JSON.parse(body));
    if (delayTest) { delayTest = false; await new Promise<void>(resolve => { holdTest = resolve; }); }
    res.statusCode = failTest ? 503 : 200;
    res.end(JSON.stringify(malformedTest ? {status:'ready'} : launchTest ? {kind:'launch',status:'validated',binary:'C:/Tools/opencode.exe'}
      : {kind:'endpoint',status:'ready',selection:'auto',version:'2.0.20',profile:'oc2'})); return;
  }
  if (req.url === CONNECTION.PREPARE) {
    preparations++;
    let body = ''; for await (const chunk of req) body += chunk.toString();
    const input = z.discriminatedUnion('source', [z.strictObject({source: z.literal('candidate'), connection: connectionSchema}), z.strictObject({source: z.literal('previous')})]).parse(JSON.parse(body));
    pending = input.source === 'previous' ? previous : input.connection;
    if (!pending) { res.statusCode = 422; res.end('{}'); return; }
    res.end(JSON.stringify({ token: '74e51929-8307-43d8-8496-3c3856352e98', connection: pending,
      activity: { state: saved ? 'active' : 'inactive', scope: { coverage: 'configured-directories', busy: 'global', directories: ['C:/Work'] },
        busy: {state:'known',count:busyCount}, permissions:{state:'known',count:0}, questions:{state:'unknown',observedCount:1},
        queue:queueUnknown ? {state:'unknown',observedCount:0} : {state:'known',count:2,sending:0,revision:1}, clients:{state:'unknown',observedCount:0} } })); return;
  }
  if (req.url === CONNECTION.APPLY) {
    let body = ''; for await (const chunk of req) body += chunk.toString();
    const input = z.strictObject({token:z.uuid(),decision:z.enum(['wait','stop']),acknowledgeClients:z.literal(true)}).parse(JSON.parse(body));
    decisions.push(input.decision);
    if (delayWrite) { delayWrite = false; await new Promise<void>(resolve => { holdWrite = resolve; }); }
    if (failWrite || input.decision === 'wait' && busyCount > 0) { res.statusCode = 409; res.end('{}'); return; }
    if (!pending) throw new Error('Missing reviewed candidate');
    previous = saved; saved = pending; writes++; starts++;
    res.statusCode = failStart ? 503 : 200;
    res.end(JSON.stringify({ state:'ready',connection:saved })); return;
  }
  if (req.url?.startsWith('/api/config/settings')) {
    res.end(JSON.stringify({ [CONNECTION.SETTING]: saved })); return;
  }
  if (req.url?.startsWith('/api/opencode/runtime')) {
    res.end(JSON.stringify({ status: failStart ? 'unreachable' : 'ready', generation: 'oc2', endpoint: url, epoch: writes, version: '2.0.20', profile: 'oc2' })); return;
  }
  if (req.url === '/health') { res.end(JSON.stringify({ isOpenCodeReady: !failStart })); return; }
  res.end('{}');
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = z.object({ port: z.number().int().positive() }).parse(server.address());
const url = 'http://127.0.0.1:' + address.port;
const browser = new Window({ url });
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage, Element: browser.Element, HTMLElement: browser.HTMLElement, CustomEvent: browser.CustomEvent, PointerEvent: browser.PointerEvent, requestAnimationFrame: browser.requestAnimationFrame.bind(browser), cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) {
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
  hold?.(); holdWrite?.(); holdTest?.();
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

const acknowledge = async () => {
  const checkbox = document.querySelector('[role="checkbox"]');
  if (!checkbox) throw new Error('Missing acknowledgement');
  await act(async () => checkbox.parentElement?.click());
};
const review = async () => {
  await act(async () => button('Confirm and connect').click());
  await wait(() => document.body.textContent?.includes('Review connection switch') === true);
};
test('confirmation displays activity, preserves drafts and requires renewed acknowledgement', async () => {
  await mount('initial');
  await wait(() => document.body.textContent?.includes('Candidates disagree') === true);
  expect(writes).toBe(0); expect(starts).toBe(0);
  expect(button('Confirm and connect').disabled).toBe(true);
  expect(button('Server PATH').disabled).toBe(true);
  await act(async () => button('Custom command').click());
  await act(async () => button('Confirm and connect').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Invalid connection');
  await act(async () => button('Use candidate').click());
  await review();
  expect(writes).toBe(0); expect(starts).toBe(0);
  expect(document.body.textContent).toContain('Busy sessions across the server: 0');
  expect(document.body.textContent).toContain('Pending questions: Unknown');
  expect(document.body.textContent).toContain('Queued messages: 2');
  queueUnknown = true;
  await act(async () => button('Refresh activity').click());
  await wait(() => document.body.textContent?.includes('Queued messages: Unknown') === true);
  expect(document.body.textContent).not.toContain('Queued messages: 0');
  expect(button('Switch if idle').disabled).toBe(true);
  await act(async () => useI18nStore.getState().setLocale('zh-CN'));
  await wait(() => document.body.textContent?.includes('待处理问题：未知') === true);
  expect(document.body.textContent).toContain('排队消息：未知');
  expect(document.querySelector('input')?.value).toBe('http://candidate.test/base');
  await act(async () => useI18nStore.getState().setLocale('en'));
  await wait(() => document.body.textContent?.includes('Review connection switch') === true);
  await acknowledge();
  expect(button('Switch if idle').disabled).toBe(false);
  await act(async () => button('Refresh activity').click());
  await wait(() => document.body.textContent?.includes('Review connection switch') === true);
  expect(button('Switch if idle').disabled).toBe(true);
  await act(async () => button('Cancel').click());
  expect(document.querySelector('input')?.value).toBe('http://candidate.test/base');
  expect(writes).toBe(0);
  await review(); await acknowledge();
  queueUnknown = false;
  failWrite = true;
  await act(async () => button('Switch if idle').click());
  await wait(() => document.querySelector('[role="alert"]')?.textContent?.includes('changed') === true);
  expect(starts).toBe(0); expect(saved).toBeNull();
  failWrite = false;
  await review(); await acknowledge();
  const apply = button('Switch if idle');
  await act(async () => { apply.click(); apply.click(); });
  await wait(() => Array.from(document.querySelectorAll('button')).some(item => item.textContent === 'Confirm and connect' && !item.disabled));
  expect(writes).toBe(1); expect(starts).toBe(1);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(useConfigStore.getState().isConnected).toBe(true);
  expect(useConfigStore.getState().isInitialized).toBe(true);
  expect(document.querySelector('[data-settings-item="general.opencode-connection"]')).not.toBeNull();
}, 20000);

test('busy rejection requires a fresh review; explicit stop and failed-start recovery are separate decisions', async () => {
  const original = saved;
  await act(async () => button('Bundled CLI').click());
  busyCount = 1;
  await review(); await acknowledge();
  const before = starts;
  await act(async () => button('Switch if idle').click());
  await wait(() => document.querySelector('[role="alert"]')?.textContent?.includes('changed') === true);
  expect(starts).toBe(before); expect(saved).toEqual(original);
  await review(); await acknowledge();
  failStart = true;
  await act(async () => button('Stop and switch').click());
  await wait(() => document.querySelector('[role="alert"]')?.textContent?.includes('change failed') === true);
  expect(saved?.mode).toBe('bundled'); expect(previous).toEqual(original);
  expect(decisions.at(-1)).toBe('stop');
  await wait(() => !button('Return to previous connection').disabled);
  expect(useConfigStore.getState().isConnected).toBe(false);
  failStart = false; busyCount = 0;
  const count = preparations;
  await act(async () => button('Return to previous connection').click());
  await wait(() => document.body.textContent?.includes('Review connection switch') === true);
  expect(preparations).toBe(count+1);
  expect(button('Switch if idle').disabled).toBe(true);
  expect(saved?.mode).toBe('bundled');
  await acknowledge();
  await act(async () => button('Switch if idle').click());
  await wait(() => Array.from(document.querySelectorAll('button')).some(item => item.textContent === 'Confirm and connect' && !item.disabled));
  expect(saved).toEqual(original); expect(document.querySelector('[role="alert"]')).toBeNull();
},20000);

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
  await review(); await acknowledge();
  await act(async () => button('Switch if idle').click());
  await wait(() => holdWrite !== null);
  unsupported = true;
  await act(async () => switchRuntimeEndpoint({ apiBaseUrl: url, runtimeKey: 'editor-final-host' }));
  await wait(() => document.body.textContent?.includes('does not support') === true);
  await act(async () => { holdWrite?.(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(starts).toBe(startCount + 1);
  expect(document.querySelector('input')).toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
}, 20000);

test('read-only testing shows results, preserves settings and cancels without late success', async () => {
  await act(async () => useI18nStore.getState().setLocale('en'));
  failRead = false; unsupported = false; saved = {version:1,confirmed:true,mode:'external',endpoint:'http://saved.test'};
  const before = {writes,starts,preparations};
  await mount('test-flow'); await wait(() => !!document.querySelector('input'));
  await act(async () => button('Test connection').click());
  await wait(() => document.body.textContent?.includes('Profile verified') === true);
  expect(document.body.textContent).toContain('Server version: 2.0.20');
  expect({writes,starts,preparations}).toEqual(before);
  const firstTests = tests;
  delayTest = true;
  await act(async () => { button('Test connection').click(); button('Test connection').click(); });
  await wait(() => holdTest !== null);
  expect(tests).toBe(firstTests + 1);
  expect(document.querySelector('input')?.disabled).toBe(true);
  expect(button('Cancel').disabled).toBe(false);
  await act(async () => button('Cancel').click());
  await wait(() => document.body.textContent?.includes('Test cancelled') === true);
  expect(button('Confirm and connect').disabled).toBe(false);
  await act(async () => { holdTest?.(); holdTest = null; });
  expect(document.body.textContent).not.toContain('Profile verified');
  expect({writes,starts,preparations}).toEqual(before);
  failTest = true;
  await act(async () => button('Test connection').click());
  await wait(() => document.body.textContent?.includes('Test failed or timed out') === true);
  failTest = false; malformedTest = true;
  await act(async () => button('Test connection').click());
  await wait(() => !button('Test connection').disabled);
  expect(document.body.textContent).not.toContain('Profile verified');
  malformedTest = false; launchTest = true;
  saved = {version:1,confirmed:true,mode:'configured',exe:'C:/Tools/opencode.exe'};
  await mount('test-launch'); await wait(() => document.querySelector('input')?.value === 'C:/Tools/opencode.exe');
  await act(async () => button('Test connection').click());
  await wait(() => document.body.textContent?.includes('Launch inputs are valid') === true);
  expect(document.body.textContent).not.toContain('Profile verified');
  await act(async () => useI18nStore.getState().setLocale('zh-CN'));
  expect(document.body.textContent).toContain('启动输入有效');
  expect({writes,starts,preparations}).toEqual(before);
  launchTest = false;
  await act(async () => useI18nStore.getState().setLocale('en'));
});
