import { runtimeFetch } from '@/lib/runtime-fetch';
import type { ProjectMode } from './projectResources';

type DirectoryMode = { directory: string; mode: ProjectMode };

export function createResourceReporter() {
  const client = crypto.randomUUID();
  const controller = new AbortController();
  let revision = 0;
  let supported = true;
  let lastFailure = 0;
  let pending = Promise.resolve();
  return {
    publish(directories: DirectoryMode[]) {
      const snapshot = { client, revision: ++revision, directories };
      pending = pending.then(async () => {
        if (!supported || controller.signal.aborted || snapshot.revision !== revision) return;
        const response = await runtimeFetch('/api/system/project-resources', {
          method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot),
        });
        if (response.status === 404) { supported = false; return; }
        if (response.status === 501) return;
        if (!response.ok) throw new Error('Resource state unavailable');
      }).catch(() => {
        if (!controller.signal.aborted && Date.now() - lastFailure > 60000) {
          console.warn('[mcp-idle]', JSON.stringify({ event: 'mode-report-failed' }));
          lastFailure = Date.now();
        }
      });
    },
    dispose() { controller.abort(); },
  };
}
