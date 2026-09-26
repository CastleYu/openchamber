import { describe, expect, test } from 'bun:test';
import type { IntegrationInfo } from '@opencode/client';
import { disconnectProviderV2, type DisconnectProviderOperations } from './disconnectProviderV2';

const integration = (connections: IntegrationInfo['connections']): IntegrationInfo => ({
  id: 'p', name: 'Provider', methods: [], connections,
});

describe('OC2 provider disconnect', () => {
  test('removes each credential and configuration before reporting success', async () => {
    const calls: string[] = [];
    const operations: DisconnectProviderOperations = {
      removeCredential: async (id) => { calls.push(`credential:${id}`); },
      removeConfig: async () => { calls.push('config'); return true; },
      listIntegrations: async () => { calls.push('verify'); return [integration([])]; },
    };
    await disconnectProviderV2('p', [integration([
      { type: 'credential', id: 'a', label: 'A', method: 'key' },
      { type: 'credential', id: 'b', label: 'B', method: 'oauth' },
    ])], operations);
    expect(calls).toEqual(['credential:a', 'credential:b', 'config', 'verify']);
  });

  test('stops on a failed credential deletion without removing configuration', async () => {
    const calls: string[] = [];
    const operations: DisconnectProviderOperations = {
      removeCredential: async () => { calls.push('credential'); throw new Error('failed'); },
      removeConfig: async () => { calls.push('config'); return true; },
      listIntegrations: async () => { calls.push('verify'); return []; },
    };
    await expect(disconnectProviderV2('p', [integration([
      { type: 'credential', id: 'a', label: 'A', method: 'key' },
    ])], operations)).rejects.toThrow('failed');
    expect(calls).toEqual(['credential']);
  });

  test('refuses to claim an environment connection was removed', async () => {
    const operations: DisconnectProviderOperations = {
      removeCredential: async () => { throw new Error('unexpected'); },
      removeConfig: async () => { throw new Error('unexpected'); },
      listIntegrations: async () => { throw new Error('unexpected'); },
    };
    await expect(disconnectProviderV2('p', [integration([
      { type: 'env', name: 'PROVIDER_KEY' },
    ])], operations)).rejects.toThrow('environment-provided');
  });

  test('requires a confirmed disconnected integration after writes', async () => {
    const operations: DisconnectProviderOperations = {
      removeCredential: async () => {},
      removeConfig: async () => true,
      listIntegrations: async () => [integration([
        { type: 'credential', id: 'a', label: 'A', method: 'key' },
      ])],
    };
    await expect(disconnectProviderV2('p', [integration([])], operations))
      .rejects.toThrow('still has an active connection');
  });

  test('does not report success when neither OpenCode nor configuration removed a connection', async () => {
    const operations: DisconnectProviderOperations = {
      removeCredential: async () => {},
      removeConfig: async () => false,
      listIntegrations: async () => [],
    };
    await expect(disconnectProviderV2('p', [integration([])], operations))
      .rejects.toThrow('No provider connection was removed');
  });
});
