import type { OpenCodeManager } from './opencode';

type KernelManager = Pick<OpenCodeManager, 'getKernelRuntime' | 'refreshKernelRuntime'>;
type OpenAgentManagerTargets = {
  openOC1: () => void;
  openOC2: () => void;
  onNotReady: () => void;
};

export type OpenAgentManagerResult = 'oc1' | 'oc2' | 'not-ready';

/** Routes the stable command name only after the host has identified a kernel generation. */
export async function routeOpenAgentManager(
  manager: KernelManager | undefined,
  targets: OpenAgentManagerTargets,
): Promise<OpenAgentManagerResult> {
  let generation = manager?.getKernelRuntime().generation ?? 'unknown';
  if (generation === 'unknown' && manager) {
    try {
      generation = (await manager.refreshKernelRuntime()).generation;
    } catch {
      generation = manager.getKernelRuntime().generation;
    }
  }

  if (generation === 'oc1') {
    targets.openOC1();
    return 'oc1';
  }
  if (generation === 'oc2') {
    targets.openOC2();
    return 'oc2';
  }
  targets.onNotReady();
  return 'not-ready';
}
