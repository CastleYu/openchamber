import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';

const directories: Array<string | null> = [];
mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    getMcpCatalog: async (directory: string | null) => {
      directories.push(directory);
      return { generation: 'oc2', value: [{ name: 'remote', integrationID: 'mcp_exact' }] };
    },
    listIntegrations: async (directory: string | null) => {
      directories.push(directory);
      return { data: [
        { id: 'mcp_other', name: 'Other', methods: [{ type: 'oauth', id: 'wrong', label: 'Wrong' }], metadata: { source: 'mcp', name: 'remote' } },
        { id: 'mcp_exact', name: 'Exact', methods: [{ type: 'oauth', id: 'browser', label: 'Browser' }] },
      ] };
    },
  },
}));
mock.module('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
mock.module('@/components/sections/providers/ProviderOAuthMethodsV2', () => ({
  ProviderOAuthMethods: ({ integrationId, directory, successToast }: { integrationId: string; directory: string | null; successToast: boolean }) => (
    <div data-integration={integrationId} data-directory={directory} data-success-toast={String(successToast)} />
  ),
}));

const { McpOAuthSignIn } = await import('./McpOAuthSignIn');

describe('MCP OAuth integration selection', () => {
  let host: HTMLDivElement;
  let root: Root;
  let windowInstance: Window;

  beforeEach(() => {
    directories.length = 0;
    windowInstance = new Window({ url: 'http://localhost/' });
    Object.assign(globalThis, { window: windowInstance, document: windowInstance.document, navigator: windowInstance.navigator, IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    windowInstance.close();
  });

  test('uses catalog integrationID and passes the same directory to the OAuth flow', async () => {
    await act(async () => { root.render(<McpOAuthSignIn serverName="remote" directory="/project" onConnected={() => undefined} />); });
    const method = host.querySelector('[data-integration]');
    expect(method?.getAttribute('data-integration')).toBe('mcp_exact');
    expect(method?.getAttribute('data-directory')).toBe('/project');
    expect(method?.getAttribute('data-success-toast')).toBe('false');
    expect(directories).toEqual(['/project', '/project']);
  });
});
