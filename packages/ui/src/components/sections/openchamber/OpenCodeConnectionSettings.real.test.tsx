import { expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { z } from 'zod';

// Opt-in fixture starts an isolated production host and passes session auth in
// the child environment. It never reads credentials from the developer's host.
const fixture = z.object({ origin: z.url(), cookie: z.string().min(1) }).safeParse({ origin: process.env.INT02_EDITOR_HOST, cookie: process.env.INT02_EDITOR_COOKIE });
const run = fixture.success ? test : test.skip;
run('React confirmation recovers a real OC2 cold host and initializes the existing client', async () => {
  if (!fixture.success) throw new Error('Missing isolated fixture');
  const { origin, cookie } = fixture.data;
  const browser = new Window({ url: origin });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage, Element: browser.Element, HTMLElement: browser.HTMLElement, CustomEvent: browser.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const { createRoot } = await import('react-dom/client');
  const { configureRuntimeUrlResolver } = await import('@/lib/runtime-url');
  const { setRuntimeExtraHeaders } = await import('@/lib/runtime-auth');
  const { I18nProvider } = await import('@/lib/i18n');
  const { useConfigStore } = await import('@/stores/useConfigStore');
  const { opencodeClient } = await import('@/lib/opencode/client');
  const { OpenCodeConnectionSettings } = await import('./OpenCodeConnectionSettings');
  configureRuntimeUrlResolver({ apiBaseUrl: origin });
  setRuntimeExtraHeaders({ Cookie: cookie });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const headers = { Cookie: cookie };
  const profile = z.object({ status: z.string().optional(), profile: z.string().optional(), version: z.string().nullable().optional() });
  const inspect = async () => {
    const response = await fetch(origin + '/api/opencode/runtime', { headers });
    expect(response.status).toBe(200);
    return profile.parse(await response.json());
  };
  const wait = async (condition: () => boolean) => {
    const deadline = Date.now() + 75000;
    while (!condition() && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(condition()).toBe(true);
  };
  try {
    await act(async () => root.render(<I18nProvider><OpenCodeConnectionSettings /></I18nProvider>));
    await wait(() => document.body.textContent?.includes('Previous settings') === true);
    expect((await inspect()).status).not.toBe('ready');
    const candidates = Array.from(document.querySelectorAll('button')).filter(item => item.textContent === 'Use candidate');
    const candidate = candidates.at(-1);
    if (!candidate) throw new Error('Missing legacy settings candidate');
    await act(async () => candidate.click());
    expect((await inspect()).status).not.toBe('ready');
    const confirm = Array.from(document.querySelectorAll('button')).find(item => item.textContent === 'Confirm and connect');
    if (!confirm) throw new Error('Missing confirmation');
    await act(async () => confirm.click());
    await wait(() => !confirm.disabled);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(await inspect()).toMatchObject({ status: 'ready', profile: 'oc2', version: '2.0.20' });
    expect(opencodeClient.getBoundRuntime()?.generation).toBe('oc2');
    expect(useConfigStore.getState().isInitialized).toBe(true);
    expect(useConfigStore.getState().isConnected).toBe(true);
    expect(document.body.textContent).not.toContain('Use candidate');
  } finally {
    await act(async () => root.unmount());
    setRuntimeExtraHeaders(null);
    await browser.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}, 120000);
