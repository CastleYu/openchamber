import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import { opencodeClient } from '@/lib/opencode/client';
import { OPEN_CODE_GENERATION, OPEN_CODE_PROFILE, type OpenCodeRuntime } from '@/lib/opencode/runtime';
import { useConfigStore } from '@/stores/useConfigStore';
import { usePendingOpenCodeRestartStore } from '@/stores/usePendingOpenCodeRestartStore';

// Base UI selects its browser lifecycle when imported, as in the application.
const bootstrap = new Window({ url: 'http://localhost' });
const bootstrapGlobals = new Map(['window', 'document', 'navigator'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.assign(globalThis, { window: bootstrap, document: bootstrap.document, navigator: bootstrap.navigator });
const { createRoot } = await import('react-dom/client');
const { LegacyProvidersPage } = await import('./LegacyProvidersPage');
const { isLegacyProviderRuntime, resolveProvidersPageMode, supportsLegacyMethod } = await import('./legacy-provider-ui');
afterAll(() => {
  bootstrap.close();
  for (const [name, descriptor] of bootstrapGlobals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
});

const runtime: OpenCodeRuntime = { generation: 'oc1', profile: OPEN_CODE_PROFILE.LEGACY, version: '1.2.27', endpoint: 'http://localhost:4096', epoch: 1 };
const sourceData = { providerId: 'openai', layers: [{ path: '/user/config.json', scope: 'user', origin: 'global', order: 1, writable: true }], auth: { exists: false }, complete: true, residuals: [], application: { configuration: 'matches-persisted' } };
let win: Window;
let root: Root;
let host: HTMLDivElement;
let oldFetch: typeof fetch;
let oldGlobals: Map<string, PropertyDescriptor | undefined>;
let requests: Array<{ path: string; signal: AbortSignal | null }>;

beforeEach(() => {
  win = new Window({ url: 'http://localhost' });
  oldGlobals = new Map(['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'DocumentFragment', 'MutationObserver', 'HTMLInputElement', 'HTMLButtonElement', 'NodeFilter', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, Event: win.Event, CustomEvent: win.CustomEvent, DocumentFragment: win.DocumentFragment, MutationObserver: win.MutationObserver, HTMLInputElement: win.HTMLInputElement, HTMLButtonElement: win.HTMLButtonElement, NodeFilter: win.NodeFilter, getComputedStyle: win.getComputedStyle.bind(win), requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win), IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  oldFetch = globalThis.fetch; requests = [];
  usePendingOpenCodeRestartStore.getState().clear();
  win.open = () => null;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    requests.push({ path, signal: init?.signal ?? null });
    if (path.endsWith('/methods')) return Response.json({ openai: [{ type: 'api', label: 'API key' }, { type: 'oauth', label: 'Sign in' }] });
    if (path.endsWith('/sources')) return Response.json(sourceData);
    return Response.json({ error: 'unsupported' }, { status: 501 });
  };
  opencodeClient.bindRuntime(runtime);
  useConfigStore.setState((state) => ({ ...state, providers: [{ id: 'openai', name: 'OpenAI', source: 'config', env: [], options: {}, generation: 'oc1', models: [] }], providersLoaded: true }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  globalThis.fetch = oldFetch;
  usePendingOpenCodeRestartStore.getState().clear();
  win.close();
  for (const [name, descriptor] of oldGlobals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
});

const renderPage = async () => act(async () => { root.render(<I18nProvider><LegacyProvidersPage /></I18nProvider>); await new Promise((resolve) => setTimeout(resolve, 0)); });

test('loads methods and each provider source once despite component state updates', async () => {
  await renderPage();
  expect(requests.filter((request) => request.path.endsWith('/sources'))).toHaveLength(1);
  expect(host.textContent).toContain('/user/config.json');
});

test('aborts pending source reads when the page unmounts', async () => {
  let resolveRead: ((response: Response) => void) | undefined;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    requests.push({ path, signal: init?.signal ?? null });
    if (path.endsWith('/methods')) return Response.json({ openai: [] });
    return new Promise<Response>((resolve) => { resolveRead = resolve; });
  };
  await act(async () => root.render(<I18nProvider><LegacyProvidersPage /></I18nProvider>));
  const sourceRequest = requests.find((request) => request.path.endsWith('/sources'));
  expect(sourceRequest?.signal?.aborted).toBe(false);
  await act(async () => root.unmount());
  expect(sourceRequest?.signal?.aborted).toBe(true);
  resolveRead?.(Response.json(sourceData));
});

test('keeps configured custom providers closed for initial credential writes', async () => {
  const custom = { ...useConfigStore.getState().providers[0], id: 'custom', name: 'Custom', source: 'custom' as const, options: { baseURL: 'https://custom.example/v1' } };
  useConfigStore.setState((state) => ({ ...state, providers: [custom] }));
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    requests.push({ path, signal: init?.signal ?? null });
    return path.endsWith('/methods') ? Response.json({ custom: [{ type: 'api', label: 'API key' }] }) : Response.json({ ...sourceData, providerId: 'custom' });
  };
  await renderPage();
  expect(host.textContent).toContain('Custom provider editing and initial credential setup are unavailable');
  expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.includes('Save'))).toBe(false);
  expect(requests.filter((request) => request.path.endsWith('/methods'))).toHaveLength(1);
  expect(requests.filter((request) => request.path.endsWith('/sources'))).toHaveLength(1);
});


test('preserves unknown credential state after a partial disconnect and source refresh', async () => {
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    requests.push({ path, signal: init?.signal ?? null });
    if (path.endsWith('/methods')) return Response.json({ openai: [] });
    if (path.endsWith('/disconnect')) return Response.json({ outcome: { partial: true, credential: 'unknown', requiresRestart: true } }, { status: 500 });
    return Response.json(sourceData);
  };
  await renderPage();
  const disconnect = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Disconnect'));
  expect(disconnect).toBeDefined();
  await act(async () => { disconnect?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(host.textContent).toContain('The write may be partial.');
  expect(host.textContent).toContain('Unknown');
  expect(requests.filter((request) => request.path.endsWith('/sources'))).toHaveLength(2);
});

test('shows partial source outcomes without presenting them as complete', async () => {
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    requests.push({ path, signal: init?.signal ?? null });
    if (path.endsWith('/methods')) return Response.json({ openai: [] });
    return Response.json({ ...sourceData, complete: false, residuals: ['environment'] });
  };
  await renderPage();
  expect(host.textContent).toContain('Configuration sources are incomplete.');
  expect(host.textContent).toContain('Environment variables');
});

test('aborts old scoped reads when the bound runtime changes', async () => {
  await renderPage();
  const first = requests.find((request) => request.path.endsWith('/sources'));
  await act(async () => opencodeClient.bindRuntime({ ...runtime, epoch: 2 }));
  expect(first?.signal?.aborted).toBe(true);
  expect(requests.filter((request) => request.path.endsWith('/sources'))).toHaveLength(2);
});

test('keeps exact Legacy dispatcher behavior and refuses unsupported prompts', () => {
  expect(isLegacyProviderRuntime(runtime)).toBe(true);
  expect(resolveProvidersPageMode(runtime)).toBe('legacy');
  expect(resolveProvidersPageMode({ ...runtime, profile: OPEN_CODE_PROFILE.OC1 })).toBe('oc1');
  expect(resolveProvidersPageMode({ ...runtime, generation: OPEN_CODE_GENERATION.OC2 })).toBe('oc2');
  expect(resolveProvidersPageMode(null)).toBe('none');
  expect(supportsLegacyMethod({ type: 'oauth', label: 'Sign in', prompts: [{ type: 'text', key: 'team', message: 'Team' }] })).toBe(false);
});

test('loads a usable page under the application StrictMode lifecycle', async () => {
  await act(async () => { root.render(<React.StrictMode><I18nProvider><LegacyProvidersPage /></I18nProvider></React.StrictMode>); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(host.textContent).toContain('/user/config.json');
  expect(host.querySelector('input')?.disabled).toBe(false);
  expect(requests.filter((request) => request.path.endsWith('/sources')).length).toBeLessThanOrEqual(2);
});

test('reports an OAuth callback partial outcome instead of swallowing it during cleanup', async () => {
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    requests.push({ path, signal: init?.signal ?? null });
    if (path.endsWith('/methods')) return Response.json({ openai: [{ type: 'oauth', label: 'Sign in' }] });
    if (path.endsWith('/sources')) return Response.json(sourceData);
    if (path.endsWith('/oauth/begin')) return Response.json({ attemptId: 'attempt' });
    if (path.endsWith('/oauth/authorize')) return Response.json({ url: 'https://provider.invalid/authorize', method: 'auto', instructions: '' });
    if (path.endsWith('/oauth/callback')) return Response.json({ credential: 'unknown', requiresRestart: true }, { status: 502 });
    return Response.json({ canceled: true });
  };
  await renderPage();
  const signIn = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Sign in'));
  expect(signIn?.disabled).toBe(false);
  await act(async () => { signIn?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(host.textContent).toContain('The write may be partial.');
  expect(host.textContent).toContain('Unknown');
  expect(signIn?.disabled).toBe(true);
  expect(usePendingOpenCodeRestartStore.getState().changes).toHaveLength(1);
  expect(requests.some((request) => /reload|restart/.test(request.path))).toBe(false);
});

test('cancels a retained manual-code flow when the page unmounts', async () => {
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    requests.push({ path, signal: init?.signal ?? null });
    if (path.endsWith('/methods')) return Response.json({ openai: [{ type: 'oauth', label: 'Sign in' }] });
    if (path.endsWith('/sources')) return Response.json(sourceData);
    if (path.endsWith('/oauth/begin')) return Response.json({ attemptId: 'attempt' });
    if (path.endsWith('/oauth/authorize')) return Response.json({ url: 'https://provider.invalid/authorize', method: 'code', instructions: '' });
    return Response.json({ canceled: true });
  };
  await renderPage();
  const signIn = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Sign in'));
  await act(async () => { signIn?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(requests.filter((request) => request.path.endsWith('/oauth/cancel'))).toHaveLength(1);
  expect(requests.some((request) => request.path.endsWith('/oauth/callback'))).toBe(false);
});
