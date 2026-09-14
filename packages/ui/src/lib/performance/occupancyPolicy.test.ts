import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_OCCUPANCY_POLICY,
  gitDiffConcurrencyFor,
  isGitAutoMonitorEnabled,
  parseOccupancyPolicy,
  shouldAutoFetchGitStatus,
  shouldIdlePoll,
  shouldKeepAliveBrowserTabs,
  shouldPrefetchGitDiffs,
  shouldSkipPrefetchWithoutDiffStats,
  shouldStartWalkthroughBackgroundWork,
  withGitAutoMonitorDirectory,
  withScenarioEnabled,
} from './occupancyPolicy';

describe('occupancyPolicy', () => {
  test('defaults keep auto git monitoring on and hidden walkthrough work off', () => {
    const policy = parseOccupancyPolicy(undefined);
    expect(policy).toEqual(DEFAULT_OCCUPANCY_POLICY);
    expect(isGitAutoMonitorEnabled('/repo', policy)).toBe(true);
    expect(shouldStartWalkthroughBackgroundWork(false, policy)).toBe(false);
    expect(shouldStartWalkthroughBackgroundWork(true, policy)).toBe(true);
  });

  test('enabling hidden-surface work is the bound walkthrough load reads', () => {
    const policy = parseOccupancyPolicy({ hiddenSurfaceWorkEnabled: true });
    expect(shouldStartWalkthroughBackgroundWork(false, policy)).toBe(true);
    expect(policy.hiddenSurfaceWorkEnabled).toBe(true);
  });

  test('git auto-monitor off blocks auto status and prefetch for that directory only', () => {
    const policy = withGitAutoMonitorDirectory(DEFAULT_OCCUPANCY_POLICY, '/repo', false);
    expect(shouldAutoFetchGitStatus('/repo', 'auto', policy)).toBe(false);
    expect(shouldAutoFetchGitStatus('/repo', 'manual', policy)).toBe(true);
    expect(shouldPrefetchGitDiffs('/repo', policy)).toBe(false);
    expect(shouldPrefetchGitDiffs('/other', policy)).toBe(true);
  });

  test('disabling git diff prefetch is the bound prefetchDiffs reads', () => {
    const policy = withScenarioEnabled(DEFAULT_OCCUPANCY_POLICY, 'gitDiffPrefetch', false);
    expect(shouldPrefetchGitDiffs('/repo', policy)).toBe(false);
    expect(gitDiffConcurrencyFor(policy)).toBe(DEFAULT_OCCUPANCY_POLICY.gitDiffConcurrency);
  });

  test('concurrency sliders clamp to the production helper range', () => {
    const policy = parseOccupancyPolicy({
      gitDiffConcurrency: 99,
      untrackedDiffConcurrency: 0,
      untrackedDiffMaxFiles: 5000,
    });
    expect(policy.gitDiffConcurrency).toBe(8);
    expect(policy.untrackedDiffConcurrency).toBe(1);
    expect(policy.untrackedDiffMaxFiles).toBe(200);
  });

  test('prefetch skips files that have no diff stats', () => {
    expect(shouldSkipPrefetchWithoutDiffStats(undefined, 500)).toBe(true);
    expect(shouldSkipPrefetchWithoutDiffStats(12, 500)).toBe(false);
    expect(shouldSkipPrefetchWithoutDiffStats(800, 500)).toBe(true);
  });

  test('browser keep-alive and idle polling honor the saved flags', () => {
    expect(shouldKeepAliveBrowserTabs(DEFAULT_OCCUPANCY_POLICY)).toBe(true);
    expect(shouldIdlePoll(DEFAULT_OCCUPANCY_POLICY)).toBe(true);
    expect(shouldKeepAliveBrowserTabs(withScenarioEnabled(DEFAULT_OCCUPANCY_POLICY, 'browserTabKeepAlive', false))).toBe(false);
    expect(shouldIdlePoll(withScenarioEnabled(DEFAULT_OCCUPANCY_POLICY, 'idlePolling', false))).toBe(false);
  });
});
