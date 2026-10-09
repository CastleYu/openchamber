import { z } from 'zod';

import { AGENT_ADAPTER, AGENT_ERROR } from './constants.js';
import { AgentArtifactError, readAgentAdapterArtifact } from './artifacts.js';
import {
  agentAdapterProfileSchema, agentAdapterSchema, agentIdentitySchema, agentRequestControlSchema, agentServerRequestSchema, agentServerResponseSchema,
} from './schemas.js';

const namespaceSchema = z.object({ [AGENT_ADAPTER.FACTORY]: z.function() }).strict();
const transportSchema = z.object({ request: z.function() }).strict();
const freezeManifest = (value) => {
  if (value === null || Object(value) !== value) return value;
  for (const child of Object.values(value)) freezeManifest(child);
  return Object.freeze(value);
};

export class AgentAdapterError extends Error {
  constructor(code) {
    super(`Agent adapter refused: ${code}`);
    this.name = 'AgentAdapterError';
    this.code = code;
  }
}

/** Host-only loading of reviewed code. This is not a sandbox or operation approval. */
export const loadAgentAdapter = async ({ directory, manifest, profile, transport }) => {
  const selected = agentAdapterProfileSchema.safeParse(profile);
  const port = transportSchema.safeParse(transport);
  if (!selected.success || !port.success) throw new AgentAdapterError(AGENT_ERROR.INVALID_INPUT);
  const context = Object.freeze({ request: async (input, identity, control = {}) => {
    const request = agentServerRequestSchema.safeParse(input);
    const scope = agentIdentitySchema.safeParse(identity);
    const options = agentRequestControlSchema.safeParse(control);
    if (!request.success || !scope.success || !options.success) throw new AgentAdapterError(AGENT_ERROR.INVALID_INPUT);
    if (scope.data.family !== selected.data.family || scope.data.adapterRevision !== selected.data.adapterRevision
      || scope.data.capabilityRevision !== selected.data.capabilityRevision) {
      throw new AgentAdapterError(AGENT_ERROR.CHANGED);
    }
    const response = agentServerResponseSchema.safeParse(await port.data.request(request.data, scope.data, options.data));
    if (!response.success) throw new AgentAdapterError(AGENT_ERROR.INVALID_RESPONSE);
    return response.data;
  } });
  try {
    const snapshot = await readAgentAdapterArtifact({ directory, manifest });
    const loaded = namespaceSchema.safeParse(await import(snapshot.moduleURL));
    if (!loaded.success) throw new AgentAdapterError(AGENT_ERROR.ADAPTER_FAILED);
    const adapter = agentAdapterSchema.safeParse(await loaded.data[AGENT_ADAPTER.FACTORY](context));
    if (!adapter.success) throw new AgentAdapterError(AGENT_ERROR.ADAPTER_FAILED);
    const value = adapter.data;
    const registration = {
      ...selected.data, artifactDigest: snapshot.artifactDigest,
      capabilities: Object.freeze(Object.fromEntries(Object.entries(value.capabilities).map(([id, support]) => [
        id, Object.freeze({ ...support, evidence: Object.freeze([...support.evidence]) }),
      ]))),
      handlers: Object.freeze({ ...value.handlers }),
    };
    if (value.extensions) registration.extensions = Object.freeze(value.extensions.map(({ manifest, capability, handler }) => Object.freeze({
      manifest: freezeManifest(manifest),
      capability: Object.freeze({ ...capability, evidence: Object.freeze([...capability.evidence]) }),
      handler,
    })));
    return Object.freeze(registration);
  } catch (error) {
    if (error instanceof AgentArtifactError || error instanceof AgentAdapterError) throw error;
    throw new AgentAdapterError(AGENT_ERROR.ADAPTER_FAILED);
  }
};
