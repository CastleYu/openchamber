import { normalizePath } from '@/lib/pathNormalization';
import { ProjectMode, projectResources } from './projectResources';

export const OCCUPANCY_SCENARIOS = [
  'gitDiffPrefetch',
  'walkthroughUntrackedDiffs',
  'hiddenSurfaceWork',
  'browserTabKeepAlive',
  'idlePolling',
] as const;

export type OccupancyScenario = (typeof OCCUPANCY_SCENARIOS)[number];

export type GitStatusFetchSource = 'auto' | 'manual';

export type OccupancyPolicy = {
  gitDiffPrefetchEnabled: boolean;
  walkthroughUntrackedDiffsEnabled: boolean;
  hiddenSurfaceWorkEnabled: boolean;
  browserTabKeepAliveEnabled: boolean;
  idlePollingEnabled: boolean;
  gitDiffConcurrency: number;
  untrackedDiffConcurrency: number;
  untrackedDiffMaxFiles: number;
  untrackedDiffMaxFileBytes: number;
  gitAutoMonitorDisabledDirectories: string[];
};

export const DEFAULT_OCCUPANCY_POLICY: OccupancyPolicy = {
  gitDiffPrefetchEnabled: true,
  walkthroughUntrackedDiffsEnabled: true,
  hiddenSurfaceWorkEnabled: false,
  browserTabKeepAliveEnabled: true,
  idlePollingEnabled: true,
  gitDiffConcurrency: 2,
  untrackedDiffConcurrency: 4,
  untrackedDiffMaxFiles: 50,
  untrackedDiffMaxFileBytes: 1024 * 1024,
  gitAutoMonitorDisabledDirectories: [],
};

const GIT_DIFF_CONCURRENCY_MIN = 1;
const GIT_DIFF_CONCURRENCY_MAX = 8;
const UNTRACKED_DIFF_CONCURRENCY_MIN = 1;
const UNTRACKED_DIFF_CONCURRENCY_MAX = 8;
const UNTRACKED_DIFF_MAX_FILES_MIN = 1;
const UNTRACKED_DIFF_MAX_FILES_MAX = 200;
const UNTRACKED_DIFF_MAX_FILE_BYTES_MIN = 64 * 1024;
const UNTRACKED_DIFF_MAX_FILE_BYTES_MAX = 8 * 1024 * 1024;

export const OCCUPANCY_SLIDER_BOUNDS = {
  gitDiffConcurrency: { min: GIT_DIFF_CONCURRENCY_MIN, max: GIT_DIFF_CONCURRENCY_MAX, step: 1 },
  untrackedDiffConcurrency: { min: UNTRACKED_DIFF_CONCURRENCY_MIN, max: UNTRACKED_DIFF_CONCURRENCY_MAX, step: 1 },
  untrackedDiffMaxFiles: { min: UNTRACKED_DIFF_MAX_FILES_MIN, max: UNTRACKED_DIFF_MAX_FILES_MAX, step: 1 },
} as const;

const clampInt = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

export const occupancyDirectoryKey = (directory: string | null | undefined): string | null =>
  normalizePath(directory);

type OccupancyPolicyFields = {
  gitDiffPrefetchEnabled?: boolean;
  walkthroughUntrackedDiffsEnabled?: boolean;
  hiddenSurfaceWorkEnabled?: boolean;
  browserTabKeepAliveEnabled?: boolean;
  idlePollingEnabled?: boolean;
  gitDiffConcurrency?: number;
  untrackedDiffConcurrency?: number;
  untrackedDiffMaxFiles?: number;
  untrackedDiffMaxFileBytes?: number;
  gitAutoMonitorDisabledDirectories?: readonly string[];
};

const uniqueDirectoryKeys = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = occupancyDirectoryKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
};

const booleanField = (value: boolean | undefined, fallback: boolean): boolean => {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
};

const numberField = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return clampInt(value, min, max);
};

export const parseOccupancyPolicy = (raw: OccupancyPolicyFields | null | undefined): OccupancyPolicy => {
  const candidate = raw ?? {};
  return {
    gitDiffPrefetchEnabled: booleanField(candidate.gitDiffPrefetchEnabled, DEFAULT_OCCUPANCY_POLICY.gitDiffPrefetchEnabled),
    walkthroughUntrackedDiffsEnabled: booleanField(candidate.walkthroughUntrackedDiffsEnabled, DEFAULT_OCCUPANCY_POLICY.walkthroughUntrackedDiffsEnabled),
    hiddenSurfaceWorkEnabled: booleanField(candidate.hiddenSurfaceWorkEnabled, DEFAULT_OCCUPANCY_POLICY.hiddenSurfaceWorkEnabled),
    browserTabKeepAliveEnabled: booleanField(candidate.browserTabKeepAliveEnabled, DEFAULT_OCCUPANCY_POLICY.browserTabKeepAliveEnabled),
    idlePollingEnabled: booleanField(candidate.idlePollingEnabled, DEFAULT_OCCUPANCY_POLICY.idlePollingEnabled),
    gitDiffConcurrency: numberField(candidate.gitDiffConcurrency, DEFAULT_OCCUPANCY_POLICY.gitDiffConcurrency, GIT_DIFF_CONCURRENCY_MIN, GIT_DIFF_CONCURRENCY_MAX),
    untrackedDiffConcurrency: numberField(candidate.untrackedDiffConcurrency, DEFAULT_OCCUPANCY_POLICY.untrackedDiffConcurrency, UNTRACKED_DIFF_CONCURRENCY_MIN, UNTRACKED_DIFF_CONCURRENCY_MAX),
    untrackedDiffMaxFiles: numberField(candidate.untrackedDiffMaxFiles, DEFAULT_OCCUPANCY_POLICY.untrackedDiffMaxFiles, UNTRACKED_DIFF_MAX_FILES_MIN, UNTRACKED_DIFF_MAX_FILES_MAX),
    untrackedDiffMaxFileBytes: numberField(candidate.untrackedDiffMaxFileBytes, DEFAULT_OCCUPANCY_POLICY.untrackedDiffMaxFileBytes, UNTRACKED_DIFF_MAX_FILE_BYTES_MIN, UNTRACKED_DIFF_MAX_FILE_BYTES_MAX),
    gitAutoMonitorDisabledDirectories: Array.isArray(candidate.gitAutoMonitorDisabledDirectories)
      ? uniqueDirectoryKeys(candidate.gitAutoMonitorDisabledDirectories)
      : [],
  };
};

export const isOccupancyScenario = (value: string): value is OccupancyScenario => {
  for (const scenario of OCCUPANCY_SCENARIOS) {
    if (scenario === value) return true;
  }
  return false;
};

let occupancyPolicyReader: () => OccupancyPolicy = () => DEFAULT_OCCUPANCY_POLICY;

export const bindOccupancyPolicyReader = (reader: () => OccupancyPolicy): void => {
  occupancyPolicyReader = reader;
};

export const getOccupancyPolicy = (): OccupancyPolicy => occupancyPolicyReader();

export const isGitAutoMonitorEnabled = (
  directory: string | null | undefined,
  policy: OccupancyPolicy = getOccupancyPolicy(),
): boolean => {
  const key = occupancyDirectoryKey(directory);
  if (!key) return true;
  return !policy.gitAutoMonitorDisabledDirectories.includes(key);
};

export const withGitAutoMonitorDirectory = (
  policy: OccupancyPolicy,
  directory: string,
  enabled: boolean,
): OccupancyPolicy => {
  const key = occupancyDirectoryKey(directory);
  if (!key) return policy;
  const disabled = new Set(policy.gitAutoMonitorDisabledDirectories);
  if (enabled) disabled.delete(key);
  else disabled.add(key);
  return {
    ...policy,
    gitAutoMonitorDisabledDirectories: [...disabled],
  };
};

export const shouldAutoFetchGitStatus = (
  directory: string,
  source: GitStatusFetchSource = 'auto',
  policy: OccupancyPolicy = getOccupancyPolicy(),
): boolean => source === 'manual' || (projectResources.mode(directory) !== ProjectMode.Idle && isGitAutoMonitorEnabled(directory, policy));

export const shouldPrefetchGitDiffs = (
  directory: string,
  policy: OccupancyPolicy = getOccupancyPolicy(),
): boolean => projectResources.mode(directory) !== ProjectMode.Idle && policy.gitDiffPrefetchEnabled && isGitAutoMonitorEnabled(directory, policy);

export const shouldSkipPrefetchWithoutDiffStats = (
  insertionsPlusDeletions: number | undefined,
  largeFileThreshold: number,
): boolean => {
  if (insertionsPlusDeletions === undefined) return true;
  return insertionsPlusDeletions > largeFileThreshold;
};

export const shouldStartWalkthroughBackgroundWork = (
  visible: boolean,
  policy: OccupancyPolicy = getOccupancyPolicy(),
): boolean => visible || policy.hiddenSurfaceWorkEnabled;

export const shouldKeepAliveBrowserTabs = (
  policy: OccupancyPolicy = getOccupancyPolicy(),
): boolean => policy.browserTabKeepAliveEnabled;

export const shouldIdlePoll = (
  policy: OccupancyPolicy = getOccupancyPolicy(),
): boolean => policy.idlePollingEnabled;

export const gitDiffConcurrencyFor = (
  policy: OccupancyPolicy = getOccupancyPolicy(),
  directory = '',
): number => projectResources.mode(directory) === ProjectMode.Focused ? Number.POSITIVE_INFINITY : policy.gitDiffConcurrency;

export const scenarioEnabled = (
  scenario: OccupancyScenario,
  policy: OccupancyPolicy,
): boolean => {
  switch (scenario) {
    case 'gitDiffPrefetch':
      return policy.gitDiffPrefetchEnabled;
    case 'walkthroughUntrackedDiffs':
      return policy.walkthroughUntrackedDiffsEnabled;
    case 'hiddenSurfaceWork':
      return policy.hiddenSurfaceWorkEnabled;
    case 'browserTabKeepAlive':
      return policy.browserTabKeepAliveEnabled;
    case 'idlePolling':
      return policy.idlePollingEnabled;
  }
};

export const withScenarioEnabled = (
  policy: OccupancyPolicy,
  scenario: OccupancyScenario,
  enabled: boolean,
): OccupancyPolicy => {
  switch (scenario) {
    case 'gitDiffPrefetch':
      return { ...policy, gitDiffPrefetchEnabled: enabled };
    case 'walkthroughUntrackedDiffs':
      return { ...policy, walkthroughUntrackedDiffsEnabled: enabled };
    case 'hiddenSurfaceWork':
      return { ...policy, hiddenSurfaceWorkEnabled: enabled };
    case 'browserTabKeepAlive':
      return { ...policy, browserTabKeepAliveEnabled: enabled };
    case 'idlePolling':
      return { ...policy, idlePollingEnabled: enabled };
  }
};
