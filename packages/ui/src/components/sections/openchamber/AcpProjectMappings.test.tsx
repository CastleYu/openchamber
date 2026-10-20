import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { I18nProvider } from '@/lib/i18n';
import type { AcpProjectMapping } from '@/lib/agent-connection';
import { AcpProjectMappings } from './AcpProjectMappings';

test('mapping rows add and remove independently, retain input identity and respect busy state', async () => {
  const win = new Window({ url: 'http://localhost' });
  const globals = { window: win, document: win.document, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, getComputedStyle: win.getComputedStyle.bind(win), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let rows: AcpProjectMapping[] = [{ directory: '/local/one', cwd: '/remote/one' }, { directory: '/local/two', cwd: '/remote/two' }];
  let disabled = false;
  const render = () => root.render(<I18nProvider><AcpProjectMappings value={rows} disabled={disabled} onChange={(value) => { rows = value; render(); }} /></I18nProvider>);
  try {
    await act(async () => render());
    const retained = container.querySelectorAll('input')[2];
    expect(retained?.value).toBe('/local/two');
    const remove = container.querySelectorAll('button')[1];
    if (!remove) throw new Error('Missing remove mapping action');
    await act(async () => remove.click());
    expect(rows).toEqual([{ directory: '/local/two', cwd: '/remote/two' }]);
    expect(container.querySelector('input')).toBe(retained);
    const add = container.querySelectorAll('button')[container.querySelectorAll('button').length - 1];
    if (!add) throw new Error('Missing add mapping action');
    await act(async () => add.click());
    expect(rows).toEqual([{ directory: '/local/two', cwd: '/remote/two' }, { directory: '', cwd: '' }]);
    expect(container.querySelectorAll('input')).toHaveLength(4);
    disabled = true;
    await act(async () => render());
    expect([...container.querySelectorAll('input')].every((input) => input.disabled)).toBe(true);
    expect([...container.querySelectorAll('button')].slice(1).every((button) => button.disabled)).toBe(true);
    expect([...container.querySelectorAll('input')].every((input) => Boolean(input.getAttribute('aria-label')))).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
