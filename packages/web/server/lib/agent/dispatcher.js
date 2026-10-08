import { AGENT_ERROR, AGENT_MUTATIONS, AGENT_OPERATION, AGENT_SUPPORT } from './constants.js';

const operations = new Set(Object.values(AGENT_OPERATION));
const mutations = new Set(AGENT_MUTATIONS);

export class AgentDispatchError extends Error {
  constructor(code, operation) {
    super(`Agent operation ${operation} refused: ${code}`);
    this.name = 'AgentDispatchError';
    this.code = code;
    this.operation = operation;
  }
}

const same = (left, right) => left.family === right.family
  && left.connectionID === right.connectionID
  && left.epoch === right.epoch
  && left.adapterRevision === right.adapterRevision
  && left.capabilityRevision === right.capabilityRevision;

/** A host-owned binding, never an adapter manifest, grants dispatch authority. */
export const createAgentDispatcher = ({ getBinding }) => {
  const requireOperation = (operation) => {
    if (!operations.has(operation)) throw new AgentDispatchError(AGENT_ERROR.UNKNOWN_OPERATION, operation);
  };
  const requireBinding = (operation, expected) => {
    requireOperation(operation);
    const binding = getBinding();
    if (!binding) throw new AgentDispatchError(AGENT_ERROR.UNAVAILABLE, operation);
    if (expected && !same(expected, binding.identity)) throw new AgentDispatchError(AGENT_ERROR.CHANGED, operation);
    if (!binding.authorized) throw new AgentDispatchError(AGENT_ERROR.UNAUTHORIZED, operation);
    if (!binding.ready) throw new AgentDispatchError(AGENT_ERROR.UNAVAILABLE, operation);
    const capability = binding.capabilities[operation];
    if (!capability || capability.state === AGENT_SUPPORT.UNVERIFIED) {
      throw new AgentDispatchError(AGENT_ERROR.UNVERIFIED, operation);
    }
    if (capability.state === AGENT_SUPPORT.UNSUPPORTED) {
      throw new AgentDispatchError(AGENT_ERROR.UNSUPPORTED, operation);
    }
    const accepted = binding.acceptance;
    if ((capability.state !== AGENT_SUPPORT.SUPPORTED && capability.state !== AGENT_SUPPORT.ADAPTED)
      || !capability.evidence.length || !accepted
      || accepted.adapterRevision !== binding.identity.adapterRevision
      || accepted.capabilityRevision !== binding.identity.capabilityRevision
      || !accepted.operations.includes(operation)) {
      throw new AgentDispatchError(AGENT_ERROR.UNACCEPTED, operation);
    }
    if (!Object.hasOwn(binding.handlers, operation)) {
      throw new AgentDispatchError(AGENT_ERROR.MISSING_HANDLER, operation);
    }
    return binding;
  };
  const captureIdentity = () => {
    const binding = getBinding();
    if (!binding) throw new AgentDispatchError(AGENT_ERROR.UNAVAILABLE, 'captureIdentity');
    return Object.freeze({ ...binding.identity });
  };
  const dispatch = async (operation, input, expected) => {
    const binding = requireBinding(operation, expected);
    const identity = Object.freeze({ ...binding.identity });
    const handler = binding.handlers[operation];
    // Re-read at the point of effect. The host can replace a binding while
    // earlier checks run. No handler may run under a stale lease.
    requireBinding(operation, identity);
    try {
      const data = await handler(input, identity);
      const current = getBinding();
      if (!current || !same(identity, current.identity)) {
        throw new AgentDispatchError(
          mutations.has(operation) ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.CHANGED, operation,
        );
      }
      return { identity, data };
    } catch (error) {
      const current = getBinding();
      if (!current || !same(identity, current.identity)) {
        throw new AgentDispatchError(
          mutations.has(operation) ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.CHANGED, operation,
        );
      }
      throw error;
    }
  };
  return Object.freeze({ captureIdentity, dispatch });
};
