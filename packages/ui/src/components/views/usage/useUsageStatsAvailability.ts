import { useSyncExternalStore } from 'react';
import { opencodeClient } from '@/lib/opencode/client';

const subscribe = (listener: () => void) => opencodeClient.subscribeRuntime(listener);
const snapshot = () => opencodeClient.getBoundRuntime();

/** Historical session stats are an OC2 API. */
export function useUsageStatsAvailable(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot)?.generation === 'oc2';
}
