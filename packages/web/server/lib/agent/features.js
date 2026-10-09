import { z } from 'zod';

import { AGENT_ERROR, AGENT_FEATURE, AGENT_HOST_OPERATION, AGENT_OPERATION } from './constants.js';
import { agentIdentitySchema, agentRuntimeSchema } from './schemas.js';

const rule = (all, any = []) => Object.freeze({
  all: Object.freeze(all), any: Object.freeze(any.map((items) => Object.freeze(items))),
});
const op = AGENT_OPERATION;
/** Features consumed by the separate CAgent conversation page, not the OpenCode app. */
export const AGENT_CONVERSATION_FEATURES = Object.freeze([
  AGENT_FEATURE.ACQUIRE_SESSION, AGENT_FEATURE.HISTORY, AGENT_FEATURE.PROMPT,
]);
/** Maintainer-owned action dependencies. Candidate adapters cannot replace these rules. */
export const AGENT_FEATURE_RULES = Object.freeze({
  [AGENT_FEATURE.ACQUIRE_SESSION]: rule([], [[op.CREATE_SESSION], [op.GET_SESSION]]),
  [AGENT_FEATURE.SESSION_LIST]: rule([op.LIST_SESSIONS]),
  [AGENT_FEATURE.HISTORY]: rule([op.GET_SESSION, op.LIST_MESSAGES]),
  [AGENT_FEATURE.MESSAGE]: rule([op.GET_SESSION, op.GET_MESSAGE]),
  [AGENT_FEATURE.CHILDREN]: rule([op.GET_SESSION, op.LIST_CHILDREN]),
  [AGENT_FEATURE.ACTIVITY]: rule([op.LIST_ACTIVE_STATUSES]),
  [AGENT_FEATURE.PROMPT]: rule([op.GET_SESSION, op.SEND_PROMPT, op.GET_SESSION_STATUS]),
  [AGENT_FEATURE.COMMAND]: rule([op.GET_SESSION, op.LIST_COMMANDS, op.SEND_COMMAND, op.GET_SESSION_STATUS]),
  [AGENT_FEATURE.STOP]: rule([op.GET_SESSION, op.INTERRUPT_SESSION, op.GET_SESSION_STATUS]),
  [AGENT_FEATURE.PERMISSION]: rule([op.LIST_PENDING_PERMISSIONS, op.REPLY_PERMISSION]),
  [AGENT_FEATURE.SELECTION]: rule([op.GET_SESSION, op.GET_SELECTION_CATALOG, op.SWITCH_SELECTION]),
  [AGENT_FEATURE.DEFAULT_MODEL]: rule([op.GET_DEFAULT_MODEL]),
  [AGENT_FEATURE.SYNTHETIC]: rule([op.GET_SESSION, op.ADD_SYNTHETIC]),
  [AGENT_FEATURE.IMPORT]: rule([op.IMPORT_SESSION]),
  [AGENT_FEATURE.FORK]: rule([op.GET_SESSION, op.FORK_SESSION]),
  [AGENT_FEATURE.REMOVE]: rule([op.GET_SESSION, op.REMOVE_SESSION]),
  [AGENT_FEATURE.UPDATE]: rule([op.GET_SESSION, op.UPDATE_SESSION]),
});
const feature = z.enum(Object.values(AGENT_FEATURE));
const hostSchema = z.object({
  identity: agentIdentitySchema,
  implemented: z.array(feature).refine((items) => new Set(items).size === items.length),
}).strict();
const same = (left, right) => left.family === right.family && left.connectionID === right.connectionID
  && left.epoch === right.epoch && left.adapterRevision === right.adapterRevision
  && left.capabilityRevision === right.capabilityRevision && left.principalID === right.principalID;
const blocked = (reason) => Object.freeze({ available: false, reason });

export class AgentFeatureError extends Error {
  constructor(code, featureID) {
    super(`Agent feature ${featureID} refused: ${code}`);
    this.name = 'AgentFeatureError';
    this.code = code;
    this.feature = featureID;
  }
}

/** Both ports belong to the host. Every call reads current authority, never a cached snapshot. */
export const createAgentFeatures = ({ getRuntime, getHostSupport = () => null }) => {
  const describe = () => {
    const runtime = agentRuntimeSchema.safeParse(getRuntime());
    if (!runtime.success) throw new AgentFeatureError(AGENT_ERROR.INVALID_RESPONSE, AGENT_HOST_OPERATION.DESCRIBE_FEATURES);
    let host;
    try { host = hostSchema.safeParse(getHostSupport()); }
    catch { throw new AgentFeatureError(AGENT_ERROR.UNAVAILABLE, AGENT_HOST_OPERATION.DESCRIBE_FEATURES); }
    if (host.success && !same(runtime.data.identity, host.data.identity)) {
      throw new AgentFeatureError(AGENT_ERROR.CHANGED, AGENT_HOST_OPERATION.DESCRIBE_FEATURES);
    }
    const implemented = new Set(host.success ? host.data.implemented : []);
    const check = (ids) => ids.map((id) => runtime.data.operations[id]).find((state) => !state.available);
    const features = Object.fromEntries(Object.entries(AGENT_FEATURE_RULES).map(([id, dependency]) => {
      if (!implemented.has(id)) return [id, blocked(AGENT_ERROR.UNMIGRATED)];
      const required = check(dependency.all);
      if (required) return [id, blocked(required.reason)];
      if (dependency.any.length && dependency.any.every((ids) => check(ids))) {
        return [id, blocked(AGENT_ERROR.DEPENDENCY)];
      }
      return [id, Object.freeze({ available: true })];
    }));
    return Object.freeze({ identity: Object.freeze({ ...runtime.data.identity }), features: Object.freeze(features) });
  };
  const requireFeature = (id, expected) => {
    const parsed = feature.safeParse(id);
    if (!parsed.success) throw new AgentFeatureError(AGENT_ERROR.UNKNOWN_FEATURE, AGENT_ERROR.UNKNOWN_FEATURE);
    const identity = agentIdentitySchema.safeParse(expected);
    if (!identity.success) throw new AgentFeatureError(AGENT_ERROR.INVALID_INPUT, parsed.data);
    const current = describe();
    if (!same(current.identity, identity.data)) throw new AgentFeatureError(AGENT_ERROR.CHANGED, parsed.data);
    const availability = current.features[parsed.data];
    if (!availability.available) throw new AgentFeatureError(availability.reason, parsed.data);
    return current.identity;
  };
  return Object.freeze({ describe, requireFeature });
};
