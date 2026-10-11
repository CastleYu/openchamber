// Provider state that exists only inside the running OpenCode process.
//
// A plugin registers its provider from the `config` hook and supplies the
// credential from its `auth` loader, both at startup. Neither ends up in
// `opencode.json` or `auth.json`, so a server that only reads files sees
// nothing — which is why plugin-backed models used to fail here with
// "has no known API base URL" while working fine in chat (#2666).
//
// `GET /provider` is where that state becomes visible. It reports, per
// provider, the resolved `options.baseURL` and `options.apiKey`, and per model
// the wire adapter (`api.npm`) and endpoint (`api.url`). The provider-level
// endpoint remains only as a fallback when the selected model has no endpoint.
//
// What it does NOT report is `options.fetch`. OpenCode strips functions from
// the response, and a plugin is free to put its whole protocol in there:
// rewriting the path, signing the request, translating the payload. Such a
// provider advertises a perfectly ordinary base URL that answers nothing we
// know how to ask, and no field distinguishes the two.
//
// Asking the endpoint (`GET /models`) looked like the way to tell them apart,
// and it does answer correctly for that case — but measured against the 166
// providers in the models.dev catalog it also denies six that work fine and
// simply have no `/models` route. A provider that vanishes from the picker
// explains nothing; one that fails on use says why. So this module reports
// what it knows and leaves the verdict to the call itself.

import { z } from 'zod';
import { OPENCODE_GENERATION, OPENCODE_PROFILE } from '../opencode/compatibility.js';

const SNAPSHOT_TTL_MS = 30_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;

// opencode zen hands out this sentinel instead of a key when the user has no
// zen login, and trims its catalog to the free models. Those run on OpenCode's
// own subsidised infrastructure and are meant to be reached through OpenCode,
// not by us. Treating the sentinel as a credential would do exactly that, so
// it is never accepted as one.
export const ZEN_ANONYMOUS_API_KEY = 'public';

let connection = null;
let snapshot = null;
let snapshotAt = 0;
let inflight = null;
let lease = 0;
let snapshotOwner = null;

/** The bound kernel generation; OC1 is the conservative default before wiring. */
const readOwner = () => {
  if (!connection) return null;
  if (connection.getRuntimeDescriptor) {
    const runtime = connection.getRuntimeDescriptor();
    if (!runtime || ![OPENCODE_GENERATION.OC1, OPENCODE_GENERATION.OC2].includes(runtime.generation)) return null;
    if (runtime.profile && runtime.profile !== OPENCODE_PROFILE.OC1 && runtime.profile !== OPENCODE_PROFILE.OC2) return null;
    if (runtime.profile && runtime.profile !== runtime.generation) return null;
    return { generation: runtime.generation, profile: runtime.profile ?? runtime.generation, endpoint: runtime.endpoint, epoch: runtime.epoch, lease };
  }
  const generation = connection.getGeneration?.() ?? OPENCODE_GENERATION.OC1;
  if (![OPENCODE_GENERATION.OC1, OPENCODE_GENERATION.OC2].includes(generation)) return null;
  return { generation, profile: generation, endpoint: null, epoch: null, lease };
};
const sameOwner = (left, right) => Boolean(left && right
  && left.generation === right.generation && left.profile === right.profile
  && left.endpoint === right.endpoint && left.epoch === right.epoch && left.lease === right.lease);
export const getRuntimeGeneration = () => {
  if (!connection) return OPENCODE_GENERATION.OC1;
  if (connection.getRuntimeDescriptor) return connection.getRuntimeDescriptor()?.generation ?? OPENCODE_GENERATION.OC1;
  return connection.getGeneration?.() ?? OPENCODE_GENERATION.OC1;
};

const defaultModelSchema = z.object({ providerID: z.string().min(1), id: z.string().min(1) });

/** The OC2 default model is an explicit runtime selection, not an auth-order guess. */
export const getRuntimeDefaultModel = async (directory) => {
  const owner = readOwner();
  if (owner?.generation !== OPENCODE_GENERATION.OC2 || !connection?.getDefaultModel) return null;
  const selectedConnection = connection;
  const result = await selectedConnection.getDefaultModel(directory);
  if (!sameOwner(owner, readOwner()) || selectedConnection !== connection) return null;
  if (result?.generation !== OPENCODE_GENERATION.OC2) throw new Error('Default model came from another OpenCode generation');
  if (result.data === null) return null;
  const parsed = defaultModelSchema.safeParse(result.data);
  if (!parsed.success) throw new Error('OpenCode returned an invalid default model');
  return { providerID: parsed.data.providerID, modelID: parsed.data.id, source: 'default' };
};

/**
 * Wires this module to the running OpenCode instance. Called once at server
 * startup; pass `null` to detach. Until it is wired every lookup answers
 * "nothing known", which leaves the file-based resolution unchanged.
 */
export function configureOpenCodeRuntimeProviders(next) {
  connection = next ?? null;
  resetOpenCodeRuntimeProviders();
}

/**
 * Drops every cached answer. OpenCode restarts reload plugins, which can
 * change ports, keys and the provider list itself.
 */
export function resetOpenCodeRuntimeProviders() {
  lease += 1;
  snapshot = null;
  snapshotOwner = null;
  snapshotAt = 0;
  inflight = null;
}

/**
 * The boundary. Everything the `/provider` payload claims is checked here, so
 * the rest of this module and its callers work with settled values:
 * a credential we may use, provider and model endpoints, and whether the
 * provider is the anonymous zen case.
 *
 * The credential deliberately prefers `options.apiKey` over the `key` field:
 * for a plugin provider the former is what its auth loader produced and what
 * OpenCode itself sends, while `key` only carries env/auth.json values this
 * server can already read from disk.
 */
function parseProviderListing(payload) {
  const providers = new Map();
  const connected = new Set();
  if (!payload || typeof payload !== 'object') return { providers, connected };

  const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const record = (value) => (value && typeof value === 'object' ? value : {});
  const endpoint = (value) => text(value)?.replace(/\/+$/, '') ?? null;

  for (const raw of Array.isArray(payload.all) ? payload.all : []) {
    const id = text(record(raw).id);
    if (!id) continue;
    const options = record(record(raw).options);
    const models = new Map();
    for (const [modelID, rawModel] of Object.entries(record(record(raw).models))) {
      const model = record(rawModel);
      const api = record(model.api);
      const modelURL = endpoint(api.url);
      const modelNpm = text(api.npm);
      models.set(modelID, { api: { url: modelURL, npm: modelNpm } });
    }
    const firstModel = models.values().next().value;
    const declaredKey = text(options.apiKey);
    providers.set(id, {
      id,
      source: text(record(raw).source),
      apiKey: declaredKey === ZEN_ANONYMOUS_API_KEY ? null : (declaredKey ?? text(record(raw).key)),
      baseURL: endpoint(options.baseURL) ?? firstModel?.api?.url ?? null,
      models,
      // True only for the zen-without-login case: a provider that is present
      // and usable through OpenCode, but that we must not call ourselves.
      anonymousZen: declaredKey === ZEN_ANONYMOUS_API_KEY,
    });
  }

  // Providers OpenCode considers usable right now. A provider can be present
  // in `all` (it is in the catalog) without any credential behind it.
  for (const raw of Array.isArray(payload.connected) ? payload.connected : []) {
    const id = text(raw);
    if (id) connected.add(id);
  }

  return { providers, connected };
}

const fetchSnapshot = async (boundConnection, owner) => {
  const response = await fetch(boundConnection.buildOpenCodeUrl('/provider', ''), {
    headers: { Accept: 'application/json', ...boundConnection.getOpenCodeAuthHeaders() },
    signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OpenCode provider listing failed with ${response.status}`);
  }
  const parsed = parseProviderListing(await response.json());
  return sameOwner(owner, readOwner()) && boundConnection === connection ? parsed : null;
};

/**
 * The current runtime provider snapshot, or `null` when OpenCode cannot be
 * reached.
 *
 * `null` means "unknown", never "no providers": callers must fall back to
 * their file-based resolution rather than treat an unreachable OpenCode as an
 * empty provider list.
 */
export async function getRuntimeProviderSnapshot() {
  const owner = readOwner();
  if (!owner) return null;
  if (snapshot && sameOwner(snapshotOwner, owner) && Date.now() - snapshotAt < SNAPSHOT_TTL_MS) return snapshot;
  if (inflight && sameOwner(inflight.owner, owner)) {
    try {
      return await inflight.promise;
    } catch {
      return snapshot && sameOwner(snapshotOwner, owner) && sameOwner(owner, readOwner()) ? snapshot : null;
    }
  }
  const boundConnection = connection;
  const request = { owner, promise: null };
  request.promise = fetchSnapshot(boundConnection, owner).then((result) => {
    if (!result || !sameOwner(owner, readOwner()) || boundConnection !== connection) return null;
    snapshot = result;
    snapshotOwner = owner;
    snapshotAt = Date.now();
    return result;
  }).finally(() => {
    if (inflight === request) inflight = null;
  });
  inflight = request;
  try {
    return await request.promise;
  } catch {
    // A cached answer is valid only for the owner that produced it.
    return snapshot && sameOwner(snapshotOwner, readOwner()) && sameOwner(snapshotOwner, owner) ? snapshot : null;
  }
}

/**
 * Runtime credential and endpoint for one provider, or `null` when OpenCode
 * knows nothing about it.
 */
export async function getRuntimeProvider(providerID) {
  const current = await getRuntimeProviderSnapshot();
  return current?.providers.get(providerID) ?? null;
}
