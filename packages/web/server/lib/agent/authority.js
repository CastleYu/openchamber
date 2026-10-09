import { createHash } from 'node:crypto';
import { AGENT_ERROR, AGENT_FAMILY, AGENT_HOST_OPERATION, AGENT_SUPPORT } from './constants.js';
import { AgentDispatchError } from './dispatcher.js';
import { extensionManifestSchema } from './extensions.js';
import { agentApprovalSchema, agentRegistrationSchema, agentSelectionSchema } from './schemas.js';

const key = (item) => JSON.stringify([
  item.family, item.adapterID, item.adapterRevision, item.capabilityRevision,
]);
const refuse = (code) => new AgentDispatchError(code, AGENT_HOST_OPERATION.GET_BINDING);
const reviewedCapability = (family, capability, approval) => {
  if (family !== AGENT_FAMILY.CAGENT || capability?.state !== AGENT_SUPPORT.UNVERIFIED || !approval?.state) return capability;
  return Object.freeze({ state: approval.state, evidence: Object.freeze([...approval.evidence]) });
};
const deepFreeze = (value) => {
  if (value === null || Object(value) !== value || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) {
    if (child !== null && Object(child) === child) deepFreeze(child);
  }
  Object.freeze(value);
  return value;
};

export const agentExtensionDigest = (manifest) => createHash('sha256')
  .update(JSON.stringify(extensionManifestSchema.parse(manifest)))
  .digest('hex');

/** Only protected host composition supplies registrations and acceptance ports. */
export const createAgentAuthority = ({ registrations, getSelection, getAcceptance }) => {
  const registry = new Map();
  for (const candidate of registrations) {
    const parsed = agentRegistrationSchema.safeParse(candidate);
    if (!parsed.success || registry.has(key(parsed.data))) throw refuse(AGENT_ERROR.INVALID_INPUT);
    const item = parsed.data;
    const capabilities = Object.freeze(Object.fromEntries(Object.entries(item.capabilities).map(([operation, value]) => [
      operation, Object.freeze({ ...value, evidence: Object.freeze([...value.evidence]) }),
    ])));
    const extensions = item.extensions?.map(({ manifest, capability, handler }) => Object.freeze({
      manifest: deepFreeze(manifest),
      capability: Object.freeze({ ...capability, evidence: Object.freeze([...capability.evidence]) }),
      handler,
    }));
    const registered = { ...item, capabilities, handlers: Object.freeze({ ...item.handlers }) };
    if (extensions) registered.extensions = Object.freeze(extensions);
    registry.set(key(item), Object.freeze(registered));
  }

  const getBinding = () => {
    let selected;
    try {
      selected = agentSelectionSchema.safeParse(getSelection());
    } catch {
      throw refuse(AGENT_ERROR.UNAVAILABLE);
    }
    if (!selected.success) return null;
    const current = Object.freeze(selected.data);
    const adapter = registry.get(key(current));
    if (!adapter) return null;
    let accepted;
    try {
      accepted = agentApprovalSchema.safeParse(current.authorized && current.ready ? getAcceptance(current) : null);
    } catch {
      throw refuse(AGENT_ERROR.UNAVAILABLE);
    }
    const matches = accepted.success
      && key(accepted.data) === key(current)
      && accepted.data.connectionID === current.connectionID
      && accepted.data.serverRevision === current.serverRevision
      && accepted.data.artifactDigest === adapter.artifactDigest;
    const approvedOperations = matches ? new Map(accepted.data.operations.map((item) => [item.operation, item])) : new Map();
    const capabilities = Object.freeze(Object.fromEntries(Object.entries(adapter.capabilities).map(([operation, capability]) => [
      operation, reviewedCapability(current.family, capability, approvedOperations.get(operation)),
    ])));
    const operations = matches ? accepted.data.operations.filter((item) => {
      const support = capabilities[item.operation];
      return support && (support.state === AGENT_SUPPORT.SUPPORTED || support.state === AGENT_SUPPORT.ADAPTED)
        && support.evidence.length > 0 && Object.hasOwn(adapter.handlers, item.operation);
    }).map((item) => item.operation) : null;
    const approvals = matches ? new Map(accepted.data.extensions?.map((item) => [item.actionID, item]) ?? []) : new Map();
    const extensions = (adapter.extensions ?? []).map((item) => {
      const acceptedExtension = approvals.get(item.manifest.actionID);
      const exact = acceptedExtension && acceptedExtension.revision === item.manifest.revision
        && acceptedExtension.manifestDigest === agentExtensionDigest(item.manifest);
      const capability = reviewedCapability(current.family, item.capability, exact ? acceptedExtension : null);
      const supported = (capability.state === AGENT_SUPPORT.SUPPORTED || capability.state === AGENT_SUPPORT.ADAPTED)
        && capability.evidence.length > 0;
      return Object.freeze({
        ...item,
        capability,
        accepted: Boolean(exact && supported),
      });
    });
    const binding = {
      identity: Object.freeze({
        family: current.family, connectionID: current.connectionID, epoch: current.epoch,
        adapterRevision: current.adapterRevision, capabilityRevision: current.capabilityRevision,
      }),
      ready: current.ready,
      authorized: current.authorized,
      capabilities,
      handlers: adapter.handlers,
      acceptance: operations === null ? null : Object.freeze({
        adapterRevision: current.adapterRevision, capabilityRevision: current.capabilityRevision,
        operations: Object.freeze(operations),
      }),
    };
    if (adapter.extensions) binding.extensions = Object.freeze(extensions);
    return Object.freeze(binding);
  };
  return Object.freeze({ getBinding });
};
