import { describe, expect, test } from 'bun:test';
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';
import { OpenCodeRuntimeBinding, OpenCodeRuntimeChangedError } from '@/lib/opencode/runtime';
import { createV1SyncSource, type SyncBootstrapOperations } from './source';

const runtime = (epoch: number) => ({ generation: 'oc1' as const, endpoint: 'http://127.0.0.1:4096', epoch, version: '1.18.32' });

describe('sync source epoch', () => {
  test('a retained source cannot start a request after a same-generation rebind', async () => {
    const binding = new OpenCodeRuntimeBinding();
    binding.set(runtime(1));
    let calls = 0;
    const sdk = { session: { list: async () => { calls += 1; return { data: [] }; } } } as unknown as OpencodeClient;
    const source = createV1SyncSource(sdk, binding, {} as SyncBootstrapOperations);
    binding.set(runtime(2));
    await expect(source.listSessions('/repo')).rejects.toThrow(OpenCodeRuntimeChangedError);
    expect(calls).toBe(0);
  });

  test('an OC1 source keeps the complete event vocabulary intact at ingress', async () => {
    const binding = new OpenCodeRuntimeBinding();
    binding.set(runtime(1));
    const payload = { id: 'evt-1', type: 'todo.updated', properties: { sessionID: 'ses-1', todos: [] } };
    const envelope = { directory: '/new-project', payload };
    const sdk = { global: { event: async () => ({ stream: (async function* () { yield envelope; })() }) } } as unknown as OpencodeClient;
    const source = createV1SyncSource(sdk, binding, {} as SyncBootstrapOperations);
    const iterator = source.events(new AbortController().signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ generation: 'oc1', value: envelope });
  });
});
