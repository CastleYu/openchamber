import { create } from 'zustand';
import {
  bindOccupancyPolicyReader,
  DEFAULT_OCCUPANCY_POLICY,
  parseOccupancyPolicy,
  type OccupancyPolicy,
} from '@/lib/performance/occupancyPolicy';

type OccupancyPolicyStore = {
  policy: OccupancyPolicy;
  setPolicy: (policy: OccupancyPolicy) => void;
  replace: (partial: Partial<OccupancyPolicy>) => OccupancyPolicy;
};

export const useOccupancyPolicyStore = create<OccupancyPolicyStore>((set, get) => ({
  policy: DEFAULT_OCCUPANCY_POLICY,
  setPolicy: (policy) => {
    set({ policy: parseOccupancyPolicy(policy) });
  },
  replace: (partial) => {
    const next = parseOccupancyPolicy({ ...get().policy, ...partial });
    set({ policy: next });
    return next;
  },
}));

bindOccupancyPolicyReader(() => useOccupancyPolicyStore.getState().policy);

export const applyOccupancyPolicyFromSettings = (policy: OccupancyPolicy): void => {
  useOccupancyPolicyStore.getState().setPolicy(policy);
};
