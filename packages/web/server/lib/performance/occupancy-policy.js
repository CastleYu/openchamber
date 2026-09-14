import fs from 'fs';
import os from 'os';
import path from 'path';

export const DEFAULT_OCCUPANCY_POLICY = {
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

const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));

const occupancyDirectoryKey = (value) => {
  try {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const replaced = trimmed.replace(/\\/g, '/').replace(/^([a-z]):/, (_, letter) => `${letter.toUpperCase()}:`);
    if (replaced === '/') return '/';
    const stripped = replaced.length > 1 ? replaced.replace(/\/+$/, '') : replaced;
    return stripped || null;
  } catch {
    return null;
  }
};

const uniqueDirectoryKeys = (values) => {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = occupancyDirectoryKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
};

const booleanField = (value, fallback) => {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
};

const numberField = (value, fallback, min, max) => (
  Number.isFinite(value) ? clampInt(value, min, max) : fallback
);

const occupancyFields = (raw) => {
  try {
    if (!raw || Array.isArray(raw)) return {};
    return raw;
  } catch {
    return {};
  }
};

export const parseOccupancyPolicy = (raw) => {
  const candidate = occupancyFields(raw);
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
    gitAutoMonitorDisabledDirectories: uniqueDirectoryKeys(candidate.gitAutoMonitorDisabledDirectories),
  };
};

const SETTINGS_FILE = path.join(
  process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : path.join(os.homedir(), '.config', 'openchamber'),
  'settings.json',
);

export const readOccupancyPolicy = () => {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return parseOccupancyPolicy(settings?.occupancy);
  } catch {
    return { ...DEFAULT_OCCUPANCY_POLICY };
  }
};
