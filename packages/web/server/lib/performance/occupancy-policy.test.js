import { describe, expect, it } from 'vitest';
import { DEFAULT_OCCUPANCY_POLICY, parseOccupancyPolicy } from './occupancy-policy.js';

describe('occupancy-policy', () => {
  it('matches the UI defaults that live paths read', () => {
    expect(parseOccupancyPolicy(undefined)).toEqual(DEFAULT_OCCUPANCY_POLICY);
    expect(DEFAULT_OCCUPANCY_POLICY.hiddenSurfaceWorkEnabled).toBe(false);
    expect(DEFAULT_OCCUPANCY_POLICY.untrackedDiffConcurrency).toBe(4);
    expect(DEFAULT_OCCUPANCY_POLICY.untrackedDiffMaxFiles).toBe(50);
  });

  it('applies saved slider values that getUntrackedDiffs reads', () => {
    const policy = parseOccupancyPolicy({
      untrackedDiffConcurrency: 3,
      untrackedDiffMaxFiles: 12,
      walkthroughUntrackedDiffsEnabled: false,
    });
    expect(policy.untrackedDiffConcurrency).toBe(3);
    expect(policy.untrackedDiffMaxFiles).toBe(12);
    expect(policy.walkthroughUntrackedDiffsEnabled).toBe(false);
  });
});
