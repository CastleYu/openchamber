import { z } from 'zod';
import { create } from 'zustand';

import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { subscribeToConfigChanges } from '@/lib/configSync';

export type SmallModelAvailability = 'unknown' | 'available' | 'unavailable';

const MAX_AGE_MS = 60_000;
const responseSchema = z.object({ available: z.boolean() });
const inFlight = new Map<string, Promise<void>>();
let requestGeneration = 0;

const toKey = (runtimeKey: string, directory: string | null | undefined): string =>
  `${runtimeKey}::${directory?.trim() || '__global__'}`;

interface SmallModelStore {
  byKey: Record<string, { availability: SmallModelAvailability; fetchedAt: number }>;
  ensureFresh: (directory?: string | null) => Promise<void>;
  invalidate: () => void;
}

export const useSmallModelStore = create<SmallModelStore>()((set, get) => ({
  byKey: {},

  ensureFresh: async (directory) => {
    const runtimeKey = getRuntimeKey();
    const key = toKey(runtimeKey, directory);
    const entry = get().byKey[key];
    if (entry && Date.now() - entry.fetchedAt < MAX_AGE_MS) return;
    const pending = inFlight.get(key);
    if (pending) return pending;

    const generation = requestGeneration;
    let request = Promise.resolve();
    request = (async () => {
      try {
        const trimmed = directory?.trim() ?? '';
        const query = trimmed ? `?directory=${encodeURIComponent(trimmed)}` : '';
        const response = await runtimeFetch(`/api/small-model${query}`);
        if (!response.ok) return;
        const payload = responseSchema.safeParse(await response.json().catch(() => null));
        if (!payload.success) return;
        if (generation !== requestGeneration || getRuntimeKey() !== runtimeKey) return;
        set((state) => ({
          byKey: {
            ...state.byKey,
            [key]: { availability: payload.data.available ? 'available' : 'unavailable', fetchedAt: Date.now() },
          },
        }));
      } catch {
        // A transport failure is not evidence that the model became unavailable.
      } finally {
        if (inFlight.get(key) === request) inFlight.delete(key);
      }
    })();
    inFlight.set(key, request);
    return request;
  },

  invalidate: () => {
    requestGeneration += 1;
    inFlight.clear();
    set({ byKey: {} });
  },
}));

export const selectSmallModelAvailability = (
  state: SmallModelStore,
  directory: string | null | undefined,
): SmallModelAvailability => state.byKey[toKey(getRuntimeKey(), directory)]?.availability ?? 'unknown';

subscribeToConfigChanges(() => useSmallModelStore.getState().invalidate());
subscribeRuntimeEndpointChanged(() => useSmallModelStore.getState().invalidate());
