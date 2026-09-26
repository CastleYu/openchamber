import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { McpCatalog } from '@/lib/opencode/operations';

let catalog: McpCatalog = { generation: 'oc2', value: [] };
let fail = false;
const calls: string[] = [];

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    getMcpCatalog: async () => {
      if (fail) throw new Error('offline');
      return catalog;
    },
    connectMcpServer: async (name: string) => { calls.push(`connect:${name}`); },
    disconnectMcpServer: async (name: string) => { calls.push(`disconnect:${name}`); },
  },
}));
mock.module('@/stores/useDirectoryStore', () => ({
  useDirectoryStore: { getState: () => ({ currentDirectory: '/repo' }) },
}));
mock.module('@/lib/runtime-fetch', () => ({ runtimeFetch: async () => Response.json({}) }));

const { useMcpStore } = await import('./useMcpStore');

describe('MCP protocol catalog', () => {
  beforeEach(() => {
    catalog = { generation: 'oc2', value: [] };
    fail = false;
    calls.length = 0;
    useMcpStore.getState().resetForRuntimeSwitch();
  });

  test('keeps OC2 pending status and integration identity', async () => {
    catalog = { generation: 'oc2', value: [
      { name: 'alpha', status: { status: 'pending' }, integrationID: 'int_alpha' },
      { name: 'beta', status: { status: 'failed', error: 'denied' } },
    ] };
    await useMcpStore.getState().refresh({ directory: '/repo' });
    expect(useMcpStore.getState().getStatusForDirectory('/repo').alpha).toEqual({ status: 'pending' });
    expect(useMcpStore.getState().catalogByDirectory['/repo']).toEqual(catalog);
    expect(useMcpStore.getState().getDiagnosticForDirectory('/repo').beta?.error).toBe('denied');
    await useMcpStore.getState().connect('alpha', '/repo');
    expect(calls).toEqual(['connect:alpha']);
  });

  test('a failed read preserves the last authoritative snapshot', async () => {
    catalog = { generation: 'oc2', value: [{ name: 'alpha', status: { status: 'connected' } }] };
    await useMcpStore.getState().refresh({ directory: '/repo' });
    fail = true;
    await useMcpStore.getState().refresh({ directory: '/repo' });
    expect(useMcpStore.getState().getStatusForDirectory('/repo').alpha).toEqual({ status: 'connected' });
    expect(useMcpStore.getState().getErrorForDirectory('/repo')).toBe('offline');
  });
});
