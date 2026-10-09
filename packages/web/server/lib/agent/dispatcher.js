import { AGENT_ATTEMPT, AGENT_ERROR, AGENT_HOST_OPERATION, AGENT_MUTATIONS, AGENT_OPERATION, AGENT_SUPPORT } from './constants.js';
import { AGENT_INPUT_SCHEMAS, AGENT_OUTPUT_SCHEMAS, agentIdentitySchema, agentPrincipalSchema } from './schemas.js';

const operations = new Set(Object.values(AGENT_OPERATION));
const mutations = new Set(AGENT_MUTATIONS);

const matchesScope = (operation, request, result) => {
  switch (operation) {
    case AGENT_OPERATION.GET_MESSAGE:
      return result.sessionID === request.sessionID && result.id === request.messageID;
    case AGENT_OPERATION.LIST_MESSAGES:
      return result.items.every((item) => item.sessionID === request.sessionID);
    case AGENT_OPERATION.ADD_SYNTHETIC:
      return result.sessionID === request.sessionID;
    default:
      return true;
  }
};

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
  && left.capabilityRevision === right.capabilityRevision
  && left.principalID === right.principalID;

const refusal = (binding, operation) => {
  if (!binding) return AGENT_ERROR.UNAVAILABLE;
  if (!binding.authorized) return AGENT_ERROR.UNAUTHORIZED;
  if (!binding.ready) return AGENT_ERROR.UNAVAILABLE;
  const capability = binding.capabilities[operation];
  if (!capability || capability.state === AGENT_SUPPORT.UNVERIFIED) return AGENT_ERROR.UNVERIFIED;
  if (capability.state === AGENT_SUPPORT.UNSUPPORTED) return AGENT_ERROR.UNSUPPORTED;
  const accepted = binding.acceptance;
  if ((capability.state !== AGENT_SUPPORT.SUPPORTED && capability.state !== AGENT_SUPPORT.ADAPTED)
    || !capability.evidence.length || !accepted
    || accepted.adapterRevision !== binding.identity.adapterRevision
    || accepted.capabilityRevision !== binding.identity.capabilityRevision
    || !accepted.operations.includes(operation)) return AGENT_ERROR.UNACCEPTED;
  if (!Object.hasOwn(binding.handlers, operation)) return AGENT_ERROR.MISSING_HANDLER;
  return null;
};

/** A host-owned binding, never an adapter manifest, grants dispatch authority. */
export const createAgentDispatcher = ({ getBinding, attempts }) => {
  const requireOperation = (operation) => {
    if (!operations.has(operation)) throw new AgentDispatchError(AGENT_ERROR.UNKNOWN_OPERATION, operation);
  };
  const requireBinding = (operation, expected) => {
    requireOperation(operation);
    const binding = getBinding();
    if (!binding) throw new AgentDispatchError(AGENT_ERROR.UNAVAILABLE, operation);
    if (expected && !same(expected, binding.identity)) throw new AgentDispatchError(AGENT_ERROR.CHANGED, operation);
    const code = refusal(binding, operation);
    if (code) throw new AgentDispatchError(code, operation);
    return binding;
  };
  const captureIdentity = () => {
    const binding = getBinding();
    if (!binding) throw new AgentDispatchError(AGENT_ERROR.UNAVAILABLE, AGENT_HOST_OPERATION.CAPTURE_IDENTITY);
    if (!binding.authorized) throw new AgentDispatchError(AGENT_ERROR.UNAUTHORIZED, AGENT_HOST_OPERATION.CAPTURE_IDENTITY);
    if (!binding.ready) throw new AgentDispatchError(AGENT_ERROR.UNAVAILABLE, AGENT_HOST_OPERATION.CAPTURE_IDENTITY);
    return Object.freeze({ ...binding.identity });
  };
  const describeRuntime = () => {
    const binding = getBinding();
    const operation = AGENT_HOST_OPERATION.DESCRIBE_RUNTIME;
    if (!binding) throw new AgentDispatchError(AGENT_ERROR.UNAVAILABLE, operation);
    if (!binding.authorized) throw new AgentDispatchError(AGENT_ERROR.UNAUTHORIZED, operation);
    if (!binding.ready) throw new AgentDispatchError(AGENT_ERROR.UNAVAILABLE, operation);
    return {
      identity: Object.freeze({ ...binding.identity }),
      operations: Object.fromEntries([...operations].map((id) => {
        const reason = refusal(binding, id) || (mutations.has(id) && !attempts ? AGENT_ERROR.WRITE_UNAVAILABLE : null);
        return [id, reason ? { available: false, reason } : { available: true }];
      })),
    };
  };
  const dispatch = async (operation, input, expected) => {
    const binding = requireBinding(operation, expected);
    const request = AGENT_INPUT_SCHEMAS[operation].safeParse(input);
    if (!request.success) throw new AgentDispatchError(AGENT_ERROR.INVALID_INPUT, operation);
    const identity = Object.freeze({ ...binding.identity });
    const handler = binding.handlers[operation];
    const mutation = mutations.has(operation);
    if (mutation && !attempts) throw new AgentDispatchError(AGENT_ERROR.WRITE_UNAVAILABLE, operation);
    const attempt = mutation ? await attempts.begin(identity, operation, request.data.requestID) : null;
    // Re-read at the point of effect. The host can replace a binding while
    // earlier checks run. No handler may run under a stale lease.
    try {
      requireBinding(operation, identity);
    } catch (error) {
      await attempt?.finish(AGENT_ATTEMPT.NOT_SENT);
      throw error;
    }
    let finalizing = false;
    try {
      const data = await handler(request.data, identity);
      const current = getBinding();
      if (!current || !same(identity, current.identity)) {
        throw new AgentDispatchError(
          mutations.has(operation) ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.CHANGED, operation,
        );
      }
      requireBinding(operation, identity);
      const response = AGENT_OUTPUT_SCHEMAS[operation].safeParse(data);
      if (!response.success || !matchesScope(operation, request.data, response.data)) {
        throw new AgentDispatchError(
          mutations.has(operation) ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.INVALID_RESPONSE, operation,
        );
      }
      if (attempt) {
        const result = response.data;
        if (Object.hasOwn(result, 'requestID') && result.requestID !== request.data.requestID) {
          throw new AgentDispatchError(AGENT_ERROR.UNKNOWN_OUTCOME, operation);
        }
        const state = Object.hasOwn(result, 'requestID') ? result.state : AGENT_ATTEMPT.COMPLETE;
        finalizing = true;
        await attempt.finish(state);
        requireBinding(operation, identity);
        if (state === AGENT_ATTEMPT.UNKNOWN) throw new AgentDispatchError(AGENT_ERROR.UNKNOWN_OUTCOME, operation);
      }
      return { identity, data: response.data };
    } catch (error) {
      if (attempt) {
        if (!finalizing) await attempt.finish(AGENT_ATTEMPT.UNKNOWN).catch(() => {});
        throw new AgentDispatchError(AGENT_ERROR.UNKNOWN_OUTCOME, operation);
      }
      const current = getBinding();
      if (!current || !same(identity, current.identity)) {
        throw new AgentDispatchError(
          mutations.has(operation) ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.CHANGED, operation,
        );
      }
      if (mutations.has(operation)) throw new AgentDispatchError(AGENT_ERROR.UNKNOWN_OUTCOME, operation);
      throw error;
    }
  };
  const readAttempt = async (expected, requestID) => {
    const operation = AGENT_HOST_OPERATION.READ_ATTEMPT;
    const parsed = agentIdentitySchema.safeParse(expected);
    if (!parsed.success) throw new AgentDispatchError(AGENT_ERROR.INVALID_INPUT, operation);
    const identity = captureIdentity();
    if (!same(identity, parsed.data)) throw new AgentDispatchError(AGENT_ERROR.CHANGED, operation);
    if (!attempts) throw new AgentDispatchError(AGENT_ERROR.WRITE_UNAVAILABLE, operation);
    const attempt = await attempts.read(identity, requestID);
    const current = captureIdentity();
    if (!same(identity, current)) throw new AgentDispatchError(AGENT_ERROR.CHANGED, operation);
    return { identity, attempt };
  };
  const forPrincipal = (principalID) => {
    const parsed = agentPrincipalSchema.safeParse(principalID);
    if (!parsed.success) throw new AgentDispatchError(AGENT_ERROR.UNAUTHORIZED, AGENT_HOST_OPERATION.GET_BINDING);
    return createAgentDispatcher({
      attempts,
      getBinding: () => {
        const binding = getBinding();
        return binding ? { ...binding, identity: { ...binding.identity, principalID: parsed.data } } : null;
      },
    });
  };
  return Object.freeze({ captureIdentity, describeRuntime, dispatch, readAttempt, forPrincipal });
};
