import { expect, spyOn, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { toast } from '@/components/ui';
import { I18nProvider } from '@/lib/i18n';
import { opencodeClient } from '@/lib/opencode/client';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '@/lib/runtime-url';
import { ProviderOAuthMethods } from './ProviderOAuthMethods';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function fixture(run) {
  const dom = new Window({ url: 'https://oauth.test' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, localStorage: dom.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const previous = getRuntimeUrlResolver();
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://oauth.test' });
  opencodeClient.reconnectToRuntimeBaseUrl();
  opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://kernel.test', epoch: 1, version: '1.18.32' });
  opencodeClient.setDirectory('/original');
  const requests = [];
  const pending = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return new Promise((resolve) => pending.push(resolve));
  });
  const opened = spyOn(dom, 'open').mockImplementation(() => null);
  const success = spyOn(toast, 'success').mockImplementation(() => 'success');
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container);
  let mounted = true;
  let connected = 0;
  const unmount = async () => {
    if (!mounted) return;
    await act(async () => root.unmount());
    mounted = false;
  };
  const switchRuntime = async () => act(async () => {
    opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://other.test', epoch: 2, version: '1.18.32' });
  });
  const click = async (text) => {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === text);
    expect(button).toBeDefined();
    await act(async () => { button.click(); await tick(); });
  };
  const respond = async (index, data, status = 200) => {
    expect(pending[index]).toBeDefined();
    await act(async () => { pending[index](Response.json(data, { status })); await tick(); });
  };
  try {
    await act(async () => root.render(React.createElement(I18nProvider, null,
      React.createElement(ProviderOAuthMethods, { providerId: 'test-provider',
        methods: [{ index: 0, label: 'Test OAuth' }], onConnected: async () => { connected += 1; } }))));
    await click('Connect');
    expect(requests).toHaveLength(1);
    await run({ container, requests, opened, success, click, respond, switchRuntime, unmount, connected: () => connected });
  } finally {
    await unmount();
    fetch.mockRestore();
    opened.mockRestore();
    success.mockRestore();
    opencodeClient.setDirectory(undefined);
    setRuntimeUrlResolver(previous);
    opencodeClient.reconnectToRuntimeBaseUrl();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
    await dom.happyDOM.close();
  }
}

for (const retire of ['switch', 'unmount', 'directory']) {
  test(`late authorize after ${retire} cannot open a browser or dispatch callback`, async () => fixture(async (view) => {
    if (retire === 'switch') await view.switchRuntime();
    else if (retire === 'directory') opencodeClient.setDirectory('/next');
    else await view.unmount();
    if (retire !== 'directory') expect(view.requests[0].signal.aborted).toBe(true);
    await view.respond(0, { url: 'https://signin.test', method: 'auto' });
    expect(view.requests[0].signal.aborted).toBe(true);
    if (retire === 'directory') expect(view.container.querySelector('button').disabled).toBe(false);
    expect(view.opened).not.toHaveBeenCalled();
    expect(view.requests).toHaveLength(1);
    expect(view.success).not.toHaveBeenCalled();
    expect(view.connected()).toBe(0);
  }));
}

for (const retire of ['switch', 'cancel', 'unmount']) {
  test(`late callback after ${retire} cannot update provider success`, async () => fixture(async (view) => {
    await view.respond(0, { url: 'https://signin.test', method: 'auto' });
    expect(view.requests).toHaveLength(2);
    if (retire === 'switch') await view.switchRuntime();
    else if (retire === 'cancel') await view.click('Cancel');
    else await view.unmount();
    expect(view.requests[1].signal.aborted).toBe(true);
    await view.respond(1, true);
    expect(view.success).not.toHaveBeenCalled();
    expect(view.connected()).toBe(0);
    expect(view.requests).toHaveLength(2);
  }));
}

test('code authorization is retired on switch without sending a callback to the new connection', async () => fixture(async (view) => {
  await view.respond(0, { url: 'https://signin.test', method: 'code' });
  expect(view.container.querySelectorAll('input').length).toBeGreaterThan(0);
  await view.switchRuntime();
  expect(view.container.querySelectorAll('input')).toHaveLength(0);
  expect(view.requests).toHaveLength(1);
  expect(view.connected()).toBe(0);
}));

test('normal auto flow sends both SDK requests with its captured directory and reports completion once', async () => fixture(async (view) => {
  await view.respond(0, { url: 'https://signin.test', method: 'auto' });
  await view.respond(1, true);
  expect(view.opened).toHaveBeenCalledTimes(1);
  expect(view.success).toHaveBeenCalledTimes(1);
  expect(view.connected()).toBe(1);
  for (const request of view.requests) {
    expect(new URL(request.url).searchParams.get('directory')).toBe('/original');
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ method: 0 });
  }
}));

test('late authorize failure after switch cannot replace the idle view with an old error', async () => fixture(async (view) => {
  await view.switchRuntime();
  await view.respond(0, { error: 'old authorization failure' }, 400);
  expect(view.container.querySelector('button').disabled).toBe(false);
  expect(view.container.textContent).not.toContain('old authorization failure');
  expect(view.success).not.toHaveBeenCalled();
  expect(view.connected()).toBe(0);
}));