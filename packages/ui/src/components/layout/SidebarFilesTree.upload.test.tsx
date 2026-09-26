import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';

import { RuntimeAPIContext } from '@/contexts/runtimeAPIContext';
import { I18nProvider, useI18nStore } from '@/lib/i18n';
import type { RuntimeAPIs } from '@/lib/api/types';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { SyncProvider } from '@/sync/sync-context';
import { sourceFromSdk } from '@/sync/__tests__/source-fixture';

// Base UI detects DOM support when its modules load.
const initialWindow = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: initialWindow,
  document: initialWindow.document,
  Element: initialWindow.Element,
  HTMLElement: initialWindow.HTMLElement,
  DOMRect: initialWindow.DOMRect,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { SidebarFilesTree } = await import('./SidebarFilesTree');

type UploadCall = {
  path: string;
  fileName: string;
  directory: string | undefined;
  overwrite: boolean | undefined;
};

const unavailable = (): never => { throw new Error('The upload fixture does not use this runtime API'); };
const sdk = createOpencodeClient({
  baseUrl: 'http://fixture.local',
  fetch: async () => Response.json([]),
});
const syncSource = sourceFromSdk(sdk);

const createRuntimeAPIs = (calls: UploadCall[]): RuntimeAPIs => ({
  runtime: { platform: 'web', isDesktop: false, isVSCode: false },
  get terminal() { return unavailable(); },
  get git() { return unavailable(); },
  files: {
    listDirectory: async (directory) => ({
      directory,
      entries: directory.endsWith('/repo') || directory.endsWith('/other')
        ? [{ name: 'sub', path: `${directory}/sub`, isDirectory: true }]
        : [],
    }),
    search: async () => [],
    createDirectory: async (path) => ({ success: true, path }),
    uploadFile: async (path, file, options) => {
      const fileName = file instanceof File ? file.name : '';
      calls.push({ path, fileName, directory: options?.directory, overwrite: options?.overwrite });
      return { success: true, path };
    },
  },
  get settings() { return unavailable(); },
  get permissions() { return unavailable(); },
  get notifications() { return unavailable(); },
  get tools() { return unavailable(); },
});

const installDOM = () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    DOMRect: dom.DOMRect,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    PointerEvent: dom.PointerEvent,
    File: dom.File,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    getComputedStyle: dom.getComputedStyle.bind(dom),
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

const findInput = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Missing upload file picker');
  return input;
};

const selectFiles = async (input: HTMLInputElement, files: File[]) => {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const renderTree = (root: Root, apis: RuntimeAPIs) => act(async () => {
  const directory = useDirectoryStore.getState().currentDirectory;
  root.render(
    <SyncProvider source={syncSource} directory={directory}>
      <I18nProvider>
        <RuntimeAPIContext.Provider value={apis}>
          <SidebarFilesTree />
        </RuntimeAPIContext.Provider>
      </I18nProvider>
    </SyncProvider>,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('uploads from the toolbar root and a directory context menu through the shared picker', async () => {
  const fixture = installDOM();
  const calls: UploadCall[] = [];
  const apis = createRuntimeAPIs(calls);
  useI18nStore.getState().setLocale('en');
  useDirectoryStore.setState({ currentDirectory: '/repo' });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await renderTree(root, apis);
    const picker = findInput(container);
    expect(picker.multiple).toBe(true);
    let pickerClicks = 0;
    picker.addEventListener('click', () => { pickerClicks += 1; });

    const rootUpload = container.querySelector<HTMLButtonElement>('button[aria-label="Upload files"]');
    if (!rootUpload) throw new Error('Missing root upload action');
    await act(async () => rootUpload.click());
    expect(pickerClicks).toBe(1);
    await selectFiles(picker, [new File(['root'], 'root.txt')]);
    expect(calls[0]).toEqual({ path: '/repo/root.txt', fileName: 'root.txt', directory: '/repo', overwrite: false });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    const directoryPath = container.querySelector<HTMLElement>('span[title="/repo/sub"]');
    const directoryRow = directoryPath?.closest('li');
    expect(directoryRow?.textContent).toContain('sub');
    const directoryButton = directoryRow?.querySelector<HTMLButtonElement>('button');
    if (!directoryButton) throw new Error('Missing directory row button');
    await act(async () => {
      directoryButton.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 30,
      }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const uploadMenuItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.includes('Upload Files'));
    if (!uploadMenuItem) throw new Error('Missing directory upload menu item');
    await act(async () => uploadMenuItem.click());
    expect(pickerClicks).toBe(2);
    await selectFiles(picker, [new File(['directory'], 'nested.txt')]);
    expect(calls[1]).toEqual({ path: '/repo/sub/nested.txt', fileName: 'nested.txt', directory: '/repo', overwrite: false });
  } finally {
    await act(async () => root.unmount());
    await fixture.restore();
  }
});

test('rejects files selected after the workspace root changes while the picker is open', async () => {
  const fixture = installDOM();
  const calls: UploadCall[] = [];
  const apis = createRuntimeAPIs(calls);
  useI18nStore.getState().setLocale('en');
  useDirectoryStore.setState({ currentDirectory: '/repo' });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await renderTree(root, apis);
    const picker = findInput(container);
    const rootUpload = container.querySelector<HTMLButtonElement>('button[aria-label="Upload files"]');
    if (!rootUpload) throw new Error('Missing root upload action');
    await act(async () => rootUpload.click());

    await act(async () => {
      useDirectoryStore.setState({ currentDirectory: '/other' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(findInput(container)).toBe(picker);
    await selectFiles(picker, [new File(['stale'], 'stale.txt')]);
    expect(calls).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    await fixture.restore();
  }
});
