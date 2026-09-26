import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';
import { OpenCodeRuntimeBinding } from '@/lib/opencode/runtime';
import { projectLegacySession } from '@/lib/opencode/v1/projection';
import type { Session } from '@/lib/opencode/model';
import { createV1SyncSource, type SyncBootstrapOperations, type SyncSource } from '../source';
import { retry } from '../retry';

const data = <T>(result: { data?: T; error?: unknown }, name: string): T => {
  if (result.error || result.data === undefined) throw new Error(`${name} failed`);
  return result.data;
};

const sources = new WeakMap<OpencodeClient, SyncSource>();

export function sourceFromSdk(sdk: OpencodeClient) {
  const cached = sources.get(sdk);
  if (cached) return cached;
  const binding = new OpenCodeRuntimeBinding();
  binding.set({ generation: 'oc1', endpoint: 'http://fixture.local', epoch: 1, version: '1.18.32' });
  const bootstrap: SyncBootstrapOperations = {
    listSyncSessions: async (directory, input) => {
      const sessions: Session[] = [];
      const seen = new Set<string>();
      let cursor: number | undefined;
      for (;;) {
        const result = await retry(async () => {
          const response = await sdk.experimental.session.list({ directory, archived: input.archived,
            roots: input.roots, limit: input.pageSize, ...(cursor !== undefined ? { cursor } : {}) });
          return { items: data(response, 'experimental.session.list'), header: response.response?.headers?.get('x-next-cursor') };
        }, { attempts: 3, delay: 500, retryIf: () => true });
        if (result.items.length === 0) break;
        let added = 0;
        for (const item of result.items) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          sessions.push(projectLegacySession(item));
          added += 1;
        }
        if (result.items.length < input.pageSize || added === 0) break;
        const next = Number(result.header ?? result.items.at(-1)?.time.updated);
        if (!Number.isFinite(next) || (cursor !== undefined && next >= cursor)) break;
        cursor = next;
      }
      return sessions;
    },
    getBootstrapPath: async (directory) => data(await sdk.path.get(directory ? { directory } : undefined), 'path.get'),
    getCurrentProject: async (directory) => {
      const value = data(await sdk.project.current(directory ? { directory } : undefined), 'project.current');
      return { ...value, time: { created: 0, updated: 0 }, sandboxes: [] };
    },
    getVcs: async (directory) => {
      const value = data(await sdk.vcs.get(directory ? { directory } : undefined), 'vcs.get');
      return { branch: value.branch, defaultBranch: value.default_branch };
    },
    getLspStatus: async (directory) => data(await sdk.lsp.status(directory ? { directory } : undefined), 'lsp.status'),
    getTaggedConfig: async (directory) => ({ generation: 'oc1', value: data(directory
      ? await sdk.config.get({ directory }) : await sdk.global.config.get(), 'config.get') }),
    getProviderCatalog: async () => ({ generation: 'oc1', providers: [], default: {} }),
    listTaggedAgents: async () => ({ generation: 'oc1', value: [] }),
  };
  const source = createV1SyncSource(sdk, binding, bootstrap);
  sources.set(sdk, source);
  return source;
}
