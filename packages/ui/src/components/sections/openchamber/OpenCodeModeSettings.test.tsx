import { afterAll, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { z } from 'zod';
import { OPEN_CODE_SELECTION, OPEN_CODE_SETTING } from '@/lib/opencode/runtime';

let selection: typeof OPEN_CODE_SELECTION[keyof typeof OPEN_CODE_SELECTION] = OPEN_CODE_SELECTION.OC1;
let failRead = false;
let failWrite = false;
let writes = 0;
let probes = 0;
let generation: 'oc1' | 'oc2' = 'oc1';
let failure: 'auth' | 'unreachable' | null = null;
const schema = z.object({ [OPEN_CODE_SETTING.SELECTION]: z.enum(Object.values(OPEN_CODE_SELECTION)).optional() });
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url?.startsWith('/api/opencode/runtime')) {
    probes++;
    const accepted = failure === null && (selection === OPEN_CODE_SELECTION.AUTO || selection === generation);
    res.end(JSON.stringify({ status: failure ?? (accepted ? 'ready' : 'mismatch'), generation: accepted ? generation : failure === 'unreachable' ? 'unreachable' : 'unsupported', endpoint: accepted ? url : null, epoch: writes, version: generation === 'oc1' ? '1.18.32' : '2.0.16', profile: accepted ? generation : undefined }));
    return;
  }
  if (req.method === 'PUT') {
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    const value = schema.parse(JSON.parse(body));
    const requested = value[OPEN_CODE_SETTING.SELECTION];
    if (requested !== undefined) {
      writes++;
      if (failWrite) { res.statusCode = 500; res.end('{}'); return; }
      selection = requested;
    }
  } else if (failRead) { res.statusCode = 500; res.end('{}'); return; }
  res.end(JSON.stringify({ [OPEN_CODE_SETTING.SELECTION]: selection }));
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
const { invalidateSettingsCache } = await import('@/lib/persistence');
const { I18nProvider, useI18nStore } = await import('@/lib/i18n');
const { opencodeClient } = await import('@/lib/opencode/client');
const { useConfigStore } = await import('@/stores/useConfigStore');
const { OpenCodeModeSettings } = await import('./OpenCodeModeSettings');
configureRuntimeUrlResolver({ apiBaseUrl: url });
const container = document.createElement('div');
document.body.append(container);
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
afterAll(async () => {
  await act(async () => root.unmount());
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test('mode control loads and saves explicit intent, retains choice on failure and reacts to locale', async () => {
  await act(async () => root.render(<I18nProvider><OpenCodeModeSettings /></I18nProvider>));
  await wait(() => button('OC1').getAttribute('aria-pressed') === 'true');
  await act(async () => button('OC2').click());
  await wait(() => button('OC2').getAttribute('aria-pressed') === 'true');
  expect(selection).toBe(OPEN_CODE_SELECTION.OC2);
  expect(writes).toBe(1);
  await wait(() => Boolean(document.querySelector('[role="alert"]')) && !button('OC2').disabled);
  expect(opencodeClient.getBoundRuntime()).toBeNull();
  expect(useConfigStore.getState().isConnected).toBe(false);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Mode saved');
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Selected mode does not match the server');
  expect(document.body.textContent).toContain('Server version: 1.18.32');
  const rejectedProbes = probes;
  await act(async () => button('OC2').click());
  expect(writes).toBe(1);
  expect(probes).toBe(rejectedProbes);
  failWrite = true;
  await act(async () => button('OC1').click());
  await wait(() => Boolean(document.querySelector('[role="alert"]')));
  expect(button('OC2').getAttribute('aria-pressed')).toBe('true');
  expect(selection).toBe(OPEN_CODE_SELECTION.OC2);
  failWrite = false;
  await act(async () => button('OC1').click());
  await wait(() => button('OC1').getAttribute('aria-pressed') === 'true' && !button('OC1').disabled);
  expect(opencodeClient.getBoundRuntime()?.generation).toBe('oc1');
  expect(useConfigStore.getState().isConnected).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Profile verified');
  expect(document.body.textContent).toContain('Resolved mode: OC1');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => useI18nStore.getState().setLocale('zh-CN'));
  await wait(() => document.body.textContent?.includes('连接模式') === true);
  expect(button('OC1').getAttribute('aria-pressed')).toBe('true');
  generation = 'oc2';
  await act(async () => button('自动检测').click());
  await wait(() => button('自动检测').getAttribute('aria-pressed') === 'true' && !button('自动检测').disabled);
  expect(opencodeClient.getBoundRuntime()?.generation).toBe('oc2');
  expect(useConfigStore.getState().isConnected).toBe(true);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  failWrite = true;
  const bound = opencodeClient.getBoundRuntime();
  const beforeFailedSave = probes;
  await act(async () => button('OC1').click());
  await wait(() => Boolean(document.querySelector('[role="alert"]')) && !button('OC1').disabled);
  expect(opencodeClient.getBoundRuntime()).toEqual(bound);
  expect(probes).toBe(beforeFailedSave);
  failWrite = false;
  await act(async () => button('Legacy 1.2.27').click());
  await wait(() => button('Legacy 1.2.27').getAttribute('aria-pressed') === 'true');
  expect(selection).toBe(OPEN_CODE_SELECTION.LEGACY);
  await wait(() => Boolean(document.querySelector('[role="alert"]')) && !button('Legacy 1.2.27').disabled);
  expect(opencodeClient.getBoundRuntime()).toBeNull();
  await act(async () => button('自动检测').click());
  await wait(() => button('自动检测').getAttribute('aria-pressed') === 'true');
  expect(selection).toBe(OPEN_CODE_SELECTION.AUTO);
  await wait(() => !button('自动检测').disabled);
  expect(opencodeClient.getBoundRuntime()?.generation).toBe('oc2');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.textContent).toContain('实际模式：OC2');
  expect(document.body.textContent).toContain('服务器版本：2.0.16');
  failure = 'auth';
  await act(async () => { await opencodeClient.discoverRuntime(); });
  expect(document.querySelector('[role="status"]')?.textContent).toBe('服务器认证失败');
  expect(opencodeClient.getBoundRuntime()).toBeNull();
  expect(document.body.textContent).not.toContain('实际模式：');
  failure = 'unreachable';
  await act(async () => { await opencodeClient.discoverRuntime(); });
  expect(document.querySelector('[role="status"]')?.textContent).toBe('无法连接服务器');
  failure = null;
  await act(async () => { await opencodeClient.discoverRuntime(); });
  expect(document.querySelector('[role="status"]')?.textContent).toBe('兼容配置已验证');
  invalidateSettingsCache();
  failRead = true;
  await act(async () => root.render(<I18nProvider><OpenCodeModeSettings key="unreadable" /></I18nProvider>));
  await wait(() => Boolean(document.querySelector('[role="alert"]')));
  expect(button('OC1').disabled).toBe(true);
  expect(button('OC2').disabled).toBe(true);
  expect(document.querySelector('button[aria-pressed="true"]')).toBeNull();
}, 20000);
