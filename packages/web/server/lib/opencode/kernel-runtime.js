import { detectOpenCodeGeneration, OPENCODE_GENERATION } from './compatibility.js';

export class KernelRuntimeChangedError extends Error {
  constructor() {
    super('OpenCode connection changed while its generation was being resolved');
    this.name = 'KernelRuntimeChangedError';
  }
}

// A probe that could not identify a live kernel: both endpoints errored, the
// response was unparseable, or the health/info versions disagreed. These
// results describe an inconclusive probe, not a real kernel switch.
const TRANSIENT_GENERATIONS = new Set([
  OPENCODE_GENERATION.UNREACHABLE,
  OPENCODE_GENERATION.UNKNOWN,
]);

const isResolvedGeneration = (generation) => generation === OPENCODE_GENERATION.OC1
  || generation === OPENCODE_GENERATION.OC2;

/** Owns the descriptor for one backend instance. Restart/auth changes invalidate it explicitly. */
export const createKernelRuntime = ({ getEndpoint, getHeaders, headersForGeneration, detect = detectOpenCodeGeneration, onChange = () => {} }) => {
  let source = getEndpoint();
  let epoch = 0;
  let pendingProbe = null;
  let pendingRefresh = null;
  const unresolved = () => Object.freeze({
    generation: OPENCODE_GENERATION.UNKNOWN, endpoint: null, epoch, version: null,
  });
  let current = unresolved();

  const invalidate = () => {
    source = getEndpoint();
    epoch += 1;
    pendingProbe = null;
    pendingRefresh = null;
    current = unresolved();
    onChange(current);
  };

  const get = () => {
    if (source !== getEndpoint()) invalidate();
    return current;
  };

  const commit = (result) => {
    const changed = current.generation !== result.generation
      || current.endpoint !== result.endpoint
      || current.version !== result.version;
    if (changed) epoch += 1;
    current = Object.freeze({ ...result, epoch });
    if (changed) onChange(current);
    return current;
  };

  // One in-flight raw probe shared by refresh and reprobe. The epoch/endpoint
  // recheck after `detect` rejects a result produced for a connection that was
  // replaced while the probe was outstanding.
  const startProbe = () => {
    get();
    if (!source) return null;
    if (pendingProbe) return pendingProbe;
    const endpoint = source;
    const revision = epoch;
    const headers = new Headers(getHeaders());
    const operation = Promise.resolve().then(() => {
      get();
      if (revision !== epoch || endpoint !== source) throw new KernelRuntimeChangedError();
      return detect({ endpoint, epoch: revision, headers, headersForGeneration });
    }).then((result) => {
      get();
      if (revision !== epoch || endpoint !== source) throw new KernelRuntimeChangedError();
      return result;
    }).finally(() => {
      if (pendingProbe === operation) pendingProbe = null;
    });
    pendingProbe = operation;
    return operation;
  };

  const refresh = () => {
    const probe = startProbe();
    if (!probe) return Promise.resolve(current);
    if (pendingRefresh) return pendingRefresh;
    const committed = probe.then(commit).finally(() => {
      if (pendingRefresh === committed) pendingRefresh = null;
    });
    pendingRefresh = committed;
    return pendingRefresh;
  };

  // Health-monitoring re-probe. A transient failure must not retract a kernel
  // that was already resolved while its process is still alive: keep the live
  // descriptor and epoch, and report the raw generation so the caller can still
  // count the failure and restart once its budget is spent. A probe that
  // positively identifies any generation commits, so a real kernel switch (or
  // a genuine unsupported/unknown owner) still updates immediately.
  const reprobe = async () => {
    const probe = startProbe();
    if (!probe) return { descriptor: current, generation: current.generation, preserved: false };
    const result = await probe;
    if (TRANSIENT_GENERATIONS.has(result.generation) && isResolvedGeneration(current.generation)) {
      return { descriptor: current, generation: result.generation, preserved: true };
    }
    return { descriptor: commit(result), generation: result.generation, preserved: false };
  };

  return { get, refresh, reprobe, invalidate };
};
