import { detectOpenCodeGeneration, OPENCODE_GENERATION } from './compatibility.js';
import { AGENT_FAMILY } from '../agent/constants.js';

const OPEN_CODE_SELECTION = Object.freeze({ family: AGENT_FAMILY.OPENCODE, revision: 0 });

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
export const createKernelRuntime = ({ getEndpoint, getHeaders, headersForGeneration, getBackendSelection = () => OPEN_CODE_SELECTION, detect = detectOpenCodeGeneration, onChange = () => {} }) => {
  let selection = getBackendSelection();
  let source = getEndpoint();
  let epoch = 0;
  let revision = 0;
  let pendingProbe = null;
  let pendingRefresh = null;
  const unresolved = () => Object.freeze({
    generation: selection.family === AGENT_FAMILY.OPENCODE ? OPENCODE_GENERATION.UNKNOWN : OPENCODE_GENERATION.UNSUPPORTED,
    endpoint: null, epoch, version: null,
  });
  let current = unresolved();

  const invalidate = () => {
    selection = getBackendSelection();
    source = getEndpoint();
    epoch += 1;
    revision += 1;
    pendingProbe = null;
    pendingRefresh = null;
    current = unresolved();
    onChange(current);
  };

  const get = () => {
    const next = getBackendSelection();
    if (source !== getEndpoint() || next.family !== selection.family || next.revision !== selection.revision) invalidate();
    return current;
  };

  const checkProbe = (probe) => {
    get();
    if (selection.family !== AGENT_FAMILY.OPENCODE || probe.revision !== revision || probe.endpoint !== source) {
      throw new KernelRuntimeChangedError();
    }
  };

  const commit = (probe) => {
    checkProbe(probe);
    const result = probe.result;
    const changed = current.generation !== result.generation
      || current.endpoint !== result.endpoint
      || current.version !== result.version
      || current.profile !== result.profile;
    if (changed) epoch += 1;
    current = Object.freeze({ ...result, epoch });
    if (changed) onChange(current);
    return current;
  };

  // One in-flight raw probe shared by refresh and reprobe. The connection/endpoint
  // recheck after `detect` rejects a result produced for a connection that was
  // replaced while the probe was outstanding.
  const startProbe = () => {
    get();
    if (selection.family !== AGENT_FAMILY.OPENCODE || !source) return null;
    if (pendingProbe) return pendingProbe;
    const endpoint = source;
    const ticket = revision;
    const probeEpoch = epoch;
    const headers = new Headers(getHeaders());
    const operation = Promise.resolve().then(() => {
      get();
      if (ticket !== revision || endpoint !== source) throw new KernelRuntimeChangedError();
      return detect({ endpoint, epoch: probeEpoch, headers, headersForGeneration });
    }).then((result) => {
      get();
      if (ticket !== revision || endpoint !== source) throw new KernelRuntimeChangedError();
      return { result, revision: ticket, endpoint };
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
    const candidate = await probe;
    checkProbe(candidate);
    const result = candidate.result;
    if (TRANSIENT_GENERATIONS.has(result.generation) && isResolvedGeneration(current.generation)) {
      return { descriptor: current, generation: result.generation, preserved: true };
    }
    return { descriptor: commit(candidate), generation: result.generation, preserved: false };
  };

  return { get, refresh, reprobe, invalidate };
};
