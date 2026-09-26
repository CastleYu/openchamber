import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { plugin } from 'bun';
import { pathToFileURL } from 'node:url';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';

import type { ToolPart as ToolPartData } from '@/lib/opencode/model';
import { opencodeClient } from '@/lib/opencode/client';
import { SyncProvider } from '@/sync/sync-context';
import { sourceFromSdk } from '@/sync/__tests__/source-fixture';
import { I18nProvider } from '@/lib/i18n';
import { ThemeSystemContext, type ThemeContextValue } from '@/contexts/theme-system-context';
import { getDefaultTheme } from '@/lib/theme/themes';

plugin({
  name: 'tool-execute-worker-url',
  setup(build) {
    build.onLoad({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, ({ path }) => ({
      contents: `export default ${JSON.stringify(pathToFileURL(path.split('?')[0]).href)};`,
      loader: 'js',
    }));
  },
});

const { default: ToolPart } = await import('./ToolPart');
const theme = getDefaultTheme(false);
const unchanged = (): never => { throw new Error('Rendering must not update the theme'); };
const themeContext: ThemeContextValue = {
  currentTheme: theme,
  availableThemes: [theme],
  setTheme: unchanged,
  customThemesLoading: false,
  reloadCustomThemes: unchanged,
  importTheme: unchanged,
  deleteImportedTheme: unchanged,
  customThemeIds: [],
  isSystemPreference: false,
  setSystemPreference: unchanged,
  themeMode: 'light',
  setThemeMode: unchanged,
  lightThemeId: theme.metadata.id,
  darkThemeId: getDefaultTheme(true).metadata.id,
  setLightThemePreference: unchanged,
  setDarkThemePreference: unchanged,
};

const part: ToolPartData = {
  id: 'prt_execute', sessionID: 'ses_execute', messageID: 'msg_execute',
  type: 'tool', tool: 'execute', callID: 'call_execute',
  state: {
    status: 'completed', input: { code: 'const result = await tools.search({ query: "bug" })' },
    output: 'Found a result',
    metadata: {
      toolCalls: [
        { tool: 'search', status: 'completed', input: { query: 'bug' } },
        { tool: 'read', status: 'error', input: { path: 'src/a.ts' } },
        { tool: 'index', status: 'running', input: {} },
      ],
      truncated: true,
      outputPath: '/tmp/opencode/execute-output.txt',
    },
    time: { start: 1, end: 2 },
  },
};

test('OC2 execute renders its script, ordered calls, status, output and truncation while OC1 remains generic', async () => {
  const happyWindow = new Window({ url: 'http://localhost' });
  const globals = {
    window: happyWindow,
    document: happyWindow.document,
    navigator: happyWindow.navigator,
    localStorage: happyWindow.localStorage,
    customElements: happyWindow.customElements,
    Node: happyWindow.Node,
    Text: happyWindow.Text,
    NodeList: happyWindow.NodeList,
    Element: happyWindow.Element,
    HTMLElement: happyWindow.HTMLElement,
    SVGElement: happyWindow.SVGElement,
    requestAnimationFrame: happyWindow.requestAnimationFrame.bind(happyWindow),
    cancelAnimationFrame: happyWindow.cancelAnimationFrame.bind(happyWindow),
    getComputedStyle: happyWindow.getComputedStyle.bind(happyWindow),
    ResizeObserver: happyWindow.ResizeObserver,
    MutationObserver: happyWindow.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const sdk = createOpencodeClient({
    baseUrl: 'http://localhost',
    fetch: async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
  });
  const render = async (tool: ToolPartData = part) => {
    await act(async () => {
      root.render(
        <SyncProvider source={sourceFromSdk(sdk)} directory="">
          <I18nProvider>
            <ThemeSystemContext.Provider value={themeContext}>
              <ToolPart part={tool} isExpanded isMobile={false} onToggle={() => {}} />
            </ThemeSystemContext.Provider>
          </I18nProvider>
        </SyncProvider>,
      );
    });
  };

  try {
    opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'http://localhost', epoch: 'execute-test-2', version: '2.0.16' });
    await render();
    expect(container.textContent).toContain('Script');
    expect(container.textContent).toContain('Tool calls');
    expect(container.textContent).toContain('const result = await tools.search');
    const calls = Array.from(container.querySelectorAll('li')).map((row) => row.textContent);
    expect(calls).toEqual(['search{"query":"bug"}', 'read{"path":"src/a.ts"}', 'indexrunning']);
    expect(container.textContent).toContain('Found a result');
    expect(container.textContent).toContain('Output was truncated');
    expect(container.textContent).toContain('/tmp/opencode/execute-output.txt');

    await act(async () => {
      opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'http://localhost', epoch: 'execute-test-1', version: '1.18.32' });
    });
    await render();
    expect(container.textContent).not.toContain('Tool calls');
    expect(container.textContent).not.toContain('Output was truncated');

    const searchPart: ToolPartData = {
      ...part,
      id: 'prt_search', tool: 'websearch', callID: 'call_search',
      state: {
        status: 'completed', input: { query: 'OpenCode' },
        output: '## [OpenCode](https://opencode.ai/)\nPublished: 2026-09-26\n\nOfficial result.',
        metadata: { provider: 'tavily' }, time: { start: 1, end: 2 },
      },
    };
    await act(async () => {
      opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'http://localhost', epoch: 'search-test-2', version: '2.0.16' });
    });
    await render(searchPart);
    expect(container.querySelector('a[href="https://opencode.ai/"]')).not.toBeNull();
    expect(container.textContent).toContain('Official result.');
    expect(container.textContent).toContain('tavily');

    await render({
      ...searchPart,
      state: {
        status: 'completed', input: { query: 'OpenCode' }, output: 'Custom provider output',
        metadata: { provider: 'tavily' }, time: { start: 1, end: 2 },
      },
    });
    expect(container.textContent).toContain('Custom provider output');
    expect(container.querySelector('a[href="https://opencode.ai/"]')).toBeNull();

    await act(async () => {
      opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'http://localhost', epoch: 'search-test-1', version: '1.18.32' });
    });
    await render(searchPart);
    expect(container.querySelector('a[href="https://opencode.ai/"]')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    await happyWindow.happyDOM.abort();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
