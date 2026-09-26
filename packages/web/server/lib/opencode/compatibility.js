import { z } from 'zod';

export const OPENCODE_GENERATION = Object.freeze({
  OC1: 'oc1',
  OC2: 'oc2',
  UNSUPPORTED: 'unsupported',
  UNREACHABLE: 'unreachable',
  UNKNOWN: 'unknown',
});

export const MINIMUM_OPENCODE_V2_VERSION = '2.0.15';

const PROBE_PATH = Object.freeze({
  HEALTH: '/global/health',
  INFO: '/api/info',
});

const AUTH_STATUS = new Set([401, 403]);
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const versionSchema = z.string().regex(VERSION_RE);
const infoSchema = z.object({ version: versionSchema });
const healthSchema = z.object({ version: versionSchema, healthy: z.literal(true) });

const parseVersion = (version) => {
  if (!versionSchema.safeParse(version).success) return null;
  const match = VERSION_RE.exec(version);
  return {
    value: version.startsWith('v') ? version.slice(1) : version,
    major: Number(match[1]),
    parts: match.slice(1, 4).map(Number),
    prerelease: match[4],
  };
};

export const isSupportedOpenCodeVersion = (version) => {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  if (parsed.major === 1) return true;
  if (parsed.major !== 2) return false;
  const minimum = parseVersion(MINIMUM_OPENCODE_V2_VERSION);
  for (let index = 0; index < parsed.parts.length; index += 1) {
    if (parsed.parts[index] !== minimum.parts[index]) {
      return parsed.parts[index] > minimum.parts[index];
    }
  }
  return !parsed.prerelease;
};

export const readOpenCodeInfo = async (response) => {
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const parsed = infoSchema.safeParse(body);
  return parsed.success ? { version: parseVersion(parsed.data.version).value } : null;
};

const readHealth = async (response) => {
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const parsed = healthSchema.safeParse(body);
  return parsed.success ? { version: parseVersion(parsed.data.version).value } : null;
};

const normalizeEndpoint = (endpoint) => {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('OpenCode endpoint must use HTTP or HTTPS');
  if (url.username || url.password) throw new TypeError('OpenCode endpoint credentials belong in headers');
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
  return `${url.origin}${path}`;
};

const probe = async (endpoint, path, headers, fetchImpl, signal) => {
  try {
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Accept', 'application/json');
    const response = await fetchImpl(`${endpoint}${path}`, {
      method: 'GET',
      headers: requestHeaders,
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
    if (AUTH_STATUS.has(response.status)) return { kind: 'auth' };
    return {
      kind: 'response',
      version: path === PROBE_PATH.HEALTH ? await readHealth(response) : await readOpenCodeInfo(response),
    };
  } catch {
    return { kind: 'error' };
  }
};

export const detectOpenCodeGeneration = async ({ endpoint, epoch, headers = {}, fetchImpl = fetch, signal } = {}) => {
  let normalized;
  try {
    normalized = normalizeEndpoint(endpoint);
  } catch {
    return { generation: OPENCODE_GENERATION.UNKNOWN, endpoint: null, epoch, version: null };
  }

  const [health, info] = await Promise.all([
    probe(normalized, PROBE_PATH.HEALTH, headers, fetchImpl, signal),
    probe(normalized, PROBE_PATH.INFO, headers, fetchImpl, signal),
  ]);
  const result = (generation, version = null) => ({ generation, endpoint: normalized, epoch, version });

  if (health.kind === 'auth' || info.kind === 'auth') return result(OPENCODE_GENERATION.UNKNOWN);
  if (health.kind === 'error' && info.kind === 'error') return result(OPENCODE_GENERATION.UNREACHABLE);

  const legacyVersion = health.version?.version ?? null;
  const infoVersion = info.version?.version ?? null;
  if (legacyVersion && infoVersion && legacyVersion !== infoVersion) {
    return result(OPENCODE_GENERATION.UNKNOWN);
  }
  const version = infoVersion ?? legacyVersion;
  if (!version) return result(OPENCODE_GENERATION.UNKNOWN);

  const major = parseVersion(version).major;
  if (major === 1 && legacyVersion) return result(OPENCODE_GENERATION.OC1, version);
  if (major === 2 && infoVersion) {
    return result(isSupportedOpenCodeVersion(version) ? OPENCODE_GENERATION.OC2 : OPENCODE_GENERATION.UNSUPPORTED, version);
  }
  if (major !== 1 && major !== 2) {
    return result(OPENCODE_GENERATION.UNSUPPORTED, version);
  }
  return result(OPENCODE_GENERATION.UNKNOWN);
};
