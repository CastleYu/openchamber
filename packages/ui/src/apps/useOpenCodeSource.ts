import { useSyncExternalStore } from 'react';
import { opencodeClient } from '@/lib/opencode/client';

const subscribe = (listener: () => void) => opencodeClient.subscribeRuntime(listener);
const snapshot = () => opencodeClient.getBoundRuntime() ? opencodeClient.getSyncSource() : undefined;

/** Mount the sync tree only after the owning runtime has selected its protocol. */
export function useOpenCodeSource() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
