import { describe, expect, test } from 'bun:test';
import { OpenCode, type ModelInfo } from '@opencode/client';
import { OpenCodeRuntimeBinding } from '../runtime';
import { V2CatalogOperations } from './catalog';

const model: ModelInfo = {
  id: 'derived-fast', modelID: 'provider-model', providerID: 'fixture', name: 'Derived fast',
  capabilities: { tools: true, input: ['text'], output: ['text'] },
  variants: [], time: { released: 0 }, cost: [], status: 'active', enabled: true,
  limit: { context: 1000, output: 100 },
};

describe('OC2 intake catalog boundaries', () => {
  test('keeps derived catalog identity and reads host providers for a Space model list', async () => {
    const requests: Array<{ owner: string; route: string }> = [];
    const makeClient = (owner: string) => OpenCode.make({ baseUrl: 'http://catalog.test', fetch: async (input, init) => {
      const route = new URL(new Request(input, init).url).pathname;
      requests.push({ owner, route });
      if (route === '/api/integration' || route === '/api/provider') return Response.json({ data: [] });
      if (route === '/api/model') return Response.json({ data: [model] });
      if (route === '/api/model/default') return Response.json({ data: model });
      throw new Error(`Unexpected route ${route}`);
    } });
    const host = makeClient('host');
    const space = makeClient('space');
    const binding = new OpenCodeRuntimeBinding();
    binding.set({ generation: 'oc2', endpoint: 'http://catalog.test', epoch: 1, version: '2.0.18' });
    const catalog = new V2CatalogOperations(directory => directory ? space : host, binding);
    const result = await catalog.catalog({ directory: '/spaces/a1b2c3d4e5f6/project' });
    expect(result.generation).toBe('oc2');
    if (result.generation === 'oc2') expect(result.default).toEqual({ id: 'derived-fast', providerID: 'fixture' });
    expect(requests).toEqual([
      { owner: 'host', route: '/api/integration' },
      { owner: 'host', route: '/api/provider' },
      { owner: 'space', route: '/api/model' },
      { owner: 'space', route: '/api/model/default' },
    ]);
  });
});
