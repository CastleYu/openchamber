import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import { I18nProvider } from '@/lib/i18n';
import { agentConnectionSchema, type AgentConnection, type ConnectionSnapshot } from '@/lib/agent-connection';
import { AgentConnectionSettings } from './AgentConnectionSettings';

test('server settings hydrate mappings, submit them and persist removal through the connection API', async () => {
  const win = new Window({ url: 'http://localhost' });
  const globals = { window: win, document: win.document, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, getComputedStyle: win.getComputedStyle.bind(win), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const config = agentConnectionSchema.parse({ mode: 'acp-server', transport: 'websocket', url: 'ws://agent.test/acp', cwd: '/remote/default', projectMappings: [{ directory: '/local/one', cwd: '/remote/one' }] });
  const initial: ConnectionSnapshot = { config, status: 'ready', error: null, prefill: {} };
  const submitted: AgentConnection[] = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/agent/connection') && init?.method === 'POST') {
      const saved = agentConnectionSchema.parse(JSON.parse(String(init.body)));
      submitted.push(saved);
      return Response.json({ ...initial, config: saved });
    }
    if (url.endsWith('/api/acp/info')) return Response.json({ epoch: 1, authMethods: [], error: null });
    if (url.endsWith('/api/acp/events')) return new Response(new ReadableStream({ start: (controller) => controller.close() }), { headers: { 'Content-Type': 'text/event-stream' } });
    throw new Error(`Unexpected request ${url}`);
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let ready = 0;
  try {
    await act(async () => root.render(<I18nProvider><AgentConnectionSettings initial={initial} onReady={() => { ready += 1; }} /></I18nProvider>));
    expect([...container.querySelectorAll('input')].map((input) => input.value)).toContain('/local/one');
    const apply = container.querySelector<HTMLButtonElement>('button[data-settings-item="sessions.opencode-restart"]');
    if (!apply) throw new Error('Missing apply connection action');
    await act(async () => apply.click());
    expect(submitted).toEqual([config]);
    expect(ready).toBe(1);
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove project mapping 1"]');
    if (!remove) throw new Error('Missing remove project mapping action');
    await act(async () => remove.click());
    await act(async () => apply.click());
    expect(submitted[1]).toEqual({ mode: 'acp-server', transport: 'websocket', url: 'ws://agent.test/acp', cwd: '/remote/default' });
    expect(ready).toBe(2);
  } finally {
    await act(async () => root.unmount());
    container.remove(); fetch.mockRestore();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
