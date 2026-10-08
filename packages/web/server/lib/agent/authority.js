import { z } from 'zod';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_HOST_OPERATION, AGENT_SUPPORT } from './constants.js';
import { AgentDispatchError } from './dispatcher.js';
import { agentIdentitySchema, agentOperationSchema } from './schemas.js';

const id = z.string().min(1);
const evidence = z.array(id).refine((items) => new Set(items).size === items.length);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const capability = z.object({
  state: z.enum(Object.values(AGENT_SUPPORT)), evidence, reason: id.optional(),
}).strict();
const registration = z.object({
  adapterID: id,
  family: z.enum(Object.values(AGENT_FAMILY)),
  adapterRevision: id,
  capabilityRevision: id,
  artifactDigest: digest,
  capabilities: z.partialRecord(agentOperationSchema, capability),
  handlers: z.partialRecord(agentOperationSchema, z.function()),
}).strict();
const selection = agentIdentitySchema.extend({
  adapterID: id, serverRevision: id, ready: z.boolean(), authorized: z.boolean(),
}).strict();
const approval = z.object({
  family: z.enum(Object.values(AGENT_FAMILY)),
  connectionID: id,
  adapterID: id,
  adapterRevision: id,
  capabilityRevision: id,
  serverRevision: id,
  artifactDigest: digest,
  operations: z.array(z.object({ operation: agentOperationSchema, evidence: evidence.min(1) }).strict())
    .refine((items) => new Set(items.map((item) => item.operation)).size === items.length),
}).strict();

const key = (item) => JSON.stringify([
  item.family, item.adapterID, item.adapterRevision, item.capabilityRevision,
]);
const refuse = (code) => new AgentDispatchError(code, AGENT_HOST_OPERATION.GET_BINDING);

/** Only protected host composition supplies registrations and acceptance ports. */
export const createAgentAuthority = ({ registrations, getSelection, getAcceptance }) => {
  const registry = new Map();
  for (const candidate of registrations) {
    const parsed = registration.safeParse(candidate);
    if (!parsed.success || registry.has(key(parsed.data))) throw refuse(AGENT_ERROR.INVALID_INPUT);
    const item = parsed.data;
    const capabilities = Object.freeze(Object.fromEntries(Object.entries(item.capabilities).map(([operation, value]) => [
      operation, Object.freeze({ ...value, evidence: Object.freeze([...value.evidence]) }),
    ])));
    registry.set(key(item), Object.freeze({ ...item, capabilities, handlers: Object.freeze({ ...item.handlers }) }));
  }

  const getBinding = () => {
    let selected;
    try {
      selected = selection.safeParse(getSelection());
    } catch {
      throw refuse(AGENT_ERROR.UNAVAILABLE);
    }
    if (!selected.success) return null;
    const current = Object.freeze(selected.data);
    const adapter = registry.get(key(current));
    if (!adapter) return null;
    let accepted;
    try {
      accepted = approval.safeParse(current.authorized && current.ready ? getAcceptance(current) : null);
    } catch {
      throw refuse(AGENT_ERROR.UNAVAILABLE);
    }
    const matches = accepted.success
      && key(accepted.data) === key(current)
      && accepted.data.connectionID === current.connectionID
      && accepted.data.serverRevision === current.serverRevision
      && accepted.data.artifactDigest === adapter.artifactDigest;
    const operations = matches ? accepted.data.operations.filter((item) => {
      const support = adapter.capabilities[item.operation];
      return support && (support.state === AGENT_SUPPORT.SUPPORTED || support.state === AGENT_SUPPORT.ADAPTED)
        && support.evidence.length > 0 && Object.hasOwn(adapter.handlers, item.operation);
    }).map((item) => item.operation) : null;
    return Object.freeze({
      identity: Object.freeze({
        family: current.family, connectionID: current.connectionID, epoch: current.epoch,
        adapterRevision: current.adapterRevision, capabilityRevision: current.capabilityRevision,
      }),
      ready: current.ready,
      authorized: current.authorized,
      capabilities: adapter.capabilities,
      handlers: adapter.handlers,
      acceptance: operations === null ? null : Object.freeze({
        adapterRevision: current.adapterRevision, capabilityRevision: current.capabilityRevision,
        operations: Object.freeze(operations),
      }),
    });
  };
  return Object.freeze({ getBinding });
};
