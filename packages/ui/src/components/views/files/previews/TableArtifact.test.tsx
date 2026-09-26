import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { TableArtifact } from './TableArtifact';

const installDOM = () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return {
    dom,
    restore: async () => {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      await dom.happyDOM.close();
    },
  };
};

const mount = async (path: string, content: string) => {
  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider><TableArtifact path={path} content={content} sizeBytes={null} /></I18nProvider>);
  });
  return { container, root };
};

test('renders quoted CSV values containing commas, doubled quotes, and line breaks', async () => {
  const fixture = installDOM();
  let root: Awaited<ReturnType<typeof mount>>['root'] | null = null;
  try {
    const mounted = await mount('notes.csv', 'name,note\nAda,"a, comma and ""quoted"" text"\nGrace,"line one\nline two"\n');
    root = mounted.root;
    const rows = mounted.container.querySelectorAll('tbody tr');
    expect(mounted.container.textContent).toContain('2 rows · 2 columns');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelectorAll('td')[1]?.textContent).toBe('a, comma and "quoted" text');
    expect(rows[1]?.querySelectorAll('td')[1]?.textContent).toBe('line one\nline two');
  } finally {
    if (root) await act(async () => root?.unmount());
    await fixture.restore();
  }
});

test('renders the row cap and explicit truncation count', async () => {
  const fixture = installDOM();
  let root: Awaited<ReturnType<typeof mount>>['root'] | null = null;
  try {
    const content = ['index', ...Array.from({ length: 2_002 }, (_, index) => `row-${index + 1}`)].join('\n');
    const mounted = await mount('large.csv', content);
    root = mounted.root;
    const rows = mounted.container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2_000);
    expect(rows[0]?.textContent).toBe('row-1');
    expect(rows[1_999]?.textContent).toBe('row-2000');
    expect(mounted.container.textContent).toContain('Showing the first 2000 of 2002 rows');
    expect(mounted.container.textContent).not.toContain('row-2001');
  } finally {
    if (root) await act(async () => root?.unmount());
    await fixture.restore();
  }
});

test('shows the empty-table message for a file with no rows', async () => {
  const fixture = installDOM();
  let root: Awaited<ReturnType<typeof mount>>['root'] | null = null;
  try {
    const mounted = await mount('empty.csv', '');
    root = mounted.root;
    expect(mounted.container.querySelector('table')).toBeNull();
    expect(mounted.container.textContent).toContain('This file has no rows.');
  } finally {
    if (root) await act(async () => root?.unmount());
    await fixture.restore();
  }
});
