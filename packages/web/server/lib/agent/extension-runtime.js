import { z } from 'zod';
import { AGENT_ATTEMPT, AGENT_ERROR, AGENT_EXTENSION, AGENT_FAMILY, AGENT_HOST_OPERATION, AGENT_SUPPORT } from './constants.js';
import { AgentDispatchError } from './dispatcher.js';
import { agentIdentitySchema } from './schemas.js';
import { extensionActionIDSchema, parseExtensionInput, parseExtensionResult } from './extensions.js';

export const agentExtensionRequestSchema = z.object({ actionID: extensionActionIDSchema,
  identity: agentIdentitySchema, input: z.json(),
}).strict();

const scopeSchema = z.object({
  workspaceID: z.string().min(1).optional(), sessionID: z.string().min(1).optional(),
  requestID: z.string().min(1).optional(), values: z.json(),
}).strict();
const receiptSchema = z.object({ requestID: z.string().min(1),
  state: z.enum([AGENT_ATTEMPT.ACCEPTED, AGENT_ATTEMPT.COMPLETE, AGENT_ATTEMPT.UNKNOWN]),
}).strict();
const responseSchema = z.object({ result: z.json(), receipt: receiptSchema.optional() }).strict();
const same = (left, right) => left.family === right.family && left.connectionID === right.connectionID
  && left.epoch === right.epoch && left.adapterRevision === right.adapterRevision
  && left.capabilityRevision === right.capabilityRevision && left.principalID === right.principalID;

/** Finite host registrations grant authority. Candidate manifests never do. */
export const createAgentExtensionRuntime = ({ getBinding, attempts }) => {
  const refuse = (code, actionID) => { throw new AgentDispatchError(code, actionID); };
  const binding = (actionID, expected) => {
    const current = getBinding();
    if (!current || !current.ready) return refuse(AGENT_ERROR.UNAVAILABLE, actionID);
    if (!current.authorized || !current.identity.principalID) return refuse(AGENT_ERROR.UNAUTHORIZED, actionID);
    if (current.identity.family !== AGENT_FAMILY.CAGENT) return refuse(AGENT_ERROR.UNSUPPORTED, actionID);
    const parsed = agentIdentitySchema.safeParse(expected);
    if (!parsed.success) return refuse(AGENT_ERROR.INVALID_INPUT, actionID);
    if (!same(parsed.data, current.identity)) return refuse(AGENT_ERROR.CHANGED, actionID);
    return current;
  };
  const reason = (row) => {
    if (row.capability.state === AGENT_SUPPORT.UNSUPPORTED) return AGENT_ERROR.UNSUPPORTED;
    if (row.capability.state === AGENT_SUPPORT.UNVERIFIED) return AGENT_ERROR.UNVERIFIED;
    if (!row.accepted) return AGENT_ERROR.UNACCEPTED;
    if (row.manifest.effect === AGENT_EXTENSION.EFFECT.MUTATION && !attempts) return AGENT_ERROR.WRITE_UNAVAILABLE;
    return null;
  };
  const select = (actionID, expected) => {
    const current = binding(actionID, expected);
    const row = current.extensions?.find((item) => item.manifest.actionID === actionID);
    if (!row) return refuse(AGENT_ERROR.UNKNOWN_OPERATION, actionID);
    const error = reason(row);
    if (error) return refuse(error, actionID);
    return row;
  };
  const describe = (expected) => {
    const current = binding(AGENT_HOST_OPERATION.DESCRIBE_EXTENSIONS, expected);
    return { identity: { ...current.identity }, actions: (current.extensions ?? []).map((row) => {
      const error = reason(row);
      return { manifest: row.manifest, availability: error ? { available: false, reason: error } : { available: true } };
    }) };
  };
  const dispatch = async (actionID, input, expected) => {
    const row = select(actionID, expected);
    const manifest = row.manifest;
    let request;
    try {
      const parsed = scopeSchema.parse(input);
      const mutation = manifest.effect === AGENT_EXTENSION.EFFECT.MUTATION;
      if (Boolean(parsed.workspaceID) !== manifest.context.workspace || Boolean(parsed.sessionID) !== manifest.context.session
        || Boolean(parsed.requestID) !== mutation) return refuse(AGENT_ERROR.INVALID_INPUT, actionID);
      request = { ...parsed, values: parseExtensionInput(manifest, parsed.values) };
    } catch { return refuse(AGENT_ERROR.INVALID_INPUT, actionID); }
    const identity = Object.freeze({ ...binding(actionID, expected).identity });
    const mutation = manifest.effect === AGENT_EXTENSION.EFFECT.MUTATION;
    const attempt = mutation ? await attempts.begin(identity, actionID, request.requestID) : null;
    try { select(actionID, identity); }
    catch (error) { await attempt?.finish(AGENT_ATTEMPT.NOT_SENT); throw error; }
    let finalizing = false;
    try {
      const response = responseSchema.parse(await row.handler(request, identity));
      const current = select(actionID, identity);
      if (JSON.stringify(current.manifest) !== JSON.stringify(manifest)) return refuse(AGENT_ERROR.CHANGED, actionID);
      const result = parseExtensionResult(manifest, response.result);
      if (mutation) {
        if (!response.receipt || response.receipt.requestID !== request.requestID
          || (manifest.outcome === AGENT_EXTENSION.OUTCOME.OBSERVED && response.receipt.state !== AGENT_ATTEMPT.COMPLETE)) {
          return refuse(AGENT_ERROR.UNKNOWN_OUTCOME, actionID);
        }
        finalizing = true;
        await attempt.finish(response.receipt.state);
        select(actionID, identity);
        if (response.receipt.state === AGENT_ATTEMPT.UNKNOWN) return refuse(AGENT_ERROR.UNKNOWN_OUTCOME, actionID);
      } else if (response.receipt) { return refuse(AGENT_ERROR.INVALID_RESPONSE, actionID); }
      return response.receipt ? { identity, result, receipt: response.receipt } : { identity, result };
    } catch (error) {
      if (attempt) {
        if (!finalizing) await attempt.finish(AGENT_ATTEMPT.UNKNOWN).catch(() => {});
        return refuse(AGENT_ERROR.UNKNOWN_OUTCOME, actionID);
      }
      select(actionID, identity);
      if (error instanceof AgentDispatchError) throw error;
      return refuse(error instanceof z.ZodError ? AGENT_ERROR.INVALID_RESPONSE : AGENT_ERROR.BACKEND_FAILED, actionID);
    }
  };
  return Object.freeze({ describe, dispatch });
};
