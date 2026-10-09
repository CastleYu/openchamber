import { z } from 'zod';

export const OPENCODE_GENERATION = Object.freeze({
  OC1: 'oc1',
  OC2: 'oc2',
  UNSUPPORTED: 'unsupported',
  UNREACHABLE: 'unreachable',
  UNKNOWN: 'unknown',
});

export const MINIMUM_OPENCODE_V2_VERSION = '2.0.15';
const CREDENTIAL_API_VERSION = '2.0.20';
const LEGACY_HEALTH_ONLY_VERSION = '1.2.27';

const PROBE_PATH = Object.freeze({
  HEALTH: '/global/health',
  INFO: '/api/info',
});


export const OPENCODE_PROFILE = Object.freeze({ OC1: 'oc1', OC2: 'oc2', LEGACY: 'legacy-1.2.27' });
export const OPENCODE_SELECTION = Object.freeze({ AUTO: 'auto', ...OPENCODE_PROFILE });
export const OPENCODE_SETTING = Object.freeze({ SELECTION: 'opencodeSelection' });
export const PROFILE_STATUS = Object.freeze({
  READY: 'ready', AUTH: 'auth', UNREACHABLE: 'unreachable', CONFLICT: 'conflict',
  MISMATCH: 'mismatch', UNSUPPORTED: 'unsupported', UNVERIFIED: 'unverified',
  INVALID_ENDPOINT: 'invalid-endpoint', INVALID_SELECTION: 'invalid-selection',
});
const VERSION_PROVENANCE = Object.freeze({ SERVER: 'server', USER: 'user-declared' });
const selectionSchema = z.enum(Object.values(OPENCODE_SELECTION));
export const isOpenCodeSelection = value => selectionSchema.safeParse(value).success;
const idSchema = z.object({ id: z.string().min(1) });
const LEGACY_READ_CHECKS = Object.freeze([
  { path: '/session', schema: z.array(idSchema) },
  { path: '/session/status', schema: z.record(z.string(), z.discriminatedUnion('type', [
    z.object({ type: z.literal('idle') }), z.object({ type: z.literal('busy') }),
    z.object({ type: z.literal('retry'), attempt: z.number(), message: z.string(), next: z.number() }),
  ])) },
  { path: '/permission', schema: z.array(idSchema.extend({ sessionID: z.string().min(1), permission: z.string(), patterns: z.array(z.string()) })) },
  { path: '/question', schema: z.array(idSchema.extend({ sessionID: z.string().min(1), questions: z.array(z.object({ question: z.string(), header: z.string(), options: z.array(z.object({ label: z.string(), description: z.string() })) })) })) },
  { path: '/command', schema: z.array(z.object({ name: z.string().min(1) })) },
]);

const AUTH_STATUS = new Set([401, 403]);
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const versionSchema = z.string().regex(VERSION_RE);
const infoSchema = z.object({ version: versionSchema });
const healthSchema = z.object({ version: versionSchema.optional(), healthy: z.literal(true) });

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

/** OpenCode 2.0.20 first exposes stored credentials through its own API. */
export const supportsCredentialApi = (version) => {
  const parsed = parseVersion(version);
  if (!parsed || parsed.major !== 2) return false;
  const minimum = parseVersion(CREDENTIAL_API_VERSION);
  for (let index = 0; index < parsed.parts.length; index += 1) {
    if (parsed.parts[index] !== minimum.parts[index]) return parsed.parts[index] > minimum.parts[index];
  }
  return !parsed.prerelease;
};

export const readOpenCodeInfo = async (response) => {
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const parsed = infoSchema.safeParse(body);
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
    const body = response.ok ? await response.json().catch(() => null) : null;
    const parsed = (path === PROBE_PATH.HEALTH ? healthSchema : infoSchema).safeParse(body);
    return {
      kind: 'response',
      healthy: path === PROBE_PATH.HEALTH && parsed.success,
      version: parsed.success && parsed.data.version ? { version: parseVersion(parsed.data.version).value } : null,
    };
  } catch {
    return { kind: 'error' };
  }
};

const detectIdentity = async ({ endpoint, epoch, headers = {}, headersForGeneration, fetchImpl = fetch, signal } = {}, healthOnly = false) => {
  let normalized;
  try {
    normalized = normalizeEndpoint(endpoint);
  } catch {
    return { descriptor: { generation: OPENCODE_GENERATION.UNKNOWN, endpoint: null, epoch, version: null }, reason: PROFILE_STATUS.INVALID_ENDPOINT, healthy: false };
  }

  let health;
  const result = (generation, version = null, reason = PROFILE_STATUS.UNVERIFIED) => ({ descriptor: { generation, endpoint: normalized, epoch, version }, reason, healthy: health?.healthy === true });
  health = await probe(normalized, PROBE_PATH.HEALTH, headersForGeneration?.(OPENCODE_GENERATION.OC1) ?? headers, fetchImpl, signal);
  // 1.2.27 forwards unknown paths and their headers to its hosted web app.
  // Its authenticated health identity is sufficient; /api/info is not its API.
  const healthVersion = health.version?.version;
  if (healthVersion?.split('+')[0] === LEGACY_HEALTH_ONLY_VERSION) {
    return result(OPENCODE_GENERATION.OC1, healthVersion);
  }
  if (healthOnly) {
    if (health.kind === 'auth') return result(OPENCODE_GENERATION.UNKNOWN, null, PROFILE_STATUS.AUTH);
    if (health.kind === 'error') return result(OPENCODE_GENERATION.UNREACHABLE, null, PROFILE_STATUS.UNREACHABLE);
    if (!healthVersion) return result(OPENCODE_GENERATION.UNKNOWN);
    const generation = parseVersion(healthVersion).major === 1 ? OPENCODE_GENERATION.OC1 : OPENCODE_GENERATION.UNSUPPORTED;
    return result(generation, healthVersion);
  }
  const info = await probe(normalized, PROBE_PATH.INFO, headersForGeneration?.(OPENCODE_GENERATION.OC2) ?? headers, fetchImpl, signal);

  if ((health.kind === 'auth' || info.kind === 'auth') && !headersForGeneration) return result(OPENCODE_GENERATION.UNKNOWN, null, PROFILE_STATUS.AUTH);
  if (health.kind === 'error' && info.kind === 'error') return result(OPENCODE_GENERATION.UNREACHABLE, null, PROFILE_STATUS.UNREACHABLE);

  const legacyVersion = health.version?.version ?? null;
  const infoVersion = info.version?.version ?? null;
  if (legacyVersion && infoVersion && legacyVersion !== infoVersion) {
    return result(OPENCODE_GENERATION.UNKNOWN, null, PROFILE_STATUS.CONFLICT);
  }
  const version = infoVersion ?? legacyVersion;
  if (!version) return result(OPENCODE_GENERATION.UNKNOWN, null, health.kind === 'auth' || info.kind === 'auth' ? PROFILE_STATUS.AUTH : PROFILE_STATUS.UNVERIFIED);

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

export const detectOpenCodeGeneration = async (options) => (await detectIdentity(options)).descriptor;

/** Profile admission is separate from operation acceptance and host activation. */
export const detectOpenCodeProfile = async (options) => {
  const selected = selectionSchema.safeParse(options.selection);
  if (!selected.success) return { status: PROFILE_STATUS.INVALID_SELECTION };
  const selection = selected.data;
  const identity = await detectIdentity(options, selection === OPENCODE_SELECTION.LEGACY);
  const descriptor = identity.descriptor;
  const reject = (status) => ({ status, selection, descriptor });
  if (identity.reason === PROFILE_STATUS.AUTH || identity.reason === PROFILE_STATUS.UNREACHABLE
    || identity.reason === PROFILE_STATUS.CONFLICT || identity.reason === PROFILE_STATUS.INVALID_ENDPOINT) return reject(identity.reason);
  const exact = descriptor.version?.split('+')[0] === LEGACY_HEALTH_ONLY_VERSION;
  const declared = selection === OPENCODE_SELECTION.LEGACY && !descriptor.version && identity.healthy;
  if (selection === OPENCODE_SELECTION.LEGACY && !exact && !declared) return reject(descriptor.version ? PROFILE_STATUS.MISMATCH : PROFILE_STATUS.UNVERIFIED);
  if (!declared && descriptor.generation !== OPENCODE_GENERATION.OC1 && descriptor.generation !== OPENCODE_GENERATION.OC2) {
    return reject(descriptor.generation === OPENCODE_GENERATION.UNSUPPORTED ? PROFILE_STATUS.UNSUPPORTED : PROFILE_STATUS.UNVERIFIED);
  }
  if (selection === OPENCODE_SELECTION.OC1 && descriptor.generation !== OPENCODE_GENERATION.OC1
    || selection === OPENCODE_SELECTION.OC2 && descriptor.generation !== OPENCODE_GENERATION.OC2) return reject(PROFILE_STATUS.MISMATCH);
  const profile = exact || declared ? OPENCODE_PROFILE.LEGACY : descriptor.generation;
  if (profile === OPENCODE_PROFILE.LEGACY) {
    const headers = new Headers(options.headersForGeneration?.(OPENCODE_GENERATION.OC1) ?? options.headers);
    headers.set('Accept', 'application/json');
    for (const check of LEGACY_READ_CHECKS) {
      try {
        const response = await (options.fetchImpl ?? fetch)(descriptor.endpoint + check.path, {
          method: 'GET', headers, redirect: 'error',
          signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
        });
        if (AUTH_STATUS.has(response.status)) return reject(PROFILE_STATUS.AUTH);
        if (!response.ok || !check.schema.safeParse(await response.json()).success) return reject(PROFILE_STATUS.UNVERIFIED);
      } catch {
        return reject(PROFILE_STATUS.UNVERIFIED);
      }
    }
  }
  return {
    status: PROFILE_STATUS.READY, selection,
    descriptor: { ...descriptor, generation: declared ? OPENCODE_GENERATION.OC1 : descriptor.generation, profile },
    provenance: declared ? VERSION_PROVENANCE.USER : VERSION_PROVENANCE.SERVER,
    exactVersion: exact,
  };
};
