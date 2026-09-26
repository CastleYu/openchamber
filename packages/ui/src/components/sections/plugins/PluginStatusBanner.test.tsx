import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';

import { I18nProvider } from '@/lib/i18n';
import { opencodeClient } from '@/lib/opencode/client';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { getPluginsScopeKey, usePluginsStore } from '@/stores/usePluginsStore';
import { PluginStatusBanner } from './PluginStatusBanner';

test('a failed runtime read shows unknown, while a failed plugin shows its error and log ref', async () => {
  const browser = new Window({ url: 'http://localhost/' });
  const previous = {
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  };
  Object.assign(globalThis, {
    window: browser, document: browser.document, navigator: browser.navigator,
    localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'http://localhost', epoch: 'plugin-status-test', version: '2.0.16' });
  useProjectsStore.setState({ projects: [{ id: 'a', path: '/a' }], activeProjectId: 'a' });
  const scope = getPluginsScopeKey('/a');
  const target = { kind: 'package' as const, target: 'foo@2' };
  const render = async () => act(async () => { root.render(<I18nProvider><PluginStatusBanner target={target} name="foo@2" /></I18nProvider>); });

  try {
    usePluginsStore.setState({ runtime: { kind: 'failed', scope } });
    await render();
    expect(host.textContent).toContain('Status unknown');
    expect(host.textContent).not.toContain('Not loaded');

    await act(async () => {
      usePluginsStore.setState({ runtime: { kind: 'ready', scope, plugins: [
        { source: { kind: 'package', target: 'foo@2', version: null, outdated: false, updating: false }, state: { kind: 'failed', error: 'Cannot import module', ref: 'err_1' } },
      ] } });
    });
    expect(host.textContent).toContain('Failed to load');
    expect(host.textContent).toContain('Cannot import module');
    expect(host.textContent).toContain('err_1');
  } finally {
    await act(async () => root.unmount());
    browser.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
