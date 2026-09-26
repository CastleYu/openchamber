import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import { CommandAutocomplete } from './CommandAutocomplete';
import { useCommandsStore } from '@/stores/useCommandsStore';
import { useSkillsStore } from '@/stores/useSkillsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { opencodeClient } from '@/lib/opencode/client';
import { I18nProvider } from '@/lib/i18n';
import { SyncProvider } from '@/sync/sync-context';
import { sourceFromSdk } from '@/sync/__tests__/source-fixture';

const sdk = createOpencodeClient({
  baseUrl: 'http://localhost',
  fetch: async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
});

describe('CommandAutocomplete fork command', () => {
  let root: Root;
  let container: HTMLDivElement;
  let restoreGlobals: () => void;
  const originalLoadCommands = useCommandsStore.getState().loadCommands;
  const originalLoadSkills = useSkillsStore.getState().loadSkills;
  const originalSessionId = useSessionUIStore.getState().currentSessionId;

  beforeEach(() => {
    const win = new Window({ url: 'http://localhost' });
    const globals = {
      window: win,
      document: win.document,
      HTMLElement: win.HTMLElement,
      Element: win.Element,
      SVGElement: win.SVGElement,
      NodeList: win.NodeList,
      MouseEvent: win.MouseEvent,
      PointerEvent: win.PointerEvent,
      requestAnimationFrame: win.requestAnimationFrame.bind(win),
      cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
      getComputedStyle: win.getComputedStyle.bind(win),
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    const previous = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    for (const [name, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
    restoreGlobals = () => {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    };

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useCommandsStore.setState({ loadCommands: async () => true });
    useSkillsStore.setState({ loadSkills: async () => true });
    useSessionUIStore.setState({ currentSessionId: 'autocomplete-session' });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useCommandsStore.setState({ loadCommands: originalLoadCommands });
    useSkillsStore.setState({ loadSkills: originalLoadSkills });
    useSessionUIStore.setState({ currentSessionId: originalSessionId });
    opencodeClient.reconnectToRuntimeBaseUrl(false);
    restoreGlobals();
  });

  test('shows fork only on OC2 and follows runtime changes while mounted', async () => {
    await act(async () => {
      opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://autocomplete.test', epoch: 1, version: '1.18.32' });
      root.render(
        <SyncProvider source={sourceFromSdk(sdk)} directory="/project">
          <I18nProvider>
            <CommandAutocomplete searchQuery="fork" onCommandSelect={() => undefined} onClose={() => undefined} />
          </I18nProvider>
        </SyncProvider>,
      );
    });
    expect(container.textContent).not.toContain('/fork');

    await act(async () => {
      opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://autocomplete.test', epoch: 2, version: '2.0.16' });
    });
    expect(container.textContent).toContain('/fork');

    await act(async () => {
      opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://autocomplete.test', epoch: 3, version: '1.18.32' });
    });
    expect(container.textContent).not.toContain('/fork');
  });
});
