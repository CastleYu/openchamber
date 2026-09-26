import type { OpenCodeManager } from './opencode';
import { waitForApiUrl } from './opencode-ready';

/** One forwarded request belongs to the connection selected before dispatch. */
export async function resolveKernelRequest(
  manager: Pick<OpenCodeManager, 'getStatus' | 'getApiUrl' | 'onStatusChange' | 'getKernelRuntime' | 'refreshKernelRuntime'>,
  requestPath: string,
) {
  const baseUrl = await waitForApiUrl(manager);
  if (!baseUrl) throw new Error('OpenCode API URL not available');
  let selected = manager.getKernelRuntime();
  if (selected.generation !== 'oc1' && selected.generation !== 'oc2') {
    selected = await manager.refreshKernelRuntime();
  }
  if (selected.generation !== 'oc1' && selected.generation !== 'oc2') {
    throw new Error('OpenCode kernel is not ready');
  }
  const relative = new URL(requestPath, 'https://openchamber.invalid');
  let pathname = relative.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  if (selected.generation === 'oc2') {
    if (pathname === '/global/event') pathname = '/event';
    pathname = `/api${pathname}`;
  }
  const target = new URL(baseUrl);
  const mount = target.pathname.replace(/\/$/, '');
  target.pathname = `${selected.generation === 'oc2' ? mount.replace(/\/api$/, '') : mount}${pathname}`;
  target.search = relative.search;
  const assertCurrent = () => {
    const current = manager.getKernelRuntime();
    if (current.generation !== selected.generation || current.endpoint !== selected.endpoint || current.epoch !== selected.epoch) {
      throw new Error('OpenCode connection changed during request');
    }
  };
  assertCurrent();
  return { url: target.toString(), descriptor: selected, assertCurrent };
}
