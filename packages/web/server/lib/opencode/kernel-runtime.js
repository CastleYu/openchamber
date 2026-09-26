import { detectOpenCodeGeneration, OPENCODE_GENERATION } from './compatibility.js';

export class KernelRuntimeChangedError extends Error {
  constructor() {
    super('OpenCode connection changed while its generation was being resolved');
    this.name = 'KernelRuntimeChangedError';
  }
}

/** Owns the descriptor for one backend instance. Restart/auth changes invalidate it explicitly. */
export const createKernelRuntime = ({ getEndpoint, getHeaders, detect = detectOpenCodeGeneration, onChange = () => {} }) => {
  let source = getEndpoint();
  let epoch = 0;
  let pending = null;
  const unresolved = () => Object.freeze({
    generation: OPENCODE_GENERATION.UNKNOWN, endpoint: null, epoch, version: null,
  });
  let current = unresolved();

  const invalidate = () => {
    source = getEndpoint();
    epoch += 1;
    pending = null;
    current = unresolved();
    onChange(current);
  };

  const get = () => {
    if (source !== getEndpoint()) invalidate();
    return current;
  };

  const refresh = () => {
    get();
    if (!source) return Promise.resolve(current);
    if (pending) return pending;
    const endpoint = source;
    const revision = epoch;
    const headers = new Headers(getHeaders());
    const operation = Promise.resolve().then(() => {
      get();
      if (revision !== epoch || endpoint !== source) throw new KernelRuntimeChangedError();
      return detect({ endpoint, epoch: revision, headers });
    }).then((result) => {
      get();
      if (revision !== epoch || endpoint !== source) throw new KernelRuntimeChangedError();
      const changed = current.generation !== result.generation
        || current.endpoint !== result.endpoint
        || current.version !== result.version;
      if (changed) epoch += 1;
      current = Object.freeze({ ...result, epoch });
      if (changed) onChange(current);
      return current;
    }).finally(() => {
      if (pending === operation) pending = null;
    });
    pending = operation;
    return operation;
  };

  return { get, refresh, invalidate };
};
